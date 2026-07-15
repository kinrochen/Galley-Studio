import type {
  ConnectionDiagnosticSnapshot,
  GalleyActions,
  SettingsSnapshot
} from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";
import { heading } from "./ThemePage";
import type { MessageKey } from "../i18n/Resources";

type EditableSettingsKey =
  | "baseUrl"
  | "model"
  | "secretId"
  | "temperature"
  | "timeoutMs"
  | "contextWindow"
  | "outputFolder";

type EditableSettingsSnapshot = {
  -readonly [Key in EditableSettingsKey]: SettingsSnapshot[Key];
};

export type SettingsPageState = Partial<EditableSettingsSnapshot> & {
  initialized?: boolean;
  language?: SettingsSnapshot["language"];
  diagnostic?: ConnectionDiagnosticSnapshot;
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
  appendText(container, options.text.t("console.settings.description"))
    .className = "galley-console__lead";
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const snapshot = await runtime.readSettings?.();
  if (snapshot) {
    if (!options.state.initialized) copyEditable(options.state, snapshot);
    options.state.language = snapshot.language;
    options.state.initialized = true;
  }

  const language = options.state.language ?? "auto";
  const languageLabelKey: MessageKey =
    language === "zh-CN"
      ? "common.language.zh"
      : language === "en"
        ? "common.language.en"
        : "common.language.auto";
  const languageStatus = appendText(
    container,
    options.text.t("console.settings.language", {
      language: options.text.t(languageLabelKey)
    })
  );
  languageStatus.dataset.settingLanguage = "";

  const form = document.createElement("form");
  form.className = "galley-console__settings-form";
  const providerSection = settingsSection(
    options.text.t("console.settings.provider"),
    options.text.t("console.settings.providerDescription")
  );
  const generationSection = settingsSection(
    options.text.t("console.settings.generation"),
    options.text.t("console.settings.generationDescription")
  );
  const fields: Array<[keyof EditableSettingsSnapshot, MessageKeyLike, string]> = [
    ["baseUrl", "console.settings.baseUrl", String(options.state.baseUrl ?? "")],
    ["model", "console.settings.model", String(options.state.model ?? "")],
    ["temperature", "console.settings.temperature", String(options.state.temperature ?? 0.4)],
    ["timeoutMs", "console.settings.timeout", String(options.state.timeoutMs ?? 120000)],
    ["contextWindow", "console.settings.contextWindow", String(options.state.contextWindow ?? 128000)],
    ["outputFolder", "console.settings.outputFolder", String(options.state.outputFolder ?? "")]
  ];
  const inputs = new Map<keyof EditableSettingsSnapshot, HTMLInputElement>();
  for (const [key, labelKey, value] of fields) {
    const label = document.createElement("label");
    label.textContent = options.text.t(labelKey);
    const input = document.createElement("input");
    input.name = key;
    input.value = value;
    if (key === "temperature") {
      input.type = "number";
      input.min = "0";
      input.max = "2";
      input.step = "0.1";
    } else if (key === "timeoutMs" || key === "contextWindow") {
      input.type = "number";
      input.min = "1";
      input.step = "1";
    }
    input.addEventListener("input", () => update(options.state, key, input.value));
    inputs.set(key, input);
    label.append(input);
    const target = key === "baseUrl" || key === "model"
      ? providerSection.fields
      : generationSection.fields;
    target.append(label);
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
  if (options.state.secretId && !secretIds.includes(options.state.secretId)) {
    const option = document.createElement("option");
    option.value = options.state.secretId;
    option.textContent = options.text.t("console.settings.secretUnavailable", {
      id: options.state.secretId
    });
    secret.append(option);
    const warning = appendText(
      providerSection.section,
      options.text.t("console.settings.secretUnavailableHelp")
    );
    warning.className = "galley-console__inline-error";
  }
  secret.value = options.state.secretId ?? "";
  secret.addEventListener("change", () => {
    options.state.secretId = secret.value;
  });
  secretLabel.append(secret);
  providerSection.fields.append(secretLabel);
  const save = button(options.text.t("common.action.save"), "settings-save");
  save.classList.add("mod-cta");
  save.type = "submit";
  const saveRow = document.createElement("div");
  saveRow.className = "galley-console__settings-save";
  saveRow.append(save);
  form.append(providerSection.section, generationSection.section, saveRow);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    for (const [key, input] of inputs) update(options.state, key, input.value);
    options.state.secretId = secret.value;
    const payload = editablePayload(options.state);
    void options.run("settings-save", async () => {
      const saved = await runtime.saveSettings?.(payload);
      if (saved) {
        copyEditable(options.state, saved);
        options.state.language = saved.language;
      }
    });
  });

  const diagnosticSection = document.createElement("section");
  diagnosticSection.className = "galley-console__diagnostic";
  const diagnosticHeading = document.createElement("h2");
  diagnosticHeading.textContent = options.text.t("console.settings.diagnosticTitle");
  const diagnosticDescription = appendText(
    diagnosticSection,
    options.text.t("console.settings.diagnosticDescription")
  );
  diagnosticDescription.className = "galley-console__form-help";
  diagnosticSection.prepend(diagnosticHeading);
  const diagnostic = button(options.text.t("console.settings.diagnostic"), "diagnostic");
  const diagnosticResult = document.createElement("section");
  diagnosticResult.dataset.diagnosticResult = "";
  renderDiagnostic(diagnosticResult, options.state.diagnostic, options.text);
  diagnostic.addEventListener("click", () =>
    void options.run("diagnostic", async (signal) => {
      const result = await runtime.runDiagnostic?.(signal);
      if (!result) return;
      options.state.diagnostic = sanitizeDiagnostic(result);
      renderDiagnostic(diagnosticResult, options.state.diagnostic, options.text);
    })
  );
  diagnosticSection.append(diagnostic, diagnosticResult);
  container.append(form, diagnosticSection);
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
  key: keyof EditableSettingsSnapshot,
  value: string
): void {
  if (key === "temperature" || key === "timeoutMs" || key === "contextWindow") {
    state[key] = Number(value);
  } else {
    state[key] = value;
  }
}

