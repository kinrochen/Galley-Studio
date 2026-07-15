import type { GalleyActions } from "./GalleyActions";
import type {
  ActiveContext,
  ArticleCatalogSnapshot,
  ConsoleRoute
} from "./ConsoleTypes";
import type { MessageKey } from "../i18n/Resources";

export interface ConsolePageText {
  t(key: MessageKey, parameters?: Readonly<Record<string, string | number>>): string;
}

export interface ConsoleHomeState {
  themeId: string;
}

export interface ConsoleHomeEnvironment {
  readonly actions: GalleyActions;
  readonly text: ConsolePageText;
  readonly mobile: boolean;
  readonly state: ConsoleHomeState;
  readonly run: (
    operation: string,
    action: (signal: AbortSignal) => Promise<unknown>
  ) => Promise<void>;
  readonly navigate: (route: ConsoleRoute) => Promise<void>;
}

export async function renderConsoleHome(
  container: HTMLElement,
  environment: ConsoleHomeEnvironment
): Promise<void> {
  const { actions, text, mobile, state } = environment;
  const context = await safeContext(actions);
  const section = document.createElement("section");
  section.className = "galley-console__context galley-console__card";
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = text.t("console.home.title");
  section.append(heading);

  if (context.kind === "markdown" && !mobile) {
    appendHeading(section, text.t("console.home.context.markdown"), 2);
    appendText(section, context.name);
    if (context.words !== undefined || context.characters !== undefined) {
      appendText(
        section,
        text.t("console.home.metrics", {
          words: context.words ?? 0,
          characters: context.characters ?? 0
        })
      );
    }
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = text.t("console.home.theme");
    const input = document.createElement("input");
    input.name = "themeId";
    input.value = state.themeId;
    input.addEventListener("input", () => {
      state.themeId = input.value;
    });
    label.append(input);
    const submit = button(text.t("console.action.generate"), "generate");
    submit.type = "submit";
    form.append(label, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.themeId = input.value;
      void environment.run("generate", (signal) =>
        actions.generateActiveMarkdown(
          state.themeId.trim() ? { themeId: state.themeId.trim() } : {},
          signal
        )
      );
    });
    section.append(form);
  } else if (context.kind === "galley") {
    appendHeading(section, text.t("console.home.context.galley"), 2);
    appendText(section, context.name);
    const action = button(
      text.t(mobile ? "common.action.preview" : "console.action.openWorkbench"),
      mobile ? "preview" : "edit"
    );
    action.addEventListener("click", () => {
      void environment.run(mobile ? "preview" : "edit", async () => {
        if (mobile) await actions.openPreview(context.path);
        else await actions.desktop?.openWorkbench(context.path);
      });
    });
    section.append(action);
  } else {
    appendText(section, text.t("console.home.context.empty"));
    const openArticles = button(text.t("console.action.openArticles"), "articles");
    openArticles.addEventListener("click", () => void environment.navigate("articles"));
    section.append(openArticles);
  }
  container.append(section);

  if (mobile) {
    const note = document.createElement("p");
    note.className = "galley-console__mobile-note";
    note.textContent = text.t("console.mobile.previewOnly");
    container.append(note);
    return;
  }

  const catalog = await safeArticles(actions);
  const lower = document.createElement("div");
  lower.className = "galley-console__home-grid";

  const continueCard = card(lower, text.t("console.home.continue"));
  if (context.kind !== "empty") appendText(continueCard, context.name);
  continueCard.append(routeButton(environment, "articles", text.t("console.nav.articles")));

  const recent = card(lower, text.t("console.home.recent"));
  if (!catalog.documents.length) {
    appendText(recent, text.t("console.home.recent.empty"));
  } else {
    for (const article of catalog.documents.slice(0, 3)) {
      const open = button(article.htmlPath, "preview");
      open.addEventListener("click", () =>
        void environment.run("preview", () => actions.openPreview(article.htmlPath))
      );
      recent.append(open);
    }
  }

  const status = card(lower, text.t("console.home.status"));
  appendText(
    status,
    text.t("console.home.status.summary", {
      available: catalog.documents.length,
      unavailable: catalog.unavailable.length
    })
  );
  status.append(routeButton(environment, "settings", text.t("console.nav.settings")));

  const quick = card(lower, text.t("console.home.quick"));
  quick.append(
    routeButton(environment, "themes", text.t("console.nav.themes")),
    routeButton(environment, "exports", text.t("console.nav.exports"))
  );
  container.append(lower);
}

async function safeContext(actions: GalleyActions): Promise<ActiveContext> {
  try {
    return await actions.inspectActiveContext();
  } catch {
    return { kind: "empty" };
  }
}

async function safeArticles(actions: GalleyActions): Promise<ArticleCatalogSnapshot> {
  try {
    return await actions.listArticles();
  } catch {
    return { documents: [], unavailable: [] };
  }
}

function card(container: HTMLElement, title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "galley-console__card";
  appendHeading(section, title, 2);
  container.append(section);
  return section;
}

function routeButton(
  environment: ConsoleHomeEnvironment,
  route: ConsoleRoute,
  label: string
): HTMLButtonElement {
  const open = button(label, `open-${route}`);
  open.addEventListener("click", () => void environment.navigate(route));
  return open;
}

export function button(label: string, action: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.dataset.action = action;
  return element;
}

export function appendHeading(
  container: HTMLElement,
  value: string,
  level: 1 | 2 | 3
): HTMLHeadingElement {
  const heading = document.createElement(`h${level}`);
  heading.textContent = value;
  container.append(heading);
  return heading;
}

export function appendText(container: HTMLElement, value: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = value;
  container.append(paragraph);
  return paragraph;
}
