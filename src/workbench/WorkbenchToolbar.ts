import type { WorkbenchMode, WorkbenchState } from "./WorkbenchState";
import {
  ENGLISH_LOCALIZED_TEXT,
  type LocalizedText
} from "../i18n/LocalizedText";

export interface WorkbenchToolbarActions {
  readonly onMode: (mode: WorkbenchMode) => void | Promise<void>;
  readonly onCopy: () => void | Promise<void>;
  readonly onSave: () => void | Promise<void>;
}

export function saveStatus(
  state: WorkbenchState,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): string {
  if (state.conflict) return text.t("workbench.status.conflict");
  if (state.saving) return text.t("workbench.status.saving");
  if (state.dirty) return text.t("workbench.status.unsaved");
  return text.t("workbench.status.saved");
}

export function renderWorkbenchToolbar(
  host: HTMLElement,
  state: WorkbenchState,
  actions: WorkbenchToolbarActions,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): void {
  const document = host.ownerDocument;
  const fragment = document.createDocumentFragment();
  const identity = document.createElement("div");
  identity.className = "galley-document-identity";
  identity.textContent = state.documentPath ?? "Galley";
  fragment.append(identity);

  const modes = document.createElement("div");
  modes.className = "galley-mode-switcher";
  for (const mode of ["preview", "visual", "source"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.textContent = text.t(`workbench.mode.${mode}` as const);
    button.classList.toggle("is-active", state.mode === mode);
    button.setAttribute("aria-pressed", String(state.mode === mode));
    button.addEventListener("click", () => void actions.onMode(mode));
    modes.append(button);
  }
  fragment.append(modes);

  const status = document.createElement("span");
  status.dataset.saveStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const statusCode = state.conflict ? "conflict" : state.saving ? "saving" : state.dirty ? "unsaved" : "saved";
  status.className = `galley-save-status is-${statusCode}`;
  status.textContent = saveStatus(state, text);
  fragment.append(status);

  if (state.sourceChanged) {
    const source = document.createElement("span");
    source.className = "galley-source-changed";
    source.textContent = text.t("workbench.sourceChanged");
    fragment.append(source);
  }

  const copy = document.createElement("button");
  copy.type = "button";
  copy.dataset.action = "copy-html";
  copy.textContent = text.t("workbench.copyHtml");
  copy.disabled = !state.documentPath || state.recovery !== "ready";
  copy.addEventListener("click", () => void actions.onCopy());
  fragment.append(copy);

  const save = document.createElement("button");
  save.type = "button";
  save.dataset.action = "save";
  save.textContent = text.t("workbench.save");
  save.disabled =
    state.saving ||
    state.conflict ||
    state.recovery !== "ready" ||
    !state.dirty;
  save.addEventListener("click", () => void actions.onSave());
  fragment.append(save);
  host.replaceChildren(fragment);
}