function editablePayload(state: SettingsPageState): Partial<SettingsSnapshot> {
  return {
    baseUrl: state.baseUrl ?? "",
    model: state.model ?? "",
    secretId: state.secretId ?? "",
    temperature: state.temperature ?? 0.4,
    timeoutMs: state.timeoutMs ?? 120000,
    contextWindow: state.contextWindow ?? 128000,
    outputFolder: state.outputFolder ?? ""
  };
}

function copyEditable(
  state: SettingsPageState,
  snapshot: SettingsSnapshot
): void {
  state.baseUrl = snapshot.baseUrl;
  state.model = snapshot.model;
  state.secretId = snapshot.secretId;
  state.temperature = snapshot.temperature;
  state.timeoutMs = snapshot.timeoutMs;
  state.contextWindow = snapshot.contextWindow;
  state.outputFolder = snapshot.outputFolder;
}

function sanitizeDiagnostic(
  result: ConnectionDiagnosticSnapshot
): ConnectionDiagnosticSnapshot {
  const errorCode = result.errorCode && /^[a-z0-9_]{1,64}$/u.test(result.errorCode)
    ? result.errorCode
    : result.errorCode
      ? "diagnostic_failed"
      : undefined;
  return {
    ok: result.ok,
    model: result.model,
    capabilities: { ...result.capabilities },
    skillVersion: result.skillVersion,
    skillLoadMode: result.skillLoadMode,
    skillFiles: [...result.skillFiles],
    ...(errorCode ? { errorCode } : {})
  };
}

function renderDiagnostic(
  container: HTMLElement,
  result: ConnectionDiagnosticSnapshot | undefined,
  text: ConsolePageText
): void {
  container.replaceChildren();
  if (!result) return;
  const title = document.createElement("h2");
  title.textContent = text.t("diagnostic.title");
  container.append(title);
  appendFact(container, text.t("diagnostic.status"), text.t(
    result.ok ? "diagnostic.passed" : "diagnostic.failed"
  ));
  appendFact(container, text.t("diagnostic.model"), result.model);
  for (const [label, supported] of [
    ["diagnostic.tools", result.capabilities.tools],
    ["diagnostic.streaming", result.capabilities.streaming],
    ["diagnostic.vision", result.capabilities.vision]
  ] as const) {
    appendFact(
      container,
      text.t(label),
      text.t(supported ? "diagnostic.supported" : "diagnostic.notObserved")
    );
  }
  appendFact(container, text.t("diagnostic.skillVersion"), result.skillVersion);
  appendFact(container, text.t("diagnostic.skillLoadMode"), result.skillLoadMode);
  if (result.errorCode) {
    appendFact(container, text.t("diagnostic.errorCode"), result.errorCode);
  }
  const files = document.createElement("p");
  files.textContent = `${text.t("diagnostic.skillFiles")} ${result.skillFiles.join(", ")}`;
  container.append(files);
}

function appendFact(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value}`;
  container.append(row);
}

function settingsSection(
  title: string,
  description: string
): { section: HTMLElement; fields: HTMLElement } {
  const section = document.createElement("section");
  section.className = "galley-console__settings-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const lead = document.createElement("p");
  lead.className = "galley-console__form-help";
  lead.textContent = description;
  const fields = document.createElement("div");
  fields.className = "galley-console__settings-fields";
  section.append(heading, lead, fields);
  return { section, fields };
}
