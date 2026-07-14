import {
  Modal,
  Notice,
  Platform,
  Plugin,
  type EventRef,
  type TAbstractFile,
  type TFile,
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
import { isNormalizedVaultRelativePath } from "./documents/GalleySidecar";
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

interface ObsidianOwnedArtifact {
  readonly path: string;
  readonly file: TFile;
  readonly contents: string;
}

const FINAL_IDENTITY_TIMEOUT_MS = 1_000;

export class ObsidianArtifactVault
  implements ArtifactVault<ObsidianOwnedArtifact>
{
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

  async createOwned(
    path: string,
    contents: string
  ): Promise<ObsidianOwnedArtifact> {
    const file = await this.vault.create(path, contents);
    return { path, file, contents };
  }

  async commitOwned(
    handle: ObsidianOwnedArtifact,
    finalPath: string,
    signal?: AbortSignal
  ): Promise<
    | { status: "committed"; handle: ObsidianOwnedArtifact }
    | { status: "collision" }
  > {
    if (!(await this.owns(handle))) {
      throw new Error("Galley temporary artifact ownership was lost.");
    }
    if (!isNormalizedVaultRelativePath(finalPath)) {
      throw new Error("Galley final artifact path is not normalized.");
    }
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (await this.vault.adapter.exists(finalPath)) {
      return { status: "collision" };
    }

    const observer = observeFinalFile(
      this.vault,
      finalPath,
      handle.contents
    );
    try {
      await this.vault.adapter.copy(handle.path, finalPath);
    } catch (error) {
      observer.dispose();
      if (await this.vault.adapter.exists(finalPath)) {
        return { status: "collision" };
      }
      throw error;
    }

    try {
      const file = await observer.wait(signal);
      return {
        status: "committed",
        handle: { path: finalPath, file, contents: handle.contents }
      };
    } finally {
      observer.dispose();
    }
  }

  async owns(handle: ObsidianOwnedArtifact): Promise<boolean> {
    return this.vault.getAbstractFileByPath(handle.path) === handle.file;
  }

  async removeOwned(handle: ObsidianOwnedArtifact): Promise<void> {
    if (await this.owns(handle)) {
      await this.vault.delete(handle.file, true);
    }
  }
}

interface FinalFileObserver {
  wait(signal?: AbortSignal): Promise<TFile>;
  dispose(): void;
}

function observeFinalFile(
  vault: Vault,
  finalPath: string,
  expectedContents: string
): FinalFileObserver {
  let armed = false;
  let enqueueCandidate: ((file: TFile) => void) | null = null;
  const eventRef: EventRef = vault.on("create", (file) => {
    const created = asTFile(file);
    if (!armed || file.path !== finalPath || !created) {
      return;
    }
    enqueueCandidate?.(created);
  });

  return {
    async wait(signal) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      return new Promise<TFile>((resolve, reject) => {
        let settled = false;
        let verifying = false;
        const candidates: TFile[] = [];
        const finish = (action: () => void): void => {
          if (settled) return;
          settled = true;
          armed = false;
          window.clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          enqueueCandidate = null;
          action();
        };
        const onAbort = (): void => {
          finish(() => reject(new DOMException("Aborted", "AbortError")));
        };
        const timeout = window.setTimeout(() => {
          finish(() =>
            reject(
              new Error("Galley final artifact identity was not observed.")
            )
          );
        }, FINAL_IDENTITY_TIMEOUT_MS);
        const verifyCandidates = async (): Promise<void> => {
          if (verifying || settled) return;
          verifying = true;
          try {
            while (candidates.length > 0 && !settled) {
              const candidate = candidates.shift();
              if (
                candidate &&
                (await verifiesFinalFile(
                  vault,
                  finalPath,
                  expectedContents,
                  candidate
                ))
              ) {
                finish(() => resolve(candidate));
              }
            }
          } finally {
            verifying = false;
            if (candidates.length > 0 && !settled) {
              void verifyCandidates();
            }
          }
        };
        enqueueCandidate = (file) => {
          candidates.push(file);
          void verifyCandidates();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        armed = true;

        const current = asTFile(vault.getAbstractFileByPath(finalPath));
        if (current) {
          enqueueCandidate(current);
        }
      });
    },
    dispose() {
      armed = false;
      enqueueCandidate = null;
      vault.offref(eventRef);
    }
  };
}

async function verifiesFinalFile(
  vault: Vault,
  finalPath: string,
  expectedContents: string,
  candidate: TFile
): Promise<boolean> {
  if (
    candidate.path !== finalPath ||
    vault.getAbstractFileByPath(finalPath) !== candidate
  ) {
    return false;
  }

  let actualContents: string;
  try {
    actualContents = await vault.adapter.read(finalPath);
  } catch {
    return false;
  }

  return (
    actualContents === expectedContents &&
    candidate.path === finalPath &&
    vault.getAbstractFileByPath(finalPath) === candidate
  );
}

function asTFile(file: TAbstractFile | null): TFile | null {
  if (!file || isFolder(file)) {
    return null;
  }
  return file as TFile;
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
