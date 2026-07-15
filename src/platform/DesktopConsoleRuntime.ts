import {
  Modal,
  Notice,
  type App,
  type Plugin,
  type WorkspaceLeaf
} from "obsidian";
import { generateCurrentArticle } from "../commands/GenerateCurrentArticle";
import type {
  DesktopGalleyActions,
  SettingsSnapshot,
  ThemeSummary
} from "../console/GalleyActions";
import type {
  GenerateArticleFormInput,
  GeneratedArticleResult
} from "../console/ConsoleTypes";
import { runConnectionDiagnostic, type ConnectionDiagnosticResult } from "../diagnostics/ConnectionDiagnostic";
import { createObsidianTransport } from "../diagnostics/ObsidianTransport";
import { ArtifactRepository } from "../documents/ArtifactRepository";
import type { OpenedGalleyDocumentSession } from "../documents/DocumentSessionOpener";
import { ObsidianDocumentSessionOpener } from "../documents/ObsidianDocumentSessionOpener";
import { EditorFactory } from "../editor/EditorFactory";
import { EditorResourceResolver } from "../editor/EditorResourceResolver";
import {
  normalizeExportConfiguration,
  type ExportConfiguration
} from "../export/ExportConfiguration";
import { ExportService } from "../export/ExportService";
import { ObsidianExportArtifactWriter } from "../export/ObsidianExportArtifactWriter";
import { RichTextClipboard } from "../export/RichTextClipboard";
import {
  PortableInlineProfile,
  StandardWebProfile,
  WechatProfile
} from "../export/profiles";
import type { LocalizedText } from "../i18n/LocalizedText";
import type { MessageKey } from "../i18n/Resources";
import type { PlatformCapabilities } from "./PlatformCapabilities";
import { ObsidianSecretStore } from "../secrets/SecretStore";
import { normalizeSettings, type GalleySettings } from "../settings/GalleySettings";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import {
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "../theme-lab/ThemeLabView";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import {
  GALLEY_WORKBENCH_VIEW_TYPE,
  GalleyWorkbenchView,
  type GalleyWorkbenchViewServices,
  type WorkbenchDocument
} from "../workbench/GalleyWorkbenchView";
import { loadActiveSkillPackage } from "./ProductionSkillContext";
import { ObsidianArtifactVault } from "./ObsidianArtifactVault";
import * as themeRuntime from "./DesktopThemeRuntime";
import {
  createProductionGeneration,
  createProductionWechatRepairer
} from "./DesktopGenerationRuntime";

export interface DesktopConsoleHost {
  readonly app: App;
  readonly capabilities: PlatformCapabilities;
  readonly locale: LocalizedText;
  getSettings(): GalleySettings;
  replaceSettings(settings: GalleySettings): void;
  loadData(): Promise<unknown>;
  saveData(value: unknown): Promise<void>;
  saveSettings(): Promise<void>;
}

export function registerDesktopViews(
  plugin: Pick<Plugin, "registerView">,
  host: DesktopConsoleHost
): void {
  const editorFactory = new EditorFactory();
  const opener = new ObsidianDocumentSessionOpener(host.app.vault);
  plugin.registerView(GALLEY_THEME_LAB_VIEW_TYPE, (leaf) =>
    createThemeLabView(leaf, host)
  );
  plugin.registerView(GALLEY_WORKBENCH_VIEW_TYPE, (leaf) =>
    createWorkbenchView(leaf, host, opener, editorFactory)
  );
}

export function createDesktopActions(host: DesktopConsoleHost): DesktopGalleyActions {
  return {
    openWorkbench: (path) => openWorkbench(host.app, path),
    openThemeLab: () => openThemeLab(host.app),
    listThemes: () => listThemes(host),
    importTheme: (bytes) =>
      themeRuntime.importThemeArchive(host.app, bytes, host.getSettings()),
    exportTheme: (id) =>
      themeRuntime.exportThemeArchive(host.app, id, host.getSettings()),
    setThemeEnabled: (id, enabled) =>
      themeRuntime.setCustomThemeEnabled(
        host.app,
        id,
        enabled,
        host.getSettings()
      ),
    deleteTheme: (id) =>
      themeRuntime.deleteCustomTheme(host.app, id, host.getSettings()),
    listSkills: async () => {
      const settings = host.getSettings();
      const versions = await themeRuntime.listImportedSkills(host.app);
      return [
        {
          version: "bundled",
          source: "bundled" as const,
          active: settings.activeSkillVersion === "bundled",
          valid: true
        },
        ...versions.map((version) => ({
          version,
          source: "imported" as const,
          active: version === settings.activeSkillVersion,
          valid: true
        }))
      ];
    },
    importSkill: (bytes) => themeRuntime.importSkillArchive(host.app, bytes),
    activateSkill: async (version) => {
      const current = host.getSettings().activeSkillVersion;
      let activationError: unknown;
      try {
        await themeRuntime.activateImportedSkill(host.app, version, current, {
          load: () => host.loadData(),
          save: (value) => host.saveData(value)
        });
      } catch (error) {
        activationError = error;
      }
      let refreshError: unknown;
      try {
        host.replaceSettings(normalizeSettings(await host.loadData()));
      } catch (error) {
        refreshError = error;
      }
      if (activationError !== undefined) throw activationError;
      if (refreshError !== undefined) throw refreshError;
    },
    listExportConfigurations: async () => host.getSettings().exportConfigurations,
    saveExportConfiguration: async (value) => {
      const configuration = normalizeExportConfiguration(value);
      await saveExportConfiguration(host, configuration);
      return configuration;
    },
    deleteExportConfiguration: async (id) => {
      host.replaceSettings({
        ...host.getSettings(),
        exportConfigurations: Object.freeze(
          host
            .getSettings()
            .exportConfigurations.filter((configuration) => configuration.id !== id)
        )
      });
      await host.saveSettings();
    },
    readSettings: async () => settingsSnapshot(host.getSettings()),
    listSecrets: async () => host.app.secretStorage.listSecrets(),
    saveSettings: async (value) => {
      host.replaceSettings(normalizeSettings({ ...host.getSettings(), ...value }));
      await host.saveSettings();
      return settingsSnapshot(host.getSettings());
    },
    runDiagnostic: (signal) => runDiagnostic(host, signal)
  };
}

export async function generateActiveMarkdown(
  host: DesktopConsoleHost,
  input: GenerateArticleFormInput,
  signal: AbortSignal
): Promise<GeneratedArticleResult> {
  const activeFile = input.sourcePath
    ? host.app.vault.getFileByPath(input.sourcePath)
    : host.app.workspace.getActiveFile();
  const paths = await generateCurrentArticle(
    {
      getActiveFile: () => activeFile,
      read: async (file) => {
        if (!activeFile || file.path !== activeFile.path) {
          throw new Error("The active Markdown file changed before reading.");
        }
        return host.app.vault.read(activeFile);
      },
      getSettings: () => host.getSettings(),
      ...(input.themeId ? { manualThemeId: input.themeId } : {}),
      ...(input.onProgress ? { progress: input.onProgress } : {}),
      createPipeline: (settings, generationSignal) =>
        createProductionGeneration(host.app, settings, generationSignal),
      createRepository: (settings) =>
        new ArtifactRepository(new ObsidianArtifactVault(host.app.vault), {
          outputFolder: settings.outputFolder
        }),
      text: host.locale,
      notice: (message) => new Notice(message),
      openArtifact: (path) => openWorkbench(host.app, path)
    },
    signal
  );
  return {
    status: "committed",
    htmlPath: paths.html,
    sidecarPath: paths.sidecar
  };
}

export async function runAndReportDiagnostic(host: DesktopConsoleHost): Promise<void> {
  const result = await runDiagnostic(host, new AbortController().signal);
  new Notice(diagnosticSummary(result, host.locale));
  new ConnectionDiagnosticModal(host.app, result, host.locale).open();
}

export async function openWorkbench(app: App, path: string): Promise<void> {
  if (!path.endsWith(".galley.html")) return;
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: GALLEY_WORKBENCH_VIEW_TYPE,
    state: { path },
    active: true
  });
  app.workspace.revealLeaf(leaf);
}

