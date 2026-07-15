import type { GalleyActions } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";
import { heading } from "./ThemePage";

export interface ExportConfigurationFormState {
  id: string;
  name: string;
  profileId: "standard-web" | "portable-inline" | "wechat";
  outputFolder: string;
  fileNameTemplate: string;
}

export async function renderExportConfigurationPage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    state: ExportConfigurationFormState;
    confirm: (message: string) => boolean;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  heading(container, options.text.t("console.exports.title"));
  appendText(container, options.text.t("console.exports.description"));
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const form = document.createElement("form");
  const id = field(form, options.text.t("console.exports.id"), "id", options.state.id);
  const name = field(form, options.text.t("console.exports.name"), "name", options.state.name);
  const profile = document.createElement("select");
  profile.name = "profileId";
  for (const value of ["standard-web", "portable-inline", "wechat"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    profile.append(option);
  }
  profile.value = options.state.profileId;
  const folder = field(form, options.text.t("console.exports.folder"), "outputFolder", options.state.outputFolder);
  const filename = field(form, options.text.t("console.exports.fileName"), "fileNameTemplate", options.state.fileNameTemplate);
  form.append(profile);
  for (const input of [id, name, folder, filename]) {
    input.addEventListener("input", () => sync(options.state, id, name, profile, folder, filename));
  }
  profile.addEventListener("change", () => sync(options.state, id, name, profile, folder, filename));
  const save = button(options.text.t("common.action.save"), "export-config-save");
  save.type = "submit";
  form.append(save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sync(options.state, id, name, profile, folder, filename);
    void options.run("export-config-save", async () => runtime.saveExportConfiguration?.(options.state));
  });
  container.append(form);

  for (const configuration of (await runtime.listExportConfigurations?.()) ?? []) {
    const row = document.createElement("div");
    row.className = "galley-console__management-row";
    appendText(row, `${configuration.name} — ${configuration.profileId}`);
    const duplicate = button(options.text.t("common.action.duplicate"), "export-config-duplicate");
    duplicate.addEventListener("click", () => {
      options.state.id = `${configuration.id}-copy`;
      options.state.name = `${configuration.name} copy`;
      options.state.profileId = configuration.profileId;
      options.state.outputFolder = configuration.outputFolder;
      options.state.fileNameTemplate = configuration.fileNameTemplate;
      id.value = options.state.id;
      name.value = options.state.name;
      profile.value = options.state.profileId;
      folder.value = options.state.outputFolder;
      filename.value = options.state.fileNameTemplate;
      id.focus();
    });
    const remove = button(options.text.t("common.action.delete"), "export-config-delete");
    remove.addEventListener("click", () => {
      if (!options.confirm(options.text.t("common.confirm.delete", { target: configuration.name }))) return;
      void options.run("export-config-delete", async () => runtime.deleteExportConfiguration?.(configuration.id));
    });
    row.append(duplicate, remove);
    container.append(row);
  }
}

function field(
  form: HTMLFormElement,
  labelText: string,
  name: string,
  value: string
): HTMLInputElement {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  label.append(input);
  form.append(label);
  return input;
}

function sync(
  state: ExportConfigurationFormState,
  id: HTMLInputElement,
  name: HTMLInputElement,
  profile: HTMLSelectElement,
  folder: HTMLInputElement,
  filename: HTMLInputElement
): void {
  state.id = id.value;
  state.name = name.value;
  state.profileId = profile.value as ExportConfigurationFormState["profileId"];
  state.outputFolder = folder.value;
  state.fileNameTemplate = filename.value;
}
