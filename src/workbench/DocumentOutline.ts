export interface DocumentOutlineEntry {
  readonly level: number;
  readonly sourceId: string;
  readonly label: string;
}

export function extractDocumentOutline(bodyHtml: string): DocumentOutlineEntry[] {
  const document = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
    "text/html"
  );
  return [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .map((heading): DocumentOutlineEntry | null => {
      const sourceId = heading.getAttribute("data-galley-source")?.trim();
      const level = Number(heading.localName.slice(1));
      const label = (heading.textContent ?? "").replace(/\s+/gu, " ").trim();
      return sourceId && label && level >= 1 && level <= 6
        ? { level, sourceId, label }
        : null;
    })
    .filter((entry): entry is DocumentOutlineEntry => entry !== null);
}

export function renderDocumentOutline(
  host: HTMLElement,
  entries: readonly DocumentOutlineEntry[],
  onSelect: (sourceId: string) => void,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): void {
  const document = host.ownerDocument;
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("h3");
  heading.textContent = text.t("workbench.outline.title");
  fragment.append(heading);
  const list = document.createElement("ol");
  list.className = "galley-outline-list";
  for (const entry of entries) {
    const item = document.createElement("li");
    item.style.setProperty("--galley-outline-depth", String(entry.level - 1));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label;
    button.dataset.sourceId = entry.sourceId;
    button.addEventListener("click", () => onSelect(entry.sourceId));
    item.append(button);
    list.append(item);
  }
  fragment.append(list);
  host.replaceChildren(fragment);
}
import { ENGLISH_LOCALIZED_TEXT, type LocalizedText } from "../i18n/LocalizedText";