export async function openThemeLab(app: App): Promise<void> {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: GALLEY_THEME_LAB_VIEW_TYPE, active: true });
  app.workspace.revealLeaf(leaf);
}

async function listThemes(host: DesktopConsoleHost): Promise<readonly ThemeSummary[]> {
  const settings = host.getSettings();
  const active = await loadActiveSkillPackage(host.app, settings);
  const builtIns = new BuiltInThemeRepository(
    new SkillVirtualFileSystem(active.skillPackage.files)
  )
    .list()
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      builtIn: true,
      enabled: true
    }));
  const custom = (await themeRuntime.listCustomThemes(host.app, settings)).map(
    (theme) => ({ ...theme, builtIn: false })
  );
  return [...builtIns, ...custom];
}

export function createThemeLabView(
  leaf: WorkspaceLeaf,
  host: DesktopConsoleHost
): ThemeLabView {
  return new ThemeLabView(leaf, {
    supportsVision: async () => {
      try {
        return await themeRuntime.supportsThemeVision(host.app, host.getSettings());
      } catch {
        return false;
      }
    },
    generate: (input, signal) =>
      themeRuntime.generateThemeDraft(
        host.app,
        host.getSettings(),
        input,
        signal
      ),
    save: (draft) =>
      themeRuntime.saveThemeDraft(host.app, draft, host.getSettings()),
    report: (message) => new Notice(message),
    locale: host.locale
  });
}

