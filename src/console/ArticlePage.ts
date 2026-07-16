import type { GalleyActions } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";
import type { UnavailableArticleReason } from "./ConsoleTypes";
import type { MessageKey } from "../i18n/Resources";

const UNAVAILABLE_REASON_KEYS: Readonly<Record<UnavailableArticleReason, MessageKey>> = {
  missing_sidecar: "console.unavailable.missingSidecar",
  missing_html: "console.unavailable.missingHtml",
  invalid_sidecar: "console.unavailable.invalidSidecar",
  invalid_document: "console.unavailable.invalidDocument",
  html_hash_mismatch: "console.unavailable.hashMismatch",
  unreadable: "console.unavailable.unreadable"
};

export interface ArticlePageState {
  query: string;
}

export async function ArticlePage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    mobile: boolean;
    state: ArticlePageState;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = options.text.t("console.articles.title");
  container.append(heading);
  if (options.mobile) appendText(container, options.text.t("console.mobile.previewOnly"));

  const search = document.createElement("input");
  search.type = "search";
  search.value = options.state.query;
  search.placeholder = options.text.t("console.articles.search");
  search.setAttribute("aria-label", options.text.t("console.articles.search"));
  search.className = "galley-console__article-search";
  container.append(search);

  const snapshot = await options.actions.listArticles();
  const table = document.createElement("table");
  table.className = "galley-console__table";
  const body = document.createElement("tbody");
  table.append(body);
  const renderRows = () => {
    options.state.query = search.value;
    body.replaceChildren();
    const query = options.state.query.trim().toLocaleLowerCase();
    const articles = snapshot.documents.filter((article) =>
      `${article.htmlPath}\n${article.sourcePath}\n${article.themeId}`
        .toLocaleLowerCase()
        .includes(query)
    );
    for (const article of articles) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = article.htmlPath;
      const actions = document.createElement("td");
      const preview = button(options.text.t("common.action.preview"), "preview");
      preview.addEventListener("click", () =>
        void options.run("preview", () => options.actions.openPreview(article.htmlPath))
      );
      actions.append(preview);
      if (!options.mobile && options.actions.desktop) {
        const edit = button(options.text.t("common.action.edit"), "edit");
        edit.addEventListener("click", () =>
          void options.run("edit", () => options.actions.desktop!.openWorkbench(article.htmlPath))
        );
        actions.append(edit);
      }
      row.append(name, actions);
      body.append(row);
    }
    for (const unavailable of snapshot.unavailable) {
      const row = document.createElement("tr");
      row.className = "galley-console__unavailable";
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent = `${unavailable.path} - ${options.text.t("console.unavailable", {
        reason: options.text.t(UNAVAILABLE_REASON_KEYS[unavailable.reason])
      })}`;
      row.append(cell);
      body.append(row);
    }
    if (!body.childElementCount) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.textContent = options.text.t("console.articles.empty");
      row.append(cell);
      body.append(row);
    }
  };
  search.addEventListener("input", renderRows);
  renderRows();
  container.append(table);
}
