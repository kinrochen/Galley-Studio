export type ConflictDecision = "reload" | "save-copy" | "overwrite";

export function renderConflictBanner(
  host: HTMLElement,
  onDecision: (decision: ConflictDecision) => void | Promise<void>,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): HTMLElement {
  const document = host.ownerDocument;
  const banner = document.createElement("section");
  banner.className = "galley-conflict-banner";
  banner.setAttribute("role", "alert");
  const message = document.createElement("p");
  message.textContent = text.t("workbench.conflict.message");
  banner.append(message);
  for (const [decision, label] of [
    ["reload", "workbench.conflict.reload"],
    ["save-copy", "workbench.conflict.copy"],
    ["overwrite", "workbench.conflict.overwrite"]
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.conflictAction = decision;
    button.textContent = text.t(label);
    button.addEventListener("click", () => void onDecision(decision));
    banner.append(button);
  }
  host.append(banner);
  return banner;
}
import { ENGLISH_LOCALIZED_TEXT, type LocalizedText } from "../i18n/LocalizedText";
