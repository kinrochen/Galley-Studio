import {
  Modal,
  Notice,
  type App
} from "obsidian";
import { generateCurrentArticle } from "../commands/GenerateCurrentArticle";
import { LocalCliChatClient } from "../ai/LocalCliChatClient";
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
import { SingleHtmlArtifactRepository } from "../documents/SingleHtmlArtifactRepository";
import {
  normalizeExportConfiguration,
  type ExportConfiguration
} from "../export/ExportConfiguration";
import type { LocalizedText } from "../i18n/LocalizedText";
import type { PlatformCapabilities } from "./PlatformCapabilities";
import { ObsidianSecretStore } from "../secrets/SecretStore";
import { normalizeSettings, type GalleySettings } from "../settings/GalleySettings";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import {
  generationModelLabel,
  loadActiveSkillPackage
} from "./ProductionSkillContext";
import { ObsidianArtifactVault } from "./ObsidianArtifactVault";
import * as themeRuntime from "./DesktopThemeRuntime";
import {
  createProductionGeneration
} from "./DesktopGenerationRuntime";
import { openThemeLab, openWorkbench } from "./DesktopViewRegistry";

export {
  createThemeLabView,
  createWorkbenchView,
  openThemeLab,
  openWorkbench,
  registerDesktopViews
} from "./DesktopViewRegistry";

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
    readActiveSkill: async () => {
      const active = await loadActiveSkillPackage(host.app, host.getSettings());
      return {
        id: active.skillPackage.id,
        version: active.skillPackage.version,
        files: [...active.skillPackage.files.keys()].sort(),
        instructions: active.skillPackage.files.get("SKILL.md") ?? ""
      };
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
  const getFileByPath = host.app.vault.getFileByPath?.bind(host.app.vault);
  const activeFile = input.sourcePath && getFileByPath
    ? getFileByPath(input.sourcePath)
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
        createProductionGeneration(
          host.app,
          settings,
          generationSignal,
          input.onModelEvent
        ),
      createRepository: () => new SingleHtmlArtifactRepository(host.app.vault),
      text: host.locale,
      notice: (message) => new Notice(message),
      openArtifact: (path) => openWorkbench(host.app, path)
    },
    signal
  );
  return {
    status: "committed",
    htmlPath: paths.html,
    sidecarPath: ""
  };
}

export async function runAndReportDiagnostic(host: DesktopConsoleHost): Promise<void> {
  const result = await runDiagnostic(host, new AbortController().signal);
  new Notice(diagnosticSummary(result, host.locale));
  new ConnectionDiagnosticModal(host.app, result, host.locale).open();
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
  const settings = host.getSettings();
  if (settings.generationAgent !== "plugin") {
    const model = generationModelLabel(settings);
    try {
      const agent = settings.generationAgent;
      const client = new LocalCliChatClient({
        agent,
        executable: agent === "codex-cli"
          ? settings.codexCliPath
          : settings.claudeCliPath,
        cwd: vaultWorkingDirectory(host.app),
        timeoutMs: settings.timeoutMs
      });
      await client.checkModelAvailable(signal);
      return { ok: true, model };
    } catch (error) {
      return {
        ok: false,
        model,
        errorCode: safeErrorCode(error)
      };
    }
  }
  return runConnectionDiagnostic(
    {
      settings: host.getSettings(),
      secretStore: new ObsidianSecretStore(host.app),
      transport: createObsidianTransport()
    },
    signal
  );
}

function safeErrorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]{1,64}$/u.test(error.code)
    ? error.code
    : "diagnostic_failed";
}

function settingsSnapshot(settings: GalleySettings): SettingsSnapshot {
  return {
    generationAgent: settings.generationAgent,
    codexCliPath: settings.codexCliPath,
    claudeCliPath: settings.claudeCliPath,
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
    if (result.errorCode) {
      appendFact(this.contentEl, text.t("diagnostic.errorCode"), result.errorCode);
    }
  }
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
  return text.t("diagnostic.notice.passed");
}

function vaultWorkingDirectory(app: App): string {
  const adapter = app.vault.adapter as typeof app.vault.adapter & {
    getBasePath?: () => string;
  };
  return adapter.getBasePath?.() ?? process.cwd();
}
