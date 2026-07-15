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
  checkModelConnectionAndSkillLoading(): Promise<void>;
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

    new Setting(this.containerEl)
      .setName(this.#text.t("console.settings.temperature"))
      .setDesc(this.#text.t("settings.temperature.desc"))
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.temperature))
          .onChange(async (value) => {
            this.galley.settings.temperature = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName(this.#text.t("console.settings.timeout"))
      .setDesc(this.#text.t("settings.timeout.desc"))
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.timeoutMs))
          .onChange(async (value) => {
            this.galley.settings.timeoutMs = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName(this.#text.t("console.settings.contextWindow"))
      .setDesc(this.#text.t("settings.contextWindow.desc"))
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.contextWindow))
          .onChange(async (value) => {
            this.galley.settings.contextWindow = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName(this.#text.t("console.settings.outputFolder"))
      .setDesc(this.#text.t("settings.outputFolder.desc"))
      .addText((component) =>
        component.setValue(this.galley.settings.outputFolder).onChange(async (value) => {
          this.galley.settings.outputFolder = value;
          await this.galley.saveSettings();
        })
      );

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
              this.galley.checkModelConnectionAndSkillLoading()
            )
        );
    }
  }

  hide(): void {
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
  }
}
