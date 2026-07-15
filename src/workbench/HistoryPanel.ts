import type { HistorySnapshot } from "../documents/HistoryRepository";
import { ENGLISH_LOCALIZED_TEXT, type LocalizedText } from "../i18n/LocalizedText";

export function newestHistory(
  snapshots: readonly HistorySnapshot[],
  limit = 20
): HistorySnapshot[] {
  return [...snapshots]
    .sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp) ||
      right.path.localeCompare(left.path)
    )
    .slice(0, limit);
}

export function renderHistoryPanel(
  host: HTMLElement,
  snapshots: readonly HistorySnapshot[],
  onRestore: (snapshot: HistorySnapshot) => void | Promise<void>,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): void {
  const document = host.ownerDocument;
  const section = document.createElement("section");
  section.className = "galley-history-panel";
  const heading = document.createElement("h3");
  heading.textContent = text.t("workbench.history.title");
  section.append(heading);
  const list = document.createElement("ol");
  list.className = "galley-history-list";
  for (const snapshot of newestHistory(snapshots)) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.historyPath = snapshot.path;
    button.textContent = new Date(snapshot.timestamp).toLocaleString();
    button.addEventListener("click", () => void onRestore(snapshot));
    item.append(button);
    list.append(item);
  }
  if (list.childElementCount === 0) {
    const empty = document.createElement("p");
    empty.className = "galley-history-empty";
    empty.textContent = text.t("workbench.history.empty");
    section.append(empty);
  } else {
    section.append(list);
  }
  host.replaceChildren(section);
}
