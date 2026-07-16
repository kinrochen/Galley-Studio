import {
  Notice,
  Platform,
  Plugin,
  type Menu,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { generationFailureMessage } from "./commands/GenerateCurrentArticle";
import { ArticleCatalog, type ArticleCatalogVault } from "./console/ArticleCatalog";
import {
  createGalleyActions,
  type DesktopGalleyActions,
  type GalleyActions
} from "./console/GalleyActions";
import {
  GALLEY_CONSOLE_VIEW_TYPE,
  GalleyConsoleView
} from "./console/GalleyConsoleView";
import type { ConsoleRoute } from "./console/ConsoleTypes";
import { isNormalizedVaultRelativePath } from "./documents/GalleySidecar";
import { ObsidianDocumentSessionOpener } from "./documents/ObsidianDocumentSessionOpener";
import { EditorResourceResolver } from "./editor/EditorResourceResolver";
import {
  GenerationTaskStore,
  type GenerationTaskController
} from "./generation/GenerationTask";
import { LocaleStore } from "./i18n/LocaleStore";
import {
  ENGLISH_LOCALIZED_TEXT,
  type LocalizedText
} from "./i18n/LocalizedText";
import {
  derivePlatformCapabilities,
  type PlatformCapabilities
} from "./platform/PlatformCapabilities";
import {
  GALLEY_PREVIEW_VIEW_TYPE,
  GalleyPreviewView,
  isGalleyPreviewPath,
  openGalleyPreview
} from "./preview/GalleyPreviewView";
import {
  normalizeSettings,
  type GalleySettings
} from "./settings/GalleySettings";
import { GalleySettingTab } from "./settings/GalleySettingTab";

export { ObsidianArtifactVault } from "./platform/ObsidianArtifactVault";

const GALLEY_DESKTOP_HTML_VIEW_TYPE = "galley-studio-workbench";

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);
  readonly capabilities: PlatformCapabilities = derivePlatformCapabilities(
    Platform.isMobileApp
  );
  #generationTask: GenerationTaskController | null = null;
  #documentOpener: ObsidianDocumentSessionOpener | null = null;
  #locale: LocaleStore | null = null;
  #unsubscribeRibbonLocale: (() => void) | null = null;
  #articleCatalog: ArticleCatalog | null = null;
  #actions: GalleyActions | null = null;
  #consoleLeaf: WorkspaceLeaf | null = null;

  get canGenerate(): boolean {
    return this.capabilities.canGenerate;
  }

  get localizedText(): LocalizedText {
    return this.#locale ?? ENGLISH_LOCALIZED_TEXT;
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.#locale = new LocaleStore({
      language: this.settings.language,
      obsidianLocale: () => this.#obsidianLocale()
    });
    this.#articleCatalog = new ArticleCatalog(this.#catalogVault());

    let desktop: DesktopGalleyActions | undefined;
    if (this.canGenerate) {
      const host = this.#desktopHost();
      const views = await this.#desktopViewRegistry();
      views.registerDesktopViews(this, host);
      desktop = this.#lazyDesktopActions();
      this.#generationTask = new GenerationTaskStore({
        run: (input, signal) =>
          this.#desktopRuntime().then((runtime) =>
            runtime.generateActiveMarkdown(this.#desktopHost(), input, signal)
          ),
        failureMessage: (error, signal) =>
          generationFailureMessage(error, signal, this.localizedText)
      });
    }
    this.#actions = this.#createActions(desktop);

    this.addSettingTab(new GalleySettingTab(this.app, this));
    this.registerView(GALLEY_CONSOLE_VIEW_TYPE, (leaf) =>
      this.#createConsoleView(leaf)
    );
    this.registerView(GALLEY_PREVIEW_VIEW_TYPE, (leaf) =>
      this.#createPreviewView(leaf)
    );
    this.registerExtensions(
      ["html"],
      this.capabilities.canEdit
        ? GALLEY_DESKTOP_HTML_VIEW_TYPE
        : GALLEY_PREVIEW_VIEW_TYPE
    );
    const ribbon = this.addRibbonIcon("newspaper", this.localizedText.t("console.ribbon"), () =>
      this.openGalleyConsole()
    );
    const updateRibbon = (): void => {
      const label = this.localizedText.t("console.ribbon");
      ribbon.title = label;
      ribbon.setAttribute("aria-label", label);
    };
    updateRibbon();
    this.#unsubscribeRibbonLocale = this.localizedText.subscribe(updateRibbon);
    this.#registerCommands();
    this.#registerGalleyFileMenu();
  }

  onunload(): void {
    this.#unsubscribeRibbonLocale?.();
    this.#unsubscribeRibbonLocale = null;
    this.#generationTask?.dispose();
    this.#generationTask = null;
    this.#articleCatalog?.dispose();
    this.#articleCatalog = null;
    this.#consoleLeaf = null;
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  async setLanguage(language: GalleySettings["language"]): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, language });
    await this.saveData(this.settings);
    this.#locale?.configure(language);
  }

  async openGalleyConsole(route: ConsoleRoute = "home"): Promise<void> {
    const workspace = this.app.workspace;
    const leaves = workspace.getLeavesOfType?.(GALLEY_CONSOLE_VIEW_TYPE) ?? [];
    const managed = this.#consoleLeaf && leaves.includes(this.#consoleLeaf)
      ? this.#consoleLeaf
      : null;
    if (managed) {
      const view = managed.view as unknown as {
        resetHome?: () => Promise<void> | void;
        navigate?: (next: ConsoleRoute) => Promise<void> | void;
      };
      if (route === "home") await view.resetHome?.();
      else await view.navigate?.(route);
      await workspace.revealLeaf(managed);
      return;
    }

    const supportsRightSidebar = typeof workspace.getRightLeaf === "function";
    if (supportsRightSidebar) {
      workspace.detachLeavesOfType?.(GALLEY_CONSOLE_VIEW_TYPE);
    }
    const rightLeaf = workspace.getRightLeaf?.(false) ?? null;
    if (!supportsRightSidebar && !rightLeaf) {
      const existing = leaves[0];
      if (existing) {
        const view = existing.view as unknown as {
          resetHome?: () => Promise<void> | void;
          navigate?: (next: ConsoleRoute) => Promise<void> | void;
        };
        if (route === "home") await view.resetHome?.();
        else await view.navigate?.(route);
        await workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf = rightLeaf ?? workspace.getLeaf("tab");
    await leaf.setViewState({
      type: GALLEY_CONSOLE_VIEW_TYPE,
      state: { route },
      active: true
    });
    this.#consoleLeaf = leaf;
    await workspace.revealLeaf(leaf);
  }

  async checkGenerationAgentAvailability(): Promise<void> {
    if (!this.canGenerate) return;
    await (await this.#desktopRuntime()).runAndReportDiagnostic(
      this.#desktopHost()
    );
  }

  async runGenerateCurrentArticle(): Promise<void> {
    if (!this.canGenerate || !this.#generationTask) return;
    const active = this.app.workspace.getActiveFile?.();
    const taskId = this.#generationTask.start({
      ...(active?.extension?.toLowerCase() === "md"
        ? { sourcePath: active.path }
        : {})
    });
    if (typeof this.app.workspace.getLeaf === "function") {
      await this.openGalleyConsole("generation");
    }
    await this.#generationTask.wait(taskId);
  }

  async openGalleyDocument(path: string): Promise<void> {
    if (!this.capabilities.canEdit || !isGalleyHtmlPath(path)) return;
    await (await this.#desktopViewRegistry()).openWorkbench(this.app, path);
  }

  async openGalleyPreview(path: string): Promise<void> {
    if (!isGalleyPreviewPath(path)) return;
    const workspace = this.app.workspace;
    if (!workspace || typeof workspace.getLeaf !== "function") return;
    await openGalleyPreview(workspace, path);
  }

  async openThemeLab(): Promise<void> {
    if (!this.canGenerate) return;
    await (await this.#desktopViewRegistry()).openThemeLab(this.app);
  }

  async exportCustomTheme(): Promise<void> {
    await this.openGalleyConsole("themes");
  }

  async toggleCustomTheme(): Promise<void> {
    await this.openGalleyConsole("themes");
  }

  async deleteCustomTheme(): Promise<void> {
    await this.openGalleyConsole("themes");
  }

  #registerCommands(): void {
    this.addCommand({
      id: "open-galley-console",
      name: "Open console / 打开控制台",
      callback: () => this.openGalleyConsole()
    });
    this.addCommand({
      id: "show-capabilities",
      name: "Show capabilities / 显示能力",
      callback: () => new Notice(JSON.stringify(this.capabilities, null, 2))
    });
    this.addCommand({
      id: "open-current-galley-preview",
      name: "Preview current document / 预览当前文档",
      checkCallback: (checking) => {
        const path = this.#activeGalleyPath();
        if (!path) return false;
        if (!checking) void this.openGalleyPreview(path);
        return true;
      }
    });
    if (!this.canGenerate) return;
    this.addCommand({
      id: "open-current-galley-in-workbench",
      name: "Open current document in workbench / 在工作台打开当前文档",
      checkCallback: (checking) => {
        const path = this.#activeGalleyPath();
        if (!path) return false;
        if (!checking) void this.openGalleyDocument(path);
        return true;
      }
    });
    this.addCommand({
      id: "check-generation-agent-availability",
      name: "Check agent availability / 检查 agent 可用性",
      callback: () => this.checkGenerationAgentAvailability()
    });
    this.addCommand({
      id: "generate-current-article",
      name: "Generate current article / 生成当前文章",
      callback: () => this.runGenerateCurrentArticle()
    });
    this.addCommand({
      id: "open-theme-lab",
      name: "Open theme lab / 打开主题实验室",
      callback: () => this.openThemeLab()
    });
    for (const [id, name, route] of [
      ["theme-export-zip", "Galley Studio: Export theme / 导出主题", "themes"],
      ["theme-toggle-enabled", "Galley Studio: Enable or disable theme / 启用或停用主题", "themes"],
      ["theme-delete", "Galley Studio: Delete theme / 删除主题", "themes"]
    ] as const) {
      this.addCommand({
        id,
        name,
        callback: () => this.openGalleyConsole(route)
      });
    }
  }

  #createActions(desktop?: DesktopGalleyActions): GalleyActions {
    return createGalleyActions({
      inspectActiveContext: async () => {
        const active = this.app.workspace.getActiveFile?.();
        if (!active) return { kind: "empty" };
        if (isGalleyHtmlPath(active.path)) {
          return { kind: "galley", path: active.path, name: active.name };
        }
        if (active.extension?.toLowerCase() === "md") {
          const markdown = await this.app.vault.read(active);
          return {
            kind: "markdown",
            path: active.path,
            name: active.name,
            words: markdown.trim() ? markdown.trim().split(/\s+/u).length : 0,
            characters: [...markdown].length
          };
        }
        return { kind: "empty" };
      },
      listArticles: () =>
        this.#articleCatalog?.snapshot() ??
        Promise.resolve({ documents: [], unavailable: [] }),
      openPreview: (path) => this.openGalleyPreview(path),
      ...(desktop
        ? {
            desktop,
            generate: (input: Parameters<GalleyActions["generateActiveMarkdown"]>[0], signal: AbortSignal) =>
              this.#desktopRuntime().then((runtime) =>
                runtime.generateActiveMarkdown(this.#desktopHost(), input, signal)
              )
          }
        : {}),
      saveLanguage: async (language) => {
        this.settings = normalizeSettings({ ...this.settings, language });
        await this.saveData(this.settings);
      },
      publishLanguage: (language) => this.#locale?.configure(language)
    });
  }

  #lazyDesktopActions(): DesktopGalleyActions {
    const actions = () =>
      this.#desktopRuntime().then((runtime) =>
        runtime.createDesktopActions(this.#desktopHost())
      );
    return {
      openWorkbench: (path) => this.openGalleyDocument(path),
      openThemeLab: () => this.openThemeLab(),
      listThemes: async () => (await actions()).listThemes?.() ?? [],
      exportTheme: async (id) => {
        const result = await (await actions()).exportTheme?.(id);
        if (!result) throw new Error("Theme export did not return an artifact.");
        return result;
      },
      setThemeEnabled: async (id, enabled) =>
        (await actions()).setThemeEnabled?.(id, enabled),
      deleteTheme: async (id) => (await actions()).deleteTheme?.(id) ?? false,
      listExportConfigurations: async () =>
        (await actions()).listExportConfigurations?.() ?? [],
      saveExportConfiguration: async (value) => {
        const result = await (await actions()).saveExportConfiguration?.(value);
        if (!result) throw new Error("Export configuration was not saved.");
        return result;
      },
      deleteExportConfiguration: async (id) =>
        (await actions()).deleteExportConfiguration?.(id),
      readSettings: async () => {
        const result = await (await actions()).readSettings?.();
        if (!result) throw new Error("Settings are unavailable.");
        return result;
      },
      listSecrets: async () => (await actions()).listSecrets?.() ?? [],
      saveSettings: async (value) => {
        const result = await (await actions()).saveSettings?.(value);
        if (!result) throw new Error("Settings were not saved.");
        return result;
      },
      runDiagnostic: async (signal) => {
        const result = await (await actions()).runDiagnostic?.(signal);
        if (!result) throw new Error("Diagnostic is unavailable.");
        return result;
      }
    };
  }

  #createConsoleView(leaf: WorkspaceLeaf): GalleyConsoleView {
    if (!this.#actions || !this.#locale) {
      throw new Error("Galley Studio console services are not initialized.");
    }
    return new GalleyConsoleView(leaf, {
      actions: this.#actions,
      locale: this.#locale,
      mobile: !this.capabilities.canEdit,
      subscribeContext: (listener) => {
        const workspace = this.app.workspace;
        if (typeof workspace.on !== "function") return () => undefined;
        const ref = workspace.on("file-open", listener);
        return () => workspace.offref?.(ref);
      },
      subscribeArticles: (listener) =>
        this.#articleCatalog?.subscribe(listener) ?? (() => undefined),
      ...(this.#generationTask ? { generationTask: this.#generationTask } : {})
    });
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
      resourceResolver,
      locale: this.localizedText
    });
  }

  #registerGalleyFileMenu(): void {
    const workspace = this.app.workspace;
    if (!workspace || typeof workspace.on !== "function") return;
    this.registerEvent(
      workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (isFolder(file) || !isGalleyHtmlPath(file.path)) return;
        if (this.capabilities.canEdit) {
          menu.addItem((item) =>
            item
              .setTitle(this.localizedText.t("fileMenu.workbench"))
              .setIcon("layout-dashboard")
              .onClick(() => this.openGalleyDocument(file.path))
          );
        }
        menu.addItem((item) =>
          item
            .setTitle(this.localizedText.t("fileMenu.preview"))
            .setIcon("eye")
            .onClick(() => this.openGalleyPreview(file.path))
        );
      })
    );
  }

  #activeGalleyPath(): string | null {
    const active = this.app.workspace?.getActiveFile?.();
    return active && isGalleyHtmlPath(active.path) ? active.path : null;
  }

  #opener(): ObsidianDocumentSessionOpener {
    this.#documentOpener ??= new ObsidianDocumentSessionOpener(this.app.vault);
    return this.#documentOpener;
  }

  #catalogVault(): ArticleCatalogVault {
    const vault = (this.app.vault ?? {}) as unknown as Partial<ArticleCatalogVault>;
    return {
      getFiles: () => vault.getFiles?.() ?? [],
      read: (file) =>
        vault.read?.(file) ?? Promise.reject(new Error("Vault read unavailable.")),
      on: (event, callback) => vault.on?.(event, callback) ?? {},
      offref: (ref) => vault.offref?.(ref)
    };
  }

  #desktopHost() {
    return {
      app: this.app,
      capabilities: this.capabilities,
      locale: this.localizedText,
      getSettings: () => this.settings,
      replaceSettings: (settings: GalleySettings) => {
        this.settings = settings;
      },
      loadData: () => this.loadData(),
      saveData: (value: unknown) => this.saveData(value),
      saveSettings: () => this.saveSettings()
    };
  }

  #desktopRuntime() {
    return import("./platform/DesktopConsoleRuntime");
  }

  #desktopViewRegistry() {
    return import("./platform/DesktopViewRegistry");
  }

  #obsidianLocale(): string | undefined {
    const locale = (this.app as unknown as { locale?: unknown }).locale;
    return typeof locale === "string"
      ? locale
      : document.documentElement.lang || undefined;
  }
}

function isGalleyHtmlPath(path: string): boolean {
  return isNormalizedVaultRelativePath(path) && path.endsWith(".html");
}

function isFolder(file: TAbstractFile): boolean {
  return "children" in file;
}
