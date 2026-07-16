import type {
  GalleyActions,
  SettingsSnapshot,
  SkillSummary,
  ThemeSummary
} from "./GalleyActions";
import type {
  ActiveContext,
  ArticleCatalogSnapshot,
  ConsoleRoute,
  GenerateArticleFormInput
} from "./ConsoleTypes";
import type { MessageKey } from "../i18n/Resources";
import type { GenerationStage } from "../generation/GenerationProgress";
import type { GenerationTaskController } from "../generation/GenerationTask";
import { createThemePreview } from "./ThemePreview";

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
  readonly reportProgress: (stage: GenerationStage) => void;
  readonly generationTask?: GenerationTaskController;
  readonly startGeneration: (input: GenerateArticleFormInput) => Promise<void>;
}

interface HomeManagementSnapshot {
  readonly settings?: SettingsSnapshot;
  readonly themes: readonly ThemeSummary[];
  readonly skills: readonly SkillSummary[];
  readonly secretAvailable: boolean;
}

export async function renderConsoleHome(
  container: HTMLElement,
  environment: ConsoleHomeEnvironment
): Promise<void> {
  const { actions, text, mobile, state } = environment;
  const context = await safeContext(actions);
  const management = mobile ? emptyManagement() : await safeManagement(actions);
  const section = document.createElement("section");
  section.className = "galley-console__task";
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = text.t("console.home.title");
  section.append(heading);
  const introduction = appendText(section, text.t("console.home.description"));
  introduction.className = "galley-console__lead";

  if (context.kind === "markdown" && !mobile) {
    const source = document.createElement("div");
    source.className = "galley-console__source";
    const sourceCopy = document.createElement("div");
    const sourceLabel = appendText(sourceCopy, text.t("console.home.context.markdown"));
    sourceLabel.className = "galley-console__eyebrow";
    const sourceName = appendText(sourceCopy, context.name);
    sourceName.className = "galley-console__source-name";
    source.append(sourceCopy);
    const metrics = appendText(
      source,
      text.t("console.home.metrics", {
        words: context.words ?? 0,
        characters: context.characters ?? 0
      })
    );
    metrics.className = "galley-console__source-metrics";
    section.append(source);

    const enabledThemes = management.themes.filter(({ enabled }) => enabled);
    const activeSkill = management.skills.find(({ active }) => active)?.version
      ?? management.settings?.activeSkillVersion;
    const readiness = document.createElement("div");
    readiness.className = "galley-console__readiness";
    const generationAgent = management.settings?.generationAgent ?? "plugin";
    const agentName = generationAgent === "codex-cli"
      ? text.t("console.settings.agent.codex")
      : generationAgent === "claude-cli"
        ? text.t("console.settings.agent.claude")
        : `${text.t("console.settings.agent.plugin")}${management.settings?.model ? ` · ${management.settings.model}` : ""}`;
    readiness.append(
      readinessItem(
        text.t("console.home.readiness.agent"),
        agentName
      ),
      readinessItem(
        text.t("console.home.readiness.skill"),
        activeSkill || text.t("console.home.readiness.missing")
      ),
      readinessItem(
        text.t("console.home.readiness.themes"),
        String(enabledThemes.length)
      )
    );
    section.append(readiness);

    const task = environment.generationTask?.snapshot();
    if (task && task.status !== "idle") {
      const taskNotice = document.createElement("button");
      taskNotice.type = "button";
      taskNotice.dataset.action = "view-generation";
      taskNotice.className = "galley-console__generation-task";
      taskNotice.textContent = task.status === "running"
        ? text.t("console.generation.backgroundHint")
        : text.t("console.generation.completed", {
            path: task.result?.htmlPath ?? task.sourcePath ?? ""
          });
      taskNotice.addEventListener("click", () => void environment.navigate("generation"));
      section.append(taskNotice);
    }

    const form = document.createElement("form");
    form.className = "galley-console__generate-form";
    if (enabledThemes.length) {
      form.append(themePicker(enabledThemes, state, text));
    } else {
      const missingThemes = appendText(
        form,
        text.t("console.home.themesUnavailable")
      );
      missingThemes.className = "galley-console__inline-error";
    }
    const actionsRow = document.createElement("div");
    actionsRow.className = "galley-console__primary-actions";
    const submit = button(text.t("console.action.generate"), "generate");
    submit.classList.add("mod-cta", "galley-console__generate");
    submit.type = "submit";
    const configured = Boolean(
      management.settings &&
      (management.settings.generationAgent === "plugin"
        ? management.settings.model.trim() && management.secretAvailable
        : management.settings.generationAgent === "codex-cli"
          ? management.settings.codexCliPath.trim()
          : management.settings.claudeCliPath.trim()) &&
      enabledThemes.length
    );
    submit.disabled = !configured || task?.status === "running";
    const settings = routeButton(
      environment,
      "settings",
      text.t("console.home.checkSettings")
    );
    settings.classList.add("galley-console__secondary-action");
    actionsRow.append(submit, settings);
    form.append(actionsRow);
    if (!configured) {
      const reason = appendText(form, text.t("console.home.notReady"));
      reason.className = "galley-console__form-help";
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!configured || !state.themeId) return;
      void environment.startGeneration({
        themeId: state.themeId,
        sourcePath: context.path
      });
    });
    section.append(form);
  } else if (context.kind === "galley") {
    const source = document.createElement("div");
    source.className = "galley-console__source";
    const sourceCopy = document.createElement("div");
    const sourceLabel = appendText(sourceCopy, text.t("console.home.context.galley"));
    sourceLabel.className = "galley-console__eyebrow";
    const sourceName = appendText(sourceCopy, context.name);
    sourceName.className = "galley-console__source-name";
    source.append(sourceCopy);
    const action = button(
      text.t(mobile ? "common.action.preview" : "console.action.openWorkbench"),
      mobile ? "preview" : "edit"
    );
    action.classList.add("mod-cta");
    action.addEventListener("click", () => {
      void environment.run(mobile ? "preview" : "edit", async () => {
        if (mobile) await actions.openPreview(context.path);
        else await actions.desktop?.openWorkbench(context.path);
      });
    });
    source.append(action);
    section.append(source);
  } else if (context.kind === "markdown") {
    const source = document.createElement("div");
    source.className = "galley-console__source";
    appendText(source, context.name).className = "galley-console__source-name";
    section.append(source);
  } else {
    const empty = appendText(section, text.t("console.home.context.empty"));
    empty.className = "galley-console__empty";
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
  const recent = document.createElement("section");
  recent.className = "galley-console__recent";
  const recentHeader = document.createElement("div");
  recentHeader.className = "galley-console__section-header";
  appendHeading(recentHeader, text.t("console.home.recent"), 2);
  const allArticles = routeButton(
    environment,
    "articles",
    text.t("console.home.viewAll")
  );
  allArticles.classList.add("galley-console__text-action");
  recentHeader.append(allArticles);
  recent.append(recentHeader);
  if (!catalog.documents.length) {
    const empty = appendText(recent, text.t("console.home.recent.empty"));
    empty.className = "galley-console__empty";
  } else {
    const list = document.createElement("div");
    list.className = "galley-console__article-list";
    for (const article of catalog.documents.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = "galley-console__article-row";
      const details = document.createElement("div");
      appendText(details, article.htmlPath).className = "galley-console__article-name";
      appendText(details, text.t("console.home.articleMeta", {
        theme: article.themeId,
        exports: article.exportCount
      })).className = "galley-console__article-meta";
      const rowActions = document.createElement("div");
      rowActions.className = "galley-console__row-actions";
      const preview = button(text.t("common.action.preview"), "preview");
      preview.addEventListener("click", () =>
        void environment.run("preview", () => actions.openPreview(article.htmlPath))
      );
      const edit = button(text.t("common.action.continue"), "continue-edit");
      edit.addEventListener("click", () =>
        void environment.run("continue-edit", () =>
          actions.desktop!.openWorkbench(article.htmlPath)
        )
      );
      rowActions.append(preview, edit);
      row.append(details, rowActions);
      list.append(row);
    }
    recent.append(list);
  }
  container.append(recent);

}

