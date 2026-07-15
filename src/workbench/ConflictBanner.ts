export type ConflictDecision = "reload" | "save-copy" | "overwrite";

export function renderConflictBanner(
  host: HTMLElement,
  onDecision: (decision: ConflictDecision) => void | Promise<void>
): HTMLElement {
  const document = host.ownerDocument;
  const banner = document.createElement("section");
  banner.className = "galley-conflict-banner";
  banner.setAttribute("role", "alert");
  const message = document.createElement("p");
  message.textContent = "This article changed outside Galley. Choose how to continue.";
  banner.append(message);
  for (const [decision, label] of [
    ["reload", "Reload external"],
    ["save-copy", "Save a copy"],
    ["overwrite", "Overwrite external"]
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.conflictAction = decision;
    button.textContent = label;
    button.addEventListener("click", () => void onDecision(decision));
    banner.append(button);
  }
  host.append(banner);
  return banner;
}
