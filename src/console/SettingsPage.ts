import type { GalleyActions, SettingsSnapshot } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { button } from "./ConsoleHome";
import { heading } from "./ThemePage";

export type SettingsPageState = {
  -readonly [Key in keyof SettingsSnapshot]?: SettingsSnapshot[Key];
};

export async function renderSettingsPage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    state: SettingsPageState;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  heading(container, options.text.t("console.settings.title"));
  const runtime = options.actions.desktop;
  if (!runtime) return;
  if (!Object.keys(options.state).length) {
    Object.assign(options.state, await runtime.readSettings?.());
  }
  const form = document.createElement("form");
  const fields: Array<[keyof SettingsSnapshot, MessageKeyLike, string]> = [
    ["baseUrl", "console.settings.baseUrl", String(options.state.baseUrl ?? "")],
    ["model", "console.settings.model", String(options.state.model ?? "")],
    ["temperature", "console.settings.temperature", String(options.state.temperature ?? 0.4)],
    ["timeoutMs", "console.settings.timeout", String(options.state.timeoutMs ?? 120000)],
    ["contextWindow", "console.settings.contextWindow", String(options.state.contextWindow ?? 128000)],
    ["outputFolder", "console.settings.outputFolder", String(options.state.outputFolder ?? "")]
  ];
  const inputs = new Map<keyof SettingsSnapshot, HTMLInputElement>();
  for (const [key, labelKey, value] of fields) {
    const label = document.createElement("label");
    label.textContent = options.text.t(labelKey);
    const input = document.createElement("input");
    input.name = key;
    input.value = value;
    input.addEventListener("input", () => update(options.state, key, input.value));
    inputs.set(key, input);
    label.append(input);
    form.append(label);
  }
  const secretLabel = document.createElement("label");
  secretLabel.textContent = options.text.t("console.settings.secret");
  const secret = document.createElement("select");
  secret.name = "secretId";
  const secretIds = (await runtime.listSecrets?.()) ?? [];
  for (const secretId of secretIds) {
    const option = document.createElement("option");
    option.value = secretId;
    option.textContent = secretId;
    secret.append(option);
  }
  if (
    options.state.secretId &&
    !secretIds.includes(options.state.secretId)
  ) {
    const option = document.createElement("option");
    option.value = options.state.secretId;
    option.textContent = options.state.secretId;
    secret.append(option);
  }
  secret.value = options.state.secretId ?? "";
  secret.addEventListener("change", () => {
    options.state.secretId = secret.value;
  });
  secretLabel.append(secret);
  form.append(secretLabel);
  const save = button(options.text.t("common.action.save"), "settings-save");
  save.type = "submit";
  form.append(save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    for (const [key, input] of inputs) update(options.state, key, input.value);
    options.state.secretId = secret.value;
    void options.run("settings-save", async () => runtime.saveSettings?.(options.state));
  });
  const diagnostic = button(options.text.t("console.settings.diagnostic"), "diagnostic");
  diagnostic.addEventListener("click", () =>
    void options.run("diagnostic", (signal) => runtime.runDiagnostic?.(signal) ?? Promise.resolve())
  );
  container.append(form, diagnostic);
}

type MessageKeyLike =
  | "console.settings.baseUrl"
  | "console.settings.model"
  | "console.settings.secret"
  | "console.settings.temperature"
  | "console.settings.timeout"
  | "console.settings.contextWindow"
  | "console.settings.outputFolder";

function update(
  state: SettingsPageState,
  key: keyof SettingsSnapshot,
  value: string
): void {
  if (key === "temperature" || key === "timeoutMs" || key === "contextWindow") {
    state[key] = Number(value);
  } else if (key !== "language") {
    state[key] = value;
  }
}
