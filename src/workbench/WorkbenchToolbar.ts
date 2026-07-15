import type { WorkbenchMode, WorkbenchState } from "./WorkbenchState";

export interface WorkbenchToolbarActions {
  readonly onMode: (mode: WorkbenchMode) => void | Promise<void>;
  readonly onSave: () => void | Promise<void>;
}

export function saveStatus(state: WorkbenchState): string {
  if (state.conflict) return "Conflict";
  if (state.saving) return "Saving…";
  if (state.dirty) return "Unsaved";
  return "Saved";
}

export function renderWorkbenchToolbar(
  host: HTMLElement,
  state: WorkbenchState,
  actions: WorkbenchToolbarActions
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
    button.textContent = mode[0]?.toUpperCase() + mode.slice(1);
    button.classList.toggle("is-active", state.mode === mode);
    button.setAttribute("aria-pressed", String(state.mode === mode));
    button.addEventListener("click", () => void actions.onMode(mode));
    modes.append(button);
  }
  fragment.append(modes);

  const status = document.createElement("span");
  status.dataset.saveStatus = "";
  status.className = `galley-save-status is-${saveStatus(state).toLowerCase().replace("…", "")}`;
  status.textContent = saveStatus(state);
  fragment.append(status);

  if (state.sourceChanged) {
    const source = document.createElement("span");
    source.className = "galley-source-changed";
    source.textContent = "Source changed";
    fragment.append(source);
  }

  const save = document.createElement("button");
  save.type = "button";
  save.dataset.action = "save";
  save.textContent = "Save";
  save.disabled =
    state.saving ||
    state.conflict ||
    state.recovery !== "ready" ||
    !state.dirty;
  save.addEventListener("click", () => void actions.onSave());
  fragment.append(save);
  host.replaceChildren(fragment);
}
