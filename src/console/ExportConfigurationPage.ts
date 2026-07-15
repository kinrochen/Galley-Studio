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
  const profileLabel = document.createElement("label");
  const profileLabelText = options.text.t("console.exports.profile");
  profileLabel.textContent = profileLabelText;
  const profile = document.createElement("select");
  profile.name = "profileId";
  profile.setAttribute("aria-label", profileLabelText);
  for (const [value, labelKey] of [
    ["standard-web", "workbench.export.profile.standardWeb"],
    ["portable-inline", "workbench.export.profile.portableInline"],
    ["wechat", "workbench.export.profile.wechat"]
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = options.text.t(labelKey);
    profile.append(option);
  }
  profile.value = options.state.profileId;
  const folder = field(form, options.text.t("console.exports.folder"), "outputFolder", options.state.outputFolder);
  const filename = field(form, options.text.t("console.exports.fileName"), "fileNameTemplate", options.state.fileNameTemplate);
  profileLabel.append(profile);
  form.append(profileLabel);
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
    appendText(row, `${configuration.name} — ${profileName(configuration.profileId, options.text)}`);
    const edit = button(options.text.t("common.action.edit"), "export-config-edit");
    edit.addEventListener("click", () => {
      hydrate(configuration, options.state, id, name, profile, folder, filename);
      name.focus();
    });
    const duplicate = button(options.text.t("common.action.duplicate"), "export-config-duplicate");
    duplicate.addEventListener("click", () => {
      hydrate({
        ...configuration,
        id: `${configuration.id}-copy`,
        name: options.text.t("console.exports.duplicateName", {
          name: configuration.name
        })
      }, options.state, id, name, profile, folder, filename);
      id.focus();
    });
    const remove = button(options.text.t("common.action.delete"), "export-config-delete");
    remove.addEventListener("click", () => {
      if (!options.confirm(options.text.t("common.confirm.delete", { target: configuration.name }))) return;
      void options.run("export-config-delete", async () => runtime.deleteExportConfiguration?.(configuration.id));
    });
    row.append(edit, duplicate, remove);
    container.append(row);
  }
}

function hydrate(
  configuration: ExportConfigurationFormState,
  state: ExportConfigurationFormState,
  id: HTMLInputElement,
  name: HTMLInputElement,
  profile: HTMLSelectElement,
  folder: HTMLInputElement,
  filename: HTMLInputElement
): void {
  state.id = configuration.id;
  state.name = configuration.name;
  state.profileId = configuration.profileId;
  state.outputFolder = configuration.outputFolder;
  state.fileNameTemplate = configuration.fileNameTemplate;
  id.value = state.id;
  name.value = state.name;
  profile.value = state.profileId;
  folder.value = state.outputFolder;
  filename.value = state.fileNameTemplate;
}

function profileName(
  profileId: ExportConfigurationFormState["profileId"],
  text: ConsolePageText
): string {
  return text.t(
    profileId === "standard-web"
      ? "workbench.export.profile.standardWeb"
      : profileId === "portable-inline"
        ? "workbench.export.profile.portableInline"
        : "workbench.export.profile.wechat"
  );
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