export function createWorkbenchView(
  leaf: WorkspaceLeaf,
  host: DesktopConsoleHost,
  opener = new ObsidianDocumentSessionOpener(host.app.vault),
  editorFactory = new EditorFactory()
): GalleyWorkbenchView {
  const resourceResolver = new EditorResourceResolver((path) => {
    const file = host.app.vault.getFileByPath(path);
    return file ? host.app.vault.getResourcePath(file) : path;
  });
  const services: GalleyWorkbenchViewServices = {
    capabilities: host.capabilities,
    openDocument: async (path) => asWorkbenchDocument(await opener.open(path)),
    createVisualEditor: () => editorFactory.createVisual(host.capabilities),
    createSourceEditor: () => editorFactory.createSource(host.capabilities),
    openCopy: (path) => openWorkbench(host.app, path),
    confirm: async (message) => window.confirm(message),
    resourceResolver,
    documentBaseUrl: () => "app://vault/",
    exportConfigurations: host.getSettings().exportConfigurations,
    exportDocument: async ({ session, documentPath, configuration }, signal) => {
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
        writer: new ObsidianExportArtifactWriter(host.app.vault),
        recorder: { record: recordExport },
        repairer: {
          repair: async (html, repairSignal) =>
            createProductionWechatRepairer(
              host.app,
              host.getSettings()
            ).repair(html, repairSignal)
        }
      });
      const result = await service.export(
        {
          source: {
            htmlPath: documentPath,
            documentId,
            html: session.html(),
            reservedPaths: session.exportPaths?.() ?? []
          },
          configuration
        },
        signal
      );
      return { path: result.path, html: result.html };
    },
    copyExportHtml: (html) => new RichTextClipboard().copy(html),
    saveExportConfiguration: (configuration) =>
      saveExportConfiguration(host, configuration),
    reportExportOutcome: (message) => new Notice(message),
    locale: host.locale
  };
  return new GalleyWorkbenchView(leaf, services);
}

function asWorkbenchDocument(
  session: OpenedGalleyDocumentSession
): WorkbenchDocument {
  const recovery = session.recoveryState();
  return {
    session,
    recovery: {
      status: recovery.status,
      quarantinedTransactionId:
        recovery.status === "ready" ? null : recovery.transactionId
    },
    listHistory: async () => [...(await session.history())]
  };
}

