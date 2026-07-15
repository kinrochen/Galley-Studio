import {
  Modal,
  Notice,
  Platform,
  Plugin,
  type EventRef,
  type Menu,
  type TAbstractFile,
  type TFile,
  type Vault,
  type WorkspaceLeaf
} from "obsidian";
import {
  generateCurrentArticle,
  type GenerateCurrentArticleContext
} from "./commands/GenerateCurrentArticle";
import {
  MAX_SKILL_ARCHIVE_BYTES,
  MAX_THEME_ARCHIVE_BYTES
} from "./archive/ArchiveLimits";
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
import type { OpenedGalleyDocumentSession } from "./documents/DocumentSessionOpener";
import { ObsidianDocumentSessionOpener } from "./documents/ObsidianDocumentSessionOpener";
import { EditorFactory } from "./editor/EditorFactory";
import { EditorResourceResolver } from "./editor/EditorResourceResolver";
import {
  normalizeExportConfiguration,
  type ExportConfiguration
} from "./export/ExportConfiguration";
import { ExportService } from "./export/ExportService";
import { ObsidianExportArtifactWriter } from "./export/ObsidianExportArtifactWriter";
import { RichTextClipboard } from "./export/RichTextClipboard";
import {
  PortableInlineProfile,
  StandardWebProfile,
  WechatProfile
} from "./export/profiles";
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
import {
  GALLEY_PREVIEW_VIEW_TYPE,
  GalleyPreviewView,
  isGalleyPreviewPath,
  openGalleyPreview
} from "./preview/GalleyPreviewView";
import {
  GALLEY_WORKBENCH_VIEW_TYPE,
  GalleyWorkbenchView,
  isGalleyHtmlPath,
  type GalleyWorkbenchViewServices,
  type WorkbenchDocument
} from "./workbench/GalleyWorkbenchView";
import {
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "./theme-lab/ThemeLabView";

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);
  readonly #generationControllers = new Set<AbortController>();
  readonly #editorFactory = new EditorFactory();
  #documentOpener: ObsidianDocumentSessionOpener | null = null;
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
    this.registerView(
      GALLEY_PREVIEW_VIEW_TYPE,
      (leaf) => this.#createPreviewView(leaf)
    );
    this.addCommand({
      id: "open-current-galley-preview",
      name: "Galley: Preview current Galley document",
      checkCallback: (checking) => {
        const path = this.#activeGalleyPath();
        if (!path) return false;
        if (!checking) void this.openGalleyPreview(path);
        return true;
      }
    });
    this.#registerGalleyFileMenu();
    if (this.canGenerate) {
      this.registerView(
        GALLEY_THEME_LAB_VIEW_TYPE,
        (leaf) => this.#createThemeLabView(leaf)
      );
      this.registerView(
        GALLEY_WORKBENCH_VIEW_TYPE,
        (leaf) => this.#createWorkbenchView(leaf)
      );
      this.addCommand({
        id: "open-current-galley-in-workbench",
        name: "Galley: Open current Galley document in workbench",
        checkCallback: (checking) => {
          const path = this.#activeGalleyPath();
          if (!path) return false;
          if (!checking) void this.openGalleyDocument(path);
          return true;
        }
      });
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
      this.addCommand({
        id: "open-theme-lab",
        name: "Galley: Open AI Theme Lab",
        callback: () => this.openThemeLab()
      });
      this.addCommand({
        id: "theme-import-zip",
        name: "Galley: Import custom theme ZIP",
        callback: () => this.importCustomTheme()
      });
      this.addCommand({
        id: "theme-export-zip",
        name: "Galley: Export custom theme ZIP",
        callback: () => this.exportCustomTheme()
      });
      this.addCommand({
        id: "theme-toggle-enabled",
        name: "Galley: Enable or disable custom theme",
        callback: () => this.toggleCustomTheme()
      });
      this.addCommand({
        id: "theme-delete",
        name: "Galley: Delete custom theme",
        callback: () => this.deleteCustomTheme()
      });
      this.addCommand({
        id: "skill-import-zip",
        name: "Galley: Import Skill ZIP",
        callback: () => this.importSkillPackage()
      });
      this.addCommand({
        id: "skill-activate-imported",
        name: "Galley: Activate imported Skill",
        callback: () => this.activateImportedSkill()
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
      createPipeline: async (settings, signal) => {
        const { createProductionGeneration } = await import(
          "./platform/DesktopGenerationRuntime"
        );
        return createProductionGeneration(this.app, settings, signal);
      },
      createRepository: (settings) =>
        new ArtifactRepository(new ObsidianArtifactVault(this.app.vault), {
          outputFolder: settings.outputFolder
        }),
      notice: (message) => {
        new Notice(message);
      },
      openArtifact: (path) => this.openGalleyDocument(path)
    };

    try {
      await generateCurrentArticle(context, controller.signal);
    } catch {
      // The command adapter already emitted a sanitized, allowlisted Notice.
    } finally {
      this.#generationControllers.delete(controller);
    }
  }

  async openGalleyDocument(path: string): Promise<void> {
    if (!this.capabilities.canEdit || !isGalleyHtmlPath(path)) return;
    const workspace = (this.app as GalleyPlugin["app"] | undefined)?.workspace;
    if (!workspace || typeof workspace.getLeaf !== "function") return;
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({
      type: GALLEY_WORKBENCH_VIEW_TYPE,
      state: { path },
      active: true
    });
    if (typeof workspace.revealLeaf === "function") {
      workspace.revealLeaf(leaf);
    }
  }

  async openGalleyPreview(path: string): Promise<void> {
    if (!isGalleyPreviewPath(path)) return;
    const workspace = (this.app as GalleyPlugin["app"] | undefined)?.workspace;
    if (!workspace || typeof workspace.getLeaf !== "function") return;
    await openGalleyPreview(workspace, path);
  }

  async openThemeLab(): Promise<void> {
    if (!this.capabilities.canGenerate) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GALLEY_THEME_LAB_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async importCustomTheme(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const bytes = await chooseZip(
        MAX_THEME_ARCHIVE_BYTES,
        "A custom theme ZIP must be no larger than 12 MiB."
      );
      if (!bytes) return;
      const id = await (await this.#themeRuntime()).importThemeArchive(
        this.app,
        bytes,
        this.settings
      );
      new Notice(`Imported custom theme: ${id}`);
    } catch (error) {
      new Notice(safeOperationMessage(error, "Theme import failed."));
    }
  }

  async exportCustomTheme(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    const id = window.prompt("Custom theme id to export:")?.trim();
    if (!id) return;
    try {
      const artifact = await (await this.#themeRuntime()).exportThemeArchive(
        this.app,
        id,
        this.settings
      );
      downloadBytes(artifact.filename, artifact.bytes);
      new Notice(`Exported custom theme: ${id}`);
    } catch (error) {
      new Notice(safeOperationMessage(error, "Theme export failed."));
    }
  }

  async toggleCustomTheme(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const runtime = await this.#themeRuntime();
      const themes = await runtime.listCustomThemes(this.app, this.settings);
      const id = window.prompt(
        `Custom theme id to toggle:\n${themes
          .map(({ id: themeId, name, enabled }) => `${themeId} — ${name} (${enabled ? "enabled" : "disabled"})`)
          .join("\n")}`
      )?.trim();
      if (!id) return;
      const theme = themes.find(({ id: themeId }) => themeId === id);
      if (!theme) throw new Error(`Custom theme not found: ${id}`);
      await runtime.setCustomThemeEnabled(this.app, id, !theme.enabled, this.settings);
      new Notice(`${theme.enabled ? "Disabled" : "Enabled"} custom theme: ${id}`);
    } catch (error) {
      new Notice(safeOperationMessage(error, "Theme update failed."));
    }
  }

  async deleteCustomTheme(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const runtime = await this.#themeRuntime();
      const themes = await runtime.listCustomThemes(this.app, this.settings);
      const id = window.prompt(
        `Custom theme id to delete:\n${themes.map(({ id: themeId, name }) => `${themeId} — ${name}`).join("\n")}`
      )?.trim();
      if (!id) return;
      if (!themes.some(({ id: themeId }) => themeId === id)) {
        throw new Error(`Custom theme not found: ${id}`);
      }
      if (!window.confirm(`Delete custom theme “${id}”?`)) return;
      if (!(await runtime.deleteCustomTheme(this.app, id, this.settings))) {
        throw new Error(`Custom theme not found: ${id}`);
      }
      new Notice(`Deleted custom theme: ${id}`);
    } catch (error) {
      new Notice(safeOperationMessage(error, "Theme deletion failed."));
    }
  }

  async importSkillPackage(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const bytes = await chooseZip(
        MAX_SKILL_ARCHIVE_BYTES,
        "A Skill ZIP must be no larger than 25 MiB."
      );
      if (!bytes) return;
      const version = await (await this.#themeRuntime()).importSkillArchive(
        this.app,
        bytes
      );
      new Notice(
        `Imported Skill ${version}. It remains inactive until explicitly activated.`
      );
    } catch (error) {
      new Notice(safeOperationMessage(error, "Skill import failed."));
    }
  }

  async activateImportedSkill(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const runtime = await this.#themeRuntime();
      const versions = await runtime.listImportedSkills(this.app);
      const version = window.prompt(
        `Imported Skill version to activate:\n${versions.join("\n")}`
      )?.trim();
      if (!version) return;
      await runtime.activateImportedSkill(
        this.app,
        version,
        this.settings.activeSkillVersion,
        {
          load: () => this.loadData(),
          save: (settings) => this.saveData(settings)
        }
      );
      this.settings = normalizeSettings(await this.loadData());
      new Notice(`Activated Skill: ${version}`);
    } catch (error) {
      new Notice(
        safeOperationMessage(
          error,
          "Skill activation failed; the previous version remains active."
        )
      );
    }
  }

  #createPreviewView(leaf: WorkspaceLeaf): GalleyPreviewView {
    const resourceResolver = new EditorResourceResolver((path) => {
      const file = this.app.vault.getFileByPath(path);
      return file ? this.app.vault.getResourcePath(file) : path;
    });
    return new GalleyPreviewView(leaf, {
      openDocument: async (path) => {
        const session = await this.#opener().open(path);
        return { html: session.html() };
      },
      resourceResolver
    });
  }

  #createThemeLabView(leaf: WorkspaceLeaf): ThemeLabView {
    return new ThemeLabView(leaf, {
      supportsVision: async () => {
        try {
          return (await this.#themeRuntime()).supportsThemeVision(
            this.app,
            this.settings
          );
        } catch {
          return false;
        }
      },
      generate: async (input, signal) =>
        (await this.#themeRuntime()).generateThemeDraft(
          this.app,
          this.settings,
          input,
          signal
        ),
      save: async (draft) =>
        (await this.#themeRuntime()).saveThemeDraft(this.app, draft, this.settings),
      report: (message) => new Notice(message)
    });
  }

  #themeRuntime(): Promise<typeof import("./platform/DesktopThemeRuntime")> {
    return import("./platform/DesktopThemeRuntime");
  }

  #createWorkbenchView(leaf: WorkspaceLeaf): GalleyWorkbenchView {
    const resourceResolver = new EditorResourceResolver((path) => {
      const file = this.app.vault.getFileByPath(path);
      return file ? this.app.vault.getResourcePath(file) : path;
    });
    const services: GalleyWorkbenchViewServices = {
      capabilities: this.capabilities,
      openDocument: async (path) =>
        this.#asWorkbenchDocument(await this.#opener().open(path)),
      createVisualEditor: () => this.#editorFactory.createVisual(this.capabilities),
      createSourceEditor: () => this.#editorFactory.createSource(this.capabilities),
      openCopy: (path) => this.openGalleyDocument(path),
      confirm: async (message) => window.confirm(message),
      resourceResolver,
      documentBaseUrl: () => "app://vault/",
      exportConfigurations: this.settings.exportConfigurations,
      exportDocument: async (
        { session, documentPath, configuration },
        signal
      ) => {
        const documentId = session.documentId?.();
        const recordExport = session.recordExport?.bind(session);
        if (!documentId || !recordExport) {
          throw new Error("The production document session cannot record exports.");
        }
        const service = new ExportService({
          profiles: [
            new StandardWebProfile(),
            new PortableInlineProfile(),
            new WechatProfile()
          ],
          writer: new ObsidianExportArtifactWriter(this.app.vault),
          recorder: { record: recordExport },
          repairer: {
            repair: async (html, repairSignal) => {
              const { createProductionWechatRepairer } = await import(
                "./platform/DesktopGenerationRuntime"
              );
              return createProductionWechatRepairer(
                this.app,
                this.settings
              ).repair(html, repairSignal);
            }
          }
        });
        const result = await service.export({
          source: {
            htmlPath: documentPath,
            documentId,
            html: session.html(),
            reservedPaths: session.exportPaths?.() ?? []
          },
          configuration
        }, signal);
        return { path: result.path, html: result.html };
      },
      copyExportHtml: (html) => new RichTextClipboard().copy(html),
      saveExportConfiguration: (configuration) =>
        this.#saveExportConfiguration(configuration),
      reportExportOutcome: (message) => new Notice(message)
    };
    return new GalleyWorkbenchView(leaf, services);
  }

  #asWorkbenchDocument(session: OpenedGalleyDocumentSession): WorkbenchDocument {
    const recovery = session.recoveryState();
    return {
      session,
      recovery: {
        status: recovery.status,
        quarantinedTransactionId:
          recovery.status === "ready" ? null : recovery.transactionId
      },
      listHistory: async () => [...await session.history()]
    };
  }

  #opener(): ObsidianDocumentSessionOpener {
    this.#documentOpener ??= new ObsidianDocumentSessionOpener(this.app.vault);
    return this.#documentOpener;
  }

  async #saveExportConfiguration(
    configurationInput: ExportConfiguration
  ): Promise<readonly ExportConfiguration[]> {
    const configuration = normalizeExportConfiguration(configurationInput);
    const configurations = [...this.settings.exportConfigurations];
    const index = configurations.findIndex(({ id }) => id === configuration.id);
    if (index < 0) configurations.push(configuration);
    else configurations[index] = configuration;
    this.settings = {
      ...this.settings,
      exportConfigurations: Object.freeze(configurations)
    };
    await this.saveSettings();
    return this.settings.exportConfigurations;
  }

  #activeGalleyPath(): string | null {
    const workspace = (this.app as GalleyPlugin["app"] | undefined)?.workspace;
    const active = workspace?.getActiveFile?.();
    return active && isGalleyHtmlPath(active.path) ? active.path : null;
  }

  #registerGalleyFileMenu(): void {
    const workspace = (this.app as GalleyPlugin["app"] | undefined)?.workspace;
    if (!workspace || typeof workspace.on !== "function") return;
    this.registerEvent(
      workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (isFolder(file) || !isGalleyHtmlPath(file.path)) return;
        if (this.capabilities.canEdit) {
          menu.addItem((item) =>
            item
              .setTitle("Open in Galley workbench")
              .setIcon("layout-dashboard")
              .onClick(() => this.openGalleyDocument(file.path))
          );
        }
        menu.addItem((item) =>
          item
            .setTitle("Open Galley preview")
            .setIcon("eye")
            .onClick(() => this.openGalleyPreview(file.path))
        );
      })
    );
  }
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

function chooseZip(
  maxBytes: number,
  tooLargeMessage: string
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        if (file.size > maxBytes) {
          reject(new Error(tooLargeMessage));
          return;
        }
        void file.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new Error("The selected ZIP could not be read."))
        );
      },
      { once: true }
    );
    input.click();
  });
}

function downloadBytes(filename: string, bytes: Uint8Array): void {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const url = URL.createObjectURL(
    new Blob([buffer], { type: "application/zip" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeOperationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/[\r\n]+/gu, " ").slice(0, 200);
  return message || fallback;
}