function themePicker(
  themes: readonly ThemeSummary[],
  state: ConsoleHomeState,
  text: ConsolePageText
): HTMLFieldSetElement {
  if (!state.themeId || !themes.some(({ id }) => id === state.themeId)) {
    state.themeId = themes[0]?.id ?? "";
  }
  const fieldset = document.createElement("fieldset");
  fieldset.className = "galley-console__theme-picker";
  const legend = document.createElement("legend");
  legend.textContent = text.t("console.home.theme");
  fieldset.append(legend);
  const grid = document.createElement("div");
  grid.className = "galley-console__theme-grid";
  themes.forEach((theme, index) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "themeId";
    input.id = `galley-theme-${index}`;
    input.value = theme.id;
    input.checked = theme.id === state.themeId;
    input.addEventListener("change", () => {
      if (input.checked) state.themeId = theme.id;
    });
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.dataset.themeId = theme.id;
    label.append(createThemePreview(
      theme.id,
      theme.name,
      text.t("console.themes.preview", { theme: theme.name })
    ));
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = theme.name;
    const id = document.createElement("small");
    id.textContent = theme.id;
    copy.append(name, id);
    label.append(copy);
    grid.append(input, label);
  });
  fieldset.append(grid);
  return fieldset;
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

async function safeManagement(actions: GalleyActions): Promise<HomeManagementSnapshot> {
  const runtime = actions.desktop;
  if (!runtime) return emptyManagement();
  const [settings, themes, skills, secrets] = await Promise.all([
    runtime.readSettings?.().catch(() => undefined),
    runtime.listThemes?.().catch(() => []),
    runtime.listSkills?.().catch(() => []),
    runtime.listSecrets?.().catch(() => [])
  ]);
  return {
    ...(settings ? { settings } : {}),
    themes: themes ?? [],
    skills: skills ?? [],
    secretAvailable: Boolean(
      settings?.secretId && (secrets ?? []).includes(settings.secretId)
    )
  };
}

function emptyManagement(): HomeManagementSnapshot {
  return { themes: [], skills: [], secretAvailable: false };
}

function readinessItem(label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  const name = document.createElement("span");
  name.textContent = label;
  const current = document.createElement("strong");
  current.textContent = value;
  item.append(name, current);
  return item;
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
