import { ItemView, type WorkspaceLeaf } from "obsidian";
import { generationFailureMessage } from "../commands/GenerateCurrentArticle";
import type { LocalizedText } from "../i18n/LocalizedText";
import type { MessageKey } from "../i18n/Resources";
import type { GenerationStage } from "../generation/GenerationProgress";
import { ArticlePage, type ArticlePageState } from "./ArticlePage";
import {
  renderConsoleHome,
  type ConsoleHomeState
} from "./ConsoleHome";
import {
  renderExportConfigurationPage,
  type ExportConfigurationFormState
} from "./ExportConfigurationPage";
import type { GalleyActions } from "./GalleyActions";
import { renderSettingsPage, type SettingsPageState } from "./SettingsPage";
import { renderSkillPage } from "./SkillPage";
import { renderThemePage } from "./ThemePage";
import {
  DESKTOP_CONSOLE_ROUTES,
  MOBILE_CONSOLE_ROUTES,
  type ConsoleRoute,
  type OperationState
} from "./ConsoleTypes";

export const GALLEY_CONSOLE_VIEW_TYPE = "galley-console";

export interface GalleyConsoleViewServices {
  readonly actions: GalleyActions;
  readonly locale: LocalizedText;
  readonly mobile: boolean;
  readonly subscribeContext?: (listener: () => void) => () => void;
  readonly subscribeArticles?: (listener: () => void) => () => void;
  readonly confirm?: (message: string) => boolean;
}

const NAV_KEYS: Readonly<Record<ConsoleRoute, MessageKey>> = {
  home: "console.nav.home",
  articles: "console.nav.articles",
  themes: "console.nav.themes",
  skills: "console.nav.skills",
  exports: "console.nav.exports",
  settings: "console.nav.settings"
};

interface ConsoleFormState {
  home: ConsoleHomeState;
  articles: ArticlePageState;
  exports: ExportConfigurationFormState;
  settings: SettingsPageState;
}

