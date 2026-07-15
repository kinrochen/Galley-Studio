import {
  Platform,
  Plugin,
  Notice,
  type Menu,
  type TAbstractFile,
  type WorkspaceLeaf
} from "obsidian";
import { MAX_SKILL_ARCHIVE_BYTES } from "./archive/ArchiveLimits";
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
  LAZY_THEME_LAB_VIEW_TYPE,
  LAZY_WORKBENCH_VIEW_TYPE,
  LazyDesktopView
} from "./platform/LazyDesktopView";
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

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);
  readonly capabilities: PlatformCapabilities = derivePlatformCapabilities(
    Platform.isMobileApp
  );
  readonly #generationControllers = new Set<AbortController>();
  #documentOpener: ObsidianDocumentSessionOpener | null = null;
  #locale: LocaleStore | null = null;
  #unsubscribeRibbonLocale: (() => void) | null = null;
  #articleCatalog: ArticleCatalog | null = null;
  #actions: GalleyActions | null = null;

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
      this.registerView(
        LAZY_THEME_LAB_VIEW_TYPE,
        (leaf) => new LazyDesktopView(leaf, "theme-lab", host, this.localizedText)
      );
      this.registerView(
        LAZY_WORKBENCH_VIEW_TYPE,
        (leaf) => new LazyDesktopView(leaf, "workbench", host, this.localizedText)
      );
      desktop = this.#lazyDesktopActions();
    }
    this.#actions = this.#createActions(desktop);

    this.addSettingTab(new GalleySettingTab(this.app, this));
    this.registerView(GALLEY_CONSOLE_VIEW_TYPE, (leaf) =>
      this.#createConsoleView(leaf)
    );
    this.registerView(GALLEY_PREVIEW_VIEW_TYPE, (leaf) =>
      this.#createPreviewView(leaf)
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
    for (const controller of this.#generationControllers) controller.abort();
    this.#generationControllers.clear();
    this.#articleCatalog?.dispose();
    this.#articleCatalog = null;
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
    const existing = workspace.getLeavesOfType?.(GALLEY_CONSOLE_VIEW_TYPE)[0];
    if (existing) {
      const view = existing.view as unknown as {
        resetHome?: () => Promise<void> | void;
        navigate?: (next: ConsoleRoute) => Promise<void> | void;
      };
      if (route === "home") await view.resetHome?.();
      else await view.navigate?.(route);
      workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({
      type: GALLEY_CONSOLE_VIEW_TYPE,
      state: { route },
      active: true
    });
    workspace.revealLeaf(leaf);
  }

  async checkModelConnectionAndSkillLoading(): Promise<void> {
    if (!this.canGenerate) return;
    await (await this.#desktopRuntime()).runAndReportDiagnostic(
      this.#desktopHost()
    );
  }

  async runGenerateCurrentArticle(): Promise<void> {
    if (!this.canGenerate) return;
    const controller = new AbortController();
    this.#generationControllers.add(controller);
    try {
      await (await this.#desktopRuntime()).generateActiveMarkdown(
        this.#desktopHost(),
        {},
        controller.signal
      );
    } catch {
      // The typed generation adapter emits only allowlisted user notices.
    } finally {
      this.#generationControllers.delete(controller);
    }
  }

  async openGalleyDocument(path: string): Promise<void> {
    if (!this.capabilities.canEdit || !isGalleyHtmlPath(path)) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: LAZY_WORKBENCH_VIEW_TYPE,
      state: { path },
      active: true
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async openGalleyPreview(path: string): Promise<void> {
    if (!isGalleyPreviewPath(path)) return;
    const workspace = this.app.workspace;
    if (!workspace || typeof workspace.getLeaf !== "function") return;
    await openGalleyPreview(workspace, path);
  }

  async openThemeLab(): Promise<void> {
    if (!this.canGenerate) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: LAZY_THEME_LAB_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async importCustomTheme(): Promise<void> {
    await this.openGalleyConsole("themes");
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

  async importSkillPackage(): Promise<void> {
    if (!this.capabilities.canImportSkill) return;
    try {
      const bytes = await chooseZip(
        MAX_SKILL_ARCHIVE_BYTES,
        this.localizedText.t("console.skills.tooLarge"),
        this.localizedText.t("console.file.readFailed")
      );
      if (!bytes) return;
      const version = await this.#lazyDesktopActions().importSkill?.(bytes);
      if (version) {
        new Notice(
          this.localizedText.t("console.skills.importedInactive", { version })
        );
      }
    } catch (error) {
      new Notice(
        error instanceof Error && error.message
          ? error.message
          : this.localizedText.t("common.error.safe")
      );
    }
  }

  async activateImportedSkill(): Promise<void> {
    await this.openGalleyConsole("skills");
  }

  #registerCommands(): void {
    this.addCommand({
      id: "open-galley-console",
      name: "Galley: Open console / 打开控制台",
      callback: () => this.openGalleyConsole()
    });
    this.addCommand({
      id: "show-capabilities",
      name: "Galley: Show capabilities / 显示能力",
      callback: () => console.info("Galley capabilities", this.capabilities)
    });
    this.addCommand({
      id: "open-current-galley-preview",
      name: "Galley: Preview current document / 预览当前文档",
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
      name: "Galley: Open current document in workbench / 在工作台打开当前文档",
      checkCallback: (checking) => {
        const path = this.#activeGalleyPath();
        if (!path) return false;
        if (!checking) void this.openGalleyDocument(path);
        return true;
      }
    });
    this.addCommand({
      id: "check-model-connection-and-skill-loading",
      name: "Galley: Diagnostics / 诊断",
      callback: () => this.checkModelConnectionAndSkillLoading()
    });
    this.addCommand({
      id: "generate-current-article",
      name: "Galley: Generate current article / 生成当前文章",
      callback: () => this.runGenerateCurrentArticle()
    });
    this.addCommand({
      id: "open-theme-lab",
      name: "Galley: Open Theme Lab / 打开主题实验室",
      callback: () => this.openThemeLab()
    });
    for (const [id, name, route] of [
      ["theme-import-zip", "Galley: Themes / 主题管理", "themes"],
      ["theme-export-zip", "Galley: Export theme / 导出主题", "themes"],
      ["theme-toggle-enabled", "Galley: Enable or disable theme / 启用或停用主题", "themes"],
      ["theme-delete", "Galley: Delete theme / 删除主题", "themes"],
      ["skill-import-zip", "Galley: Skill / 技能管理", "skills"],
      ["skill-activate-imported", "Galley: Activate Skill / 激活技能", "skills"]
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
      importTheme: async (bytes) => {
        const result = await (await actions()).importTheme?.(bytes);
        if (!result) throw new Error("Theme import did not return an id.");
        return result;
      },
      exportTheme: async (id) => {
        const result = await (await actions()).exportTheme?.(id);
        if (!result) throw new Error("Theme export did not return an artifact.");
        return result;
      },
      setThemeEnabled: async (id, enabled) =>
        (await actions()).setThemeEnabled?.(id, enabled),
      deleteTheme: async (id) => (await actions()).deleteTheme?.(id) ?? false,
      listSkills: async () => (await actions()).listSkills?.() ?? [],
      importSkill: async (bytes) => {
        const result = await (await actions()).importSkill?.(bytes);
        if (!result) throw new Error("Skill import did not return a version.");
        return result;
      },
      activateSkill: async (version) => (await actions()).activateSkill?.(version),
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
      runDiagnostic: async (signal) =>
        (await actions()).runDiagnostic?.(signal)
    };
  }

  #createConsoleView(leaf: WorkspaceLeaf): GalleyConsoleView {
    if (!this.#actions || !this.#locale) {
      throw new Error("Galley console services are not initialized.");
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
        this.#articleCatalog?.subscribe(listener) ?? (() => undefined)
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

  #obsidianLocale(): string | undefined {
    const locale = (this.app as unknown as { locale?: unknown }).locale;
    return typeof locale === "string"
      ? locale
      : document.documentElement.lang || undefined;
  }
}

function isGalleyHtmlPath(path: string): boolean {
  return isNormalizedVaultRelativePath(path) && path.endsWith(".galley.html");
}

function isFolder(file: TAbstractFile): boolean {
  return "children" in file;
}

function chooseZip(
  maxBytes: number,
  tooLargeMessage: string,
  readFailedMessage: string
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        if (file.size > maxBytes) return reject(new Error(tooLargeMessage));
        void file.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new Error(readFailedMessage))
        );
      },
      { once: true }
    );
    input.click();
  });
}
