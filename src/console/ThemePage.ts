import type { GalleyActions } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";
import { createThemePreview } from "./ThemePreview";

export async function renderThemePage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    confirm: (message: string) => boolean | Promise<boolean>;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  heading(container, options.text.t("console.themes.title"));
  appendText(container, options.text.t("console.themes.description"))
    .className = "galley-console__lead";
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const controls = document.createElement("div");
  controls.className = "galley-console__page-actions";
  const themeLab = button(options.text.t("console.action.openThemeLab"), "theme-lab");
  themeLab.addEventListener("click", () =>
    void options.run("theme-lab", async () => runtime.openThemeLab?.())
  );
  controls.append(themeLab);
  container.append(controls);
  const themes = (await runtime.listThemes?.()) ?? [];
  if (!themes.length) {
    appendText(container, options.text.t("console.themes.empty"))
      .className = "galley-console__empty";
    return;
  }
  const grid = document.createElement("div");
  grid.className = "galley-console__theme-library";
  for (const theme of themes) {
    const row = document.createElement("section");
    row.className = "galley-console__theme-item";
    row.dataset.themeId = theme.id;
    const details = document.createElement("div");
    details.className = "galley-console__theme-details";
    const preview = createThemePreview(
      theme.id,
      theme.name,
      options.text.t("console.themes.preview", { theme: theme.name })
    );
    const name = document.createElement("h2");
    name.textContent = theme.name;
    const id = appendText(details, theme.id);
    id.className = "galley-console__theme-id";
    details.prepend(name);
    const kind = appendText(
      details,
      options.text.t(
        theme.builtIn ? "console.themes.builtIn" : "console.themes.custom"
      )
    );
    kind.className = "galley-console__theme-kind";
    row.append(preview, details);
    if (!theme.builtIn) {
      const actions = document.createElement("div");
      actions.className = "galley-console__row-actions";
      const toggle = button(
        options.text.t(theme.enabled ? "console.themes.disable" : "console.themes.enable"),
        "theme-toggle"
      );
      toggle.addEventListener("click", () =>
        void options.run("theme-toggle", async () =>
          runtime.setThemeEnabled?.(theme.id, !theme.enabled)
        )
      );
      const exportTheme = button(options.text.t("console.themes.export"), "theme-export");
      exportTheme.addEventListener("click", () =>
        void options.run("theme-export", async () => {
          const artifact = await runtime.exportTheme?.(theme.id);
          if (artifact) download(artifact.filename, artifact.bytes);
        })
      );
      const remove = button(options.text.t("common.action.delete"), "theme-delete");
      remove.addEventListener("click", () => {
        void (async () => {
          const confirmed = await options.confirm(
            options.text.t("common.confirm.delete", { target: theme.id })
          );
          if (!confirmed) return;
          await options.run(
            "theme-delete",
            async () => runtime.deleteTheme?.(theme.id)
          );
        })();
      });
      actions.append(toggle, exportTheme, remove);
      row.append(actions);
    }
    grid.append(row);
  }
  container.append(grid);
}

function download(filename: string, bytes: Uint8Array): void {
  const anchor = document.createElement("a");
  anchor.download = filename;
  const createObjectUrl = URL.createObjectURL?.bind(URL);
  if (createObjectUrl) {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const url = createObjectUrl(new Blob([buffer], { type: "application/zip" }));
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL?.(url);
    return;
  }
  anchor.href = "#";
  anchor.click();
}

export function heading(container: HTMLElement, text: string): HTMLHeadingElement {
  const element = document.createElement("h1");
  element.tabIndex = -1;
  element.textContent = text;
  container.append(element);
  return element;
}
