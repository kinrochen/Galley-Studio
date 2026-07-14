import {
  Modal,
  Notice,
  Platform,
  Plugin,
  type TAbstractFile,
  type Vault
} from "obsidian";
import { AiError } from "./ai/AiError";
import { validateBaseUrl } from "./ai/BaseUrlPolicy";
import { OpenAiCompatibleClient } from "./ai/OpenAiCompatibleClient";
import { CapabilityProbe } from "./ai/CapabilityProbe";
import {
  generateCurrentArticle,
  type GenerateCurrentArticleContext
} from "./commands/GenerateCurrentArticle";
import {
  type ConnectionDiagnosticResult,
  runConnectionDiagnostic
} from "./diagnostics/ConnectionDiagnostic";
import { createObsidianTransport } from "./diagnostics/ObsidianTransport";
import {
  ArtifactRepository,
  type ArtifactVault
} from "./documents/ArtifactRepository";
import { BUNDLED_SKILL } from "./generated/bundledSkill";
import { GenerationPipeline } from "./generation/GenerationPipeline";
import {
  derivePlatformCapabilities,
  type PlatformCapabilities
} from "./platform/PlatformCapabilities";
import { ObsidianSecretStore } from "./secrets/SecretStore";
import {
  type GalleySettings,
  normalizeSettings
} from "./settings/GalleySettings";
import { GalleySettingTab } from "./settings/GalleySettingTab";
import { BundledSkillLoader } from "./skill/BundledSkillLoader";
import { SkillSession } from "./skill/SkillSession";
import { SkillVirtualFileSystem } from "./skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "./themes/BuiltInThemeRepository";

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);
  readonly #generationControllers = new Set<AbortController>();
  readonly capabilities: PlatformCapabilities = derivePlatformCapabilities(
    Platform.isMobileApp
  );

  get canGenerate(): boolean {
    return this.capabilities.canGenerate;
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.addSettingTab(new GalleySettingTab(this.app, this));
    this.addCommand({
      id: "show-capabilities",
      name: "Show Galley capabilities",
      callback: () => console.info("Galley capabilities", this.capabilities)
    });
    if (this.canGenerate) {
      this.addCommand({
        id: "check-model-connection-and-skill-loading",
        name: "Galley: Check model connection and Skill loading",
        callback: () => this.checkModelConnectionAndSkillLoading()
      });
      this.addCommand({
        id: "generate-current-article",
        name: "Galley: AI layout current article",
        callback: () => this.runGenerateCurrentArticle()
      });
    }
  }

  onunload(): void {
    for (const controller of this.#generationControllers) {
      controller.abort();
    }
    this.#generationControllers.clear();
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  async checkModelConnectionAndSkillLoading(): Promise<void> {
    if (!this.canGenerate) {
      return;
    }

    const result = await runConnectionDiagnostic(
      {
        settings: this.settings,
        secretStore: new ObsidianSecretStore(this.app),
        transport: createObsidianTransport()
      },
      new AbortController().signal
    );

    new Notice(diagnosticSummary(result));
    new ConnectionDiagnosticModal(this.app, result).open();
  }

  async runGenerateCurrentArticle(): Promise<void> {
    if (!this.canGenerate) {
      return;
    }
    const controller = new AbortController();
    this.#generationControllers.add(controller);
    const activeFile = this.app.workspace.getActiveFile();
    const context: GenerateCurrentArticleContext = {
      getActiveFile: () => activeFile,
      read: async (file) => {
        if (!activeFile || file.path !== activeFile.path) {
          throw new Error("The active Markdown file changed before reading.");
        }
        return this.app.vault.read(activeFile);
      },
      getSettings: () => this.settings,
      createPipeline: async (settings, signal) =>
        createProductionGeneration(this.app, settings, signal),
      createRepository: (settings) =>
        new ArtifactRepository(new ObsidianArtifactVault(this.app.vault), {
          outputFolder: settings.outputFolder
        }),
      notice: (message) => {
        new Notice(message);
      }
    };

    try {
      await generateCurrentArticle(context, controller.signal);
    } catch {
      // The command adapter already emitted a sanitized, allowlisted Notice.
    } finally {
      this.#generationControllers.delete(controller);
    }
  }
}

