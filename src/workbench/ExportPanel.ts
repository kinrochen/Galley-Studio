import {
  normalizeExportConfiguration,
  type ExportConfiguration
} from "../export/ExportConfiguration";
import type { ExportProfileId } from "../export/ExportProfile";

export type ExportPanelStatus =
  | "idle"
  | "exporting"
  | "copying"
  | "success"
  | "copied"
  | "error";

export interface ExportPanelState {
  readonly selectedId: string;
  readonly status: ExportPanelStatus;
  readonly message: string;
}

export interface ExportPanelActions {
  readonly onSelect: (configurationId: string) => void;
  readonly onExport: (configurationId: string) => void | Promise<void>;
  readonly onCopy: (configurationId: string) => void | Promise<void>;
  readonly onSave: (configuration: ExportConfiguration) => void | Promise<void>;
  readonly onValidationError?: (message: string) => void;
}

const PROFILE_LABELS: readonly [ExportProfileId, string][] = [
  ["standard-web", "Standard web"],
  ["portable-inline", "Portable inline"],
  ["wechat", "WeChat editor"]
];

export function renderExportPanel(
  host: HTMLElement,
  state: ExportPanelState,
  configurations: readonly ExportConfiguration[],
  actions: ExportPanelActions
): void {
  const document = host.ownerDocument;
  const section = document.createElement("section");
  section.className = "galley-export-panel";
  const heading = document.createElement("h3");
  heading.textContent = "Export configuration";
  section.append(heading);

  const selected = configurations.find(({ id }) => id === state.selectedId)
    ?? configurations[0];
  if (!selected) {
    const empty = document.createElement("p");
    empty.textContent = "No export configurations.";
    section.append(empty);
    host.replaceChildren(section);
    return;
  }

  const configSelect = document.createElement("select");
  configSelect.dataset.exportConfiguration = "";
  for (const configuration of configurations) {
    const option = document.createElement("option");
    option.value = configuration.id;
    option.textContent = configuration.name;
    option.selected = configuration.id === selected.id;
    configSelect.append(option);
  }
  configSelect.addEventListener("change", () => actions.onSelect(configSelect.value));
  section.append(label(document, "Saved configuration", configSelect));

  const name = input(document, "name", selected.name);
  section.append(label(document, "Name", name));
  const profile = document.createElement("select");
  profile.dataset.exportProfile = "";
  for (const [id, text] of PROFILE_LABELS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text;
    option.selected = id === selected.profileId;
    profile.append(option);
  }
  section.append(label(document, "Profile", profile));
  const folder = input(document, "output-folder", selected.outputFolder);
  section.append(label(document, "Output folder", folder));
  const template = input(document, "filename-template", selected.fileNameTemplate);
  section.append(label(document, "Filename", template));

  const actionsHost = document.createElement("div");
  actionsHost.className = "galley-export-actions";
  const busy = state.status === "exporting" || state.status === "copying";
  actionsHost.append(
    actionButton(document, "export", "Export file", busy, () => actions.onExport(selected.id)),
    actionButton(document, "copy", "Copy rich text", busy, () => actions.onCopy(selected.id)),
    actionButton(document, "save-config", "Save configuration", busy, () => {
      try {
        return actions.onSave(normalizeExportConfiguration({
          id: selected.id,
          name: name.value,
          profileId: profile.value,
          outputFolder: folder.value,
          fileNameTemplate: template.value
        }));
      } catch {
        actions.onValidationError?.("Export configuration is invalid");
      }
    })
  );
  section.append(actionsHost);

  const status = document.createElement("p");
  status.dataset.exportStatus = state.status;
  status.className = `galley-export-status is-${state.status}`;
  status.setAttribute("role", state.status === "error" ? "alert" : "status");
  status.textContent = state.message;
  section.append(status);
  host.replaceChildren(section);
}

function label(document: Document, text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

function input(document: Document, field: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.exportField = field;
  input.value = value;
  return input;
}

function actionButton(
  document: Document,
  action: string,
  text: string,
  disabled: boolean,
  callback: () => void | Promise<void>
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.exportAction = action;
  button.textContent = text;
  button.disabled = disabled;
  button.addEventListener("click", () => {
    void Promise.resolve().then(callback).catch(() => undefined);
  });
  return button;
}