async function saveExportConfiguration(
  host: DesktopConsoleHost,
  configurationInput: ExportConfiguration
): Promise<readonly ExportConfiguration[]> {
  const configuration = normalizeExportConfiguration(configurationInput);
  const configurations = [...host.getSettings().exportConfigurations];
  const index = configurations.findIndex(({ id }) => id === configuration.id);
  if (index < 0) configurations.push(configuration);
  else configurations[index] = configuration;
  host.replaceSettings({
    ...host.getSettings(),
    exportConfigurations: Object.freeze(configurations)
  });
  await host.saveSettings();
  return host.getSettings().exportConfigurations;
}

async function runDiagnostic(
  host: DesktopConsoleHost,
  signal: AbortSignal
): Promise<ConnectionDiagnosticResult> {
  return runConnectionDiagnostic(
    {
      settings: host.getSettings(),
      secretStore: new ObsidianSecretStore(host.app),
      transport: createObsidianTransport(),
      loadSkill: () => loadActiveSkillPackage(host.app, host.getSettings())
    },
    signal
  );
}

function settingsSnapshot(settings: GalleySettings): SettingsSnapshot {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    secretId: settings.secretId,
    temperature: settings.temperature,
    timeoutMs: settings.timeoutMs,
    contextWindow: settings.contextWindow,
    outputFolder: settings.outputFolder,
    language: settings.language,
    activeSkillVersion: settings.activeSkillVersion
  };
}

class ConnectionDiagnosticModal extends Modal {
  readonly #result: ConnectionDiagnosticResult;
  readonly #text: LocalizedText;
  #unsubscribe: (() => void) | null = null;

  constructor(
    app: App,
    result: ConnectionDiagnosticResult,
    text: LocalizedText
  ) {
    super(app);
    this.#result = result;
    this.#text = text;
    this.#render();
    this.#unsubscribe = text.subscribe(() => this.#render());
  }

  onClose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #render(): void {
    const result = this.#result;
    const text = this.#text;
    this.titleEl.textContent = text.t("diagnostic.title");
    this.contentEl.replaceChildren();
    appendFact(
      this.contentEl,
      text.t("diagnostic.status"),
      text.t(result.ok ? "diagnostic.passed" : "diagnostic.failed")
    );
    appendFact(this.contentEl, text.t("diagnostic.model"), result.model);
    appendCapability(this.contentEl, "diagnostic.tools", result.capabilities.tools, text);
    appendCapability(
      this.contentEl,
      "diagnostic.streaming",
      result.capabilities.streaming,
      text
    );
    appendCapability(this.contentEl, "diagnostic.vision", result.capabilities.vision, text);
    appendFact(this.contentEl, text.t("diagnostic.skillVersion"), result.skillVersion);
    appendFact(this.contentEl, text.t("diagnostic.skillLoadMode"), result.skillLoadMode);
    if (result.errorCode) {
      appendFact(this.contentEl, text.t("diagnostic.errorCode"), result.errorCode);
    }
    const filesHeading = document.createElement("p");
    filesHeading.textContent = text.t("diagnostic.skillFiles");
    const files = document.createElement("ul");
    for (const path of result.skillFiles) {
      const item = document.createElement("li");
      item.textContent = path;
      files.append(item);
    }
    this.contentEl.append(filesHeading, files);
  }
}

function appendCapability(
  container: HTMLElement,
  label: MessageKey,
  supported: boolean,
  text: LocalizedText
): void {
  appendFact(
    container,
    text.t(label),
    text.t(supported ? "diagnostic.supported" : "diagnostic.notObserved")
  );
}

function appendFact(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value}`;
  container.append(row);
}

function diagnosticSummary(
  result: ConnectionDiagnosticResult,
  text: LocalizedText
): string {
  if (!result.ok) {
    return text.t("diagnostic.notice.failed", {
      code: result.errorCode ?? "diagnostic_failed"
    });
  }
  return text.t("diagnostic.notice.passed", { mode: result.skillLoadMode });
}
