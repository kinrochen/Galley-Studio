import { MAX_THEME_ARCHIVE_BYTES } from "../archive/ArchiveLimits";
import type { GalleyActions } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";

export async function renderThemePage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    confirm: (message: string) => boolean;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  heading(container, options.text.t("console.themes.title"));
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const controls = document.createElement("div");
  const themeLab = button(options.text.t("console.action.openThemeLab"), "theme-lab");
  themeLab.addEventListener("click", () =>
    void options.run("theme-lab", async () => runtime.openThemeLab?.())
  );
  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = ".zip,application/zip";
  upload.setAttribute("aria-label", options.text.t("console.themes.import"));
  upload.dataset.action = "theme-import";
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (!file) return;
    void options.run("theme-import", async () => {
      if (file.size > MAX_THEME_ARCHIVE_BYTES) {
        throw new Error("theme_archive_too_large");
      }
      await runtime.importTheme?.(new Uint8Array(await file.arrayBuffer()));
    });
  });
  controls.append(themeLab, upload);
  container.append(controls);
  const themes = (await runtime.listThemes?.()) ?? [];
  if (!themes.length) appendText(container, options.text.t("console.themes.title"));
  for (const theme of themes) {
    const row = document.createElement("div");
    row.className = "galley-console__management-row";
    appendText(row, `${theme.name} (${theme.id})`);
    if (!theme.builtIn) {
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
        if (!options.confirm(options.text.t("common.confirm.delete", { target: theme.id }))) return;
        void options.run("theme-delete", async () => runtime.deleteTheme?.(theme.id));
      });
      row.append(toggle, exportTheme, remove);
    }
    container.append(row);
  }
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