export class GalleyConsoleView extends ItemView {
  readonly #services: GalleyConsoleViewServices;
  readonly #unsubscribers: Array<() => void> = [];
  readonly #controllers = new Map<string, AbortController>();
  readonly #forms: ConsoleFormState = {
    home: { themeId: "" },
    articles: { query: "" },
    exports: {
      id: "",
      name: "",
      profileId: "standard-web",
      outputFolder: "",
      fileNameTemplate: "{stem}.html"
    },
    settings: {}
  };
  #route: ConsoleRoute = "home";
  #operation: OperationState = { status: "idle" };
  #opened = false;
  #closed = false;
  #renderVersion = 0;

  constructor(leaf: WorkspaceLeaf, services: GalleyConsoleViewServices) {
    super(leaf);
    this.#services = services;
    this.contentEl.classList.add("galley-console");
  }

  getViewType(): string {
    return GALLEY_CONSOLE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.#services.locale.t("console.title");
  }

  route(): ConsoleRoute {
    return this.#route;
  }

  getState(): { route: ConsoleRoute } {
    return { route: this.#route };
  }

  async setState(state: unknown): Promise<void> {
    if (
      typeof state === "object" &&
      state !== null &&
      "route" in state &&
      typeof state.route === "string" &&
      this.#allowedRoutes().includes(state.route as ConsoleRoute)
    ) {
      this.#route = state.route as ConsoleRoute;
    }
    if (this.#opened) await this.#render();
  }

  async onOpen(): Promise<void> {
    if (!this.#opened) {
      this.#opened = true;
      this.#unsubscribers.push(
        this.#services.locale.subscribe(() => void this.#render())
      );
      if (this.#services.subscribeContext) {
        this.#unsubscribers.push(
          this.#services.subscribeContext(() => {
            if (this.#route === "home") void this.#render();
          })
        );
      }
      if (this.#services.subscribeArticles) {
        this.#unsubscribers.push(
          this.#services.subscribeArticles(() => {
            if (this.#route === "articles" || this.#route === "home") {
              void this.#render();
            }
          })
        );
      }
    }
    await this.#render();
  }

  async onClose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
  }

  async resetHome(): Promise<void> {
    this.#route = "home";
    await this.#render();
  }

  async navigate(route: ConsoleRoute): Promise<void> {
    if (!this.#allowedRoutes().includes(route)) return;
    this.#route = route;
    await this.#render();
    this.contentEl.querySelector<HTMLElement>("main h1")?.focus();
  }

  async #render(): Promise<void> {
    if (this.#closed) return;
    const version = ++this.#renderVersion;
    const fragment = document.createDocumentFragment();
    const header = document.createElement("header");
    header.className = "galley-console__header";
    const brand = document.createElement("div");
    brand.className = "galley-console__wordmark";
    brand.textContent = this.#services.locale.t("console.title");
    const language = this.#languageSwitch();
    header.append(brand, language);
    fragment.append(header, this.#navigation());

    const main = document.createElement("main");
    main.className = "galley-console__main";
    const operationRegion = this.#statusRegion();
    main.append(operationRegion);
    try {
      await this.#renderPage(main);
    } catch {
      const error = document.createElement("div");
      error.setAttribute("role", "alert");
      error.tabIndex = -1;
      error.textContent = this.#services.locale.t("common.error.safe");
      main.append(error);
    }
    this.#applyOperationState(main);
    fragment.append(main);
    if (version !== this.#renderVersion || this.#closed) return;
    this.contentEl.replaceChildren(fragment);
  }

  async #renderPage(main: HTMLElement): Promise<void> {
    const shared = {
      actions: this.#services.actions,
      text: this.#services.locale,
      mobile: this.#services.mobile,
      run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) =>
        this.#run(operation, action),
      navigate: (route: ConsoleRoute) => this.navigate(route),
      reportProgress: (stage: GenerationStage) => this.#reportProgress(stage),
      confirm: this.#services.confirm ?? ((message: string) => window.confirm(message))
    };
    switch (this.#route) {
      case "home":
        await renderConsoleHome(main, { ...shared, state: this.#forms.home });
        return;
      case "articles":
        await ArticlePage(main, { ...shared, state: this.#forms.articles });
        return;
      case "themes":
        await renderThemePage(main, shared);
        return;
      case "skills":
        await renderSkillPage(main, shared);
        return;
      case "exports":
        await renderExportConfigurationPage(main, {
          ...shared,
          state: this.#forms.exports
        });
        return;
      case "settings":
        await renderSettingsPage(main, {
          ...shared,
          state: this.#forms.settings
        });
    }
  }

  #navigation(): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "galley-console__nav";
    navigation.setAttribute("role", "tablist");
    for (const route of this.#allowedRoutes()) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(route === this.#route));
      tab.tabIndex = route === this.#route ? 0 : -1;
      tab.textContent = this.#services.locale.t(NAV_KEYS[route]);
      tab.addEventListener("click", () => void this.navigate(route));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const routes = this.#allowedRoutes();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const index = routes.indexOf(route);
        const next = routes[(index + direction + routes.length) % routes.length];
        if (next) void this.navigate(next);
      });
      navigation.append(tab);
    }
    return navigation;
  }

  #languageSwitch(): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "galley-console__language";
    select.setAttribute("aria-label", this.#services.locale.t("console.language.aria"));
    for (const [value, key] of [
      ["auto", "common.language.auto"],
      ["zh-CN", "common.language.zh"],
      ["en", "common.language.en"]
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.#services.locale.t(key);
      select.append(option);
    }
    select.value = this.#services.locale.configuredLanguage();
    select.addEventListener("change", () => {
      const language = select.value;
      if (language === "auto" || language === "zh-CN" || language === "en") {
        void this.#services.actions
          .setLanguage(language)
          .then(() => this.#render())
          .catch(() => {
            this.#operation = {
              status: "error",
              message: this.#services.locale.t("common.error.safe")
            };
            void this.#render();
          });
      }
    });
    return select;
  }

  #statusRegion(): HTMLElement {
    const region = document.createElement("div");
    region.className = "galley-console__status";
    region.setAttribute(
      "role",
      this.#operation.status === "error" ? "alert" : "status"
    );
    region.setAttribute("aria-live", "polite");
    if (this.#operation.status === "idle") {
      region.hidden = true;
    } else if (this.#operation.status === "loading") {
      region.textContent = this.#operation.message ?? this.#services.locale.t(
        this.#operation.operation === "generate"
          ? "generation.status.inProgress"
          : "common.status.loading"
      );
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.dataset.action = "cancel";
      cancel.textContent = this.#services.locale.t("common.action.cancel");
      cancel.addEventListener("click", () =>
        this.#controllers.get(this.#operation.status === "loading" ? this.#operation.operation : "")?.abort()
      );
      region.append(cancel);
    } else {
      region.textContent = this.#operation.message;
    }
    return region;
  }

  async #run(
    operation: string,
    action: (signal: AbortSignal) => Promise<unknown>
  ): Promise<void> {
    this.#controllers.get(operation)?.abort();
    const controller = new AbortController();
    this.#controllers.set(operation, controller);
    this.#operation = { status: "loading", operation };
    await this.#render();
    try {
      const result = await action(controller.signal);
      if (controller.signal.aborted) {
        this.#operation = { status: "idle" };
      } else if (isPartialSuccess(result)) {
        this.#operation = {
          status: "partial-success",
          path: result.htmlPath,
          message: this.#services.locale.t("common.status.partial", {
            path: result.htmlPath
          })
        };
      } else if (isGeneratedArticle(result)) {
        this.#operation = {
          status: "success",
          message: this.#services.locale.t("generation.status.complete", {
            path: result.htmlPath
          })
        };
      } else {
        this.#operation = {
          status: "success",
          message: this.#services.locale.t("common.status.complete")
        };
      }
    } catch (error) {
      this.#operation = controller.signal.aborted
        ? { status: "idle" }
        : {
            status: "error",
            message: operation === "generate"
              ? generationFailureMessage(
                  error,
                  controller.signal,
                  this.#services.locale
                )
              : this.#services.locale.t("common.error.safe")
          };
    } finally {
      if (this.#controllers.get(operation) === controller) {
        this.#controllers.delete(operation);
      }
      await this.#render();
      if (this.#operation.status === "error") {
        this.contentEl.querySelector<HTMLElement>('[role="alert"]')?.focus();
      }
    }
  }

  #applyOperationState(main: HTMLElement): void {
    if (this.#operation.status !== "loading") return;
    for (const control of main.querySelectorAll<
      HTMLButtonElement | HTMLInputElement
    >("[data-action]")) {
      if (control.dataset.action !== this.#operation.operation) continue;
      control.disabled = true;
      control.setAttribute("aria-busy", "true");
    }
  }

  #reportProgress(stage: GenerationStage): void {
    if (
      this.#operation.status !== "loading" ||
      this.#operation.operation !== "generate"
    ) return;
    const keys: Readonly<Record<GenerationStage, MessageKey>> = {
      reading: "generation.status.reading",
      "loading-skill": "generation.status.loadingSkill",
      generating: "generation.status.generating",
      validating: "generation.status.validating",
      saving: "generation.status.saving"
    };
    this.#operation = {
      status: "loading",
      operation: "generate",
      message: this.#services.locale.t(keys[stage])
    };
    void this.#render();
  }

  #allowedRoutes(): readonly ConsoleRoute[] {
    return this.#services.mobile
      ? (MOBILE_CONSOLE_ROUTES as readonly ConsoleRoute[])
      : DESKTOP_CONSOLE_ROUTES;
  }
}

function isPartialSuccess(
  value: unknown
): value is { readonly status: "partial-success"; readonly htmlPath: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "partial-success" &&
    "htmlPath" in value &&
    typeof value.htmlPath === "string"
  );
}

function isGeneratedArticle(
  value: unknown
): value is { readonly status: "committed"; readonly htmlPath: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "committed" &&
    "htmlPath" in value &&
    typeof value.htmlPath === "string"
  );
}
