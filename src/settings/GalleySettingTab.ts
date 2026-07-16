import {
  type App,
  type Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting
} from "obsidian";
import type { GalleySettings } from "./GalleySettings";
import {
  ENGLISH_LOCALIZED_TEXT,
  type LocalizedText
} from "../i18n/LocalizedText";

export interface GalleySettingsPlugin extends Plugin {
  settings: GalleySettings;
  readonly canGenerate: boolean;
  readonly localizedText?: LocalizedText;
  saveSettings(): Promise<void>;
  setLanguage(language: GalleySettings["language"]): Promise<void>;
  checkGenerationAgentAvailability(): Promise<void>;
}

export class GalleySettingTab extends PluginSettingTab {
  readonly #text: LocalizedText;
  #unsubscribeLocale: (() => void) | null = null;

  constructor(
    app: App,
    private readonly galley: GalleySettingsPlugin
  ) {
    super(app, galley);
    this.#text = galley.localizedText ?? ENGLISH_LOCALIZED_TEXT;
  }

  display(): void {
    this.#unsubscribeLocale ??= this.#text.subscribe(() => this.display());
    this.containerEl.replaceChildren();

    const agentSetting = new Setting(this.containerEl)
      .setName(this.#text.t("console.settings.agent"))
      .setDesc(this.#text.t("console.settings.agentDescription"));
    const agentSelect = document.createElement("select");
    for (const [value, key] of [
      ["plugin", "console.settings.agent.plugin"],
      ["codex-cli", "console.settings.agent.codex"],
      ["claude-cli", "console.settings.agent.claude"]
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.#text.t(key);
      agentSelect.append(option);
    }
    agentSelect.value = this.galley.settings.generationAgent;
    agentSelect.addEventListener("change", () => {
      const value = agentSelect.value;
      if (value === "plugin" || value === "codex-cli" || value === "claude-cli") {
        this.galley.settings.generationAgent = value;
        void this.galley.saveSettings().then(() => this.display());
      }
    });
    agentSetting.controlEl.append(agentSelect);

    if (this.galley.settings.generationAgent === "plugin") {
      new Setting(this.containerEl)
        .setName(this.#text.t("console.settings.baseUrl"))
        .setDesc(this.#text.t("settings.baseUrl.desc"))
        .addText((component) =>
          component.setValue(this.galley.settings.baseUrl).onChange(async (value) => {
            this.galley.settings.baseUrl = value;
            await this.galley.saveSettings();
          })
        );

      new Setting(this.containerEl)
        .setName(this.#text.t("console.settings.model"))
        .setDesc(this.#text.t("settings.model.desc"))
        .addText((component) =>
          component.setValue(this.galley.settings.model).onChange(async (value) => {
            this.galley.settings.model = value;
            await this.galley.saveSettings();
          })
        );

      new Setting(this.containerEl)
        .setName(this.#text.t("console.settings.secret"))
        .setDesc(this.#text.t("settings.secret.desc"))
        .addComponent((containerEl) =>
          new SecretComponent(this.app, containerEl)
            .setValue(this.galley.settings.secretId)
            .onChange(async (secretId) => {
              this.galley.settings.secretId = secretId;
              await this.galley.saveSettings();
            })
        );
    } else {
      new Setting(this.containerEl)
        .setName(this.#text.t("console.settings.cliDiscovery"))
        .setDesc(this.#text.t("console.settings.cliDiscoveryDescription"));
    }

    const languageSetting = new Setting(this.containerEl)
      .setName(this.#text.t("settings.language.name"))
      .setDesc(this.#text.t("settings.language.desc"));
    const languageSelect = document.createElement("select");
    for (const [value, key] of [
      ["auto", "common.language.auto"],
      ["zh-CN", "common.language.zh"],
      ["en", "common.language.en"]
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.#text.t(key);
      languageSelect.append(option);
    }
    languageSelect.value = this.galley.settings.language;
    languageSelect.addEventListener("change", () => {
      const language = languageSelect.value;
      if (language === "auto" || language === "zh-CN" || language === "en") {
        void this.galley.setLanguage(language);
      }
    });
    languageSetting.controlEl.append(languageSelect);

    if (this.galley.canGenerate) {
      new Setting(this.containerEl)
        .setName(this.#text.t("settings.diagnostic.name"))
        .setDesc(this.#text.t("settings.diagnostic.desc"))
        .addButton((component) =>
          component
            .setButtonText(this.#text.t("console.settings.diagnostic"))
            .setCta()
            .onClick(() =>
              this.galley.checkGenerationAgentAvailability()
            )
        );
    }
  }

  hide(): void {
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
  }
}