async function createProductionGeneration(
  app: GalleyPlugin["app"],
  settings: Readonly<GalleySettings>,
  signal: AbortSignal
): Promise<{ model: string; pipeline: GenerationPipeline }> {
  const secretStore = new ObsidianSecretStore(app);
  if (!settings.secretId || !secretStore.get(settings.secretId)) {
    throw new AiError("missing_secret");
  }
  try {
    validateBaseUrl(settings.baseUrl);
  } catch {
    throw new AiError("invalid_base_url");
  }
  const client = OpenAiCompatibleClient.fromSettings(
    createObsidianTransport(),
    settings,
    secretStore
  );
  const target = { baseUrl: settings.baseUrl, model: settings.model };
  const capabilities = await new CapabilityProbe(client).probe(target, signal);
  const skillPackage = await new BundledSkillLoader().load();
  const vfs = new SkillVirtualFileSystem(skillPackage.files);
  const session = new SkillSession({
    client,
    target,
    capabilities,
    skillPackage,
    vfs,
    packageHash: BUNDLED_SKILL.archiveSha256
  });
  const themes = new BuiltInThemeRepository(vfs);
  return {
    model: settings.model,
    pipeline: new GenerationPipeline({ session, themes })
  };
}

class ObsidianArtifactVault implements ArtifactVault {
  constructor(private readonly vault: Vault) {}

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async ensureFolder(path: string): Promise<void> {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const folder = parts.slice(0, index).join("/");
      const existing = this.vault.getAbstractFileByPath(folder);
      if (existing) {
        if (!isFolder(existing)) {
          throw new Error("Configured Galley output folder conflicts with a file.");
        }
        continue;
      }
      await this.vault.createFolder(folder);
    }
  }

  async create(path: string, contents: string): Promise<void> {
    if (this.vault.getAbstractFileByPath(path)) {
      throw new Error("Galley artifact path already exists.");
    }
    await this.vault.create(path, contents);
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.vault.getAbstractFileByPath(from);
    if (!source) {
      throw new Error("Galley temporary artifact is missing.");
    }
    if (this.vault.getAbstractFileByPath(to)) {
      throw new Error("Galley artifact path already exists.");
    }
    await this.vault.rename(source, to);
  }

  async remove(path: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(path);
    if (file) {
      await this.vault.delete(file, true);
    }
  }
}

function isFolder(file: TAbstractFile): boolean {
  return "children" in file;
}

class ConnectionDiagnosticModal extends Modal {
  constructor(app: GalleyPlugin["app"], result: ConnectionDiagnosticResult) {
    super(app);
    this.titleEl.textContent = "Galley connection and Skill diagnostic";
    this.contentEl.replaceChildren();
    appendFact(this.contentEl, "Status", result.ok ? "Passed" : "Failed");
    appendFact(this.contentEl, "Model", result.model);
    appendFact(
      this.contentEl,
      "Tools",
      result.capabilities.tools ? "Supported" : "Not observed"
    );
    appendFact(
      this.contentEl,
      "Streaming",
      result.capabilities.streaming ? "Supported" : "Not observed"
    );
    appendFact(
      this.contentEl,
      "Vision",
      result.capabilities.vision ? "Supported" : "Not observed"
    );
    appendFact(this.contentEl, "Skill version", result.skillVersion);
    appendFact(this.contentEl, "Skill load mode", result.skillLoadMode);
    if (result.errorCode) {
      appendFact(this.contentEl, "Error code", result.errorCode);
    }

    const filesHeading = document.createElement("p");
    filesHeading.textContent = "Skill files:";
    const files = document.createElement("ul");
    for (const path of result.skillFiles) {
      const item = document.createElement("li");
      item.textContent = path;
      files.append(item);
    }
    this.contentEl.append(filesHeading, files);
  }
}

function appendFact(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value}`;
  container.append(row);
}

function diagnosticSummary(result: ConnectionDiagnosticResult): string {
  if (!result.ok) {
    return `Galley diagnostic failed (${result.errorCode ?? "diagnostic_failed"}).`;
  }
  return `Galley diagnostic passed: Skill loaded via ${result.skillLoadMode}.`;
}
