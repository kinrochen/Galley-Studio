import {
  type App,
  type Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting
} from "obsidian";
import type { GalleySettings } from "./GalleySettings";

export interface GalleySettingsPlugin extends Plugin {
  settings: GalleySettings;
  readonly canGenerate: boolean;
  saveSettings(): Promise<void>;
  checkModelConnectionAndSkillLoading(): Promise<void>;
}

export class GalleySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly galley: GalleySettingsPlugin
  ) {
    super(app, galley);
  }

  display(): void {
    this.containerEl.replaceChildren();

    new Setting(this.containerEl)
      .setName("Base URL")
      .setDesc("OpenAI-compatible API base URL.")
      .addText((component) =>
        component.setValue(this.galley.settings.baseUrl).onChange(async (value) => {
          this.galley.settings.baseUrl = value;
          await this.galley.saveSettings();
        })
      );

    new Setting(this.containerEl)
      .setName("Model")
      .setDesc("Model identifier sent to the provider.")
      .addText((component) =>
        component.setValue(this.galley.settings.model).onChange(async (value) => {
          this.galley.settings.model = value;
          await this.galley.saveSettings();
        })
      );

    new Setting(this.containerEl)
      .setName("API key")
      .setDesc("Select a key stored in Obsidian SecretStorage.")
      .addComponent((containerEl) =>
        new SecretComponent(this.app, containerEl)
          .setValue(this.galley.settings.secretId)
          .onChange(async (secretId) => {
            this.galley.settings.secretId = secretId;
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Temperature")
      .setDesc("Sampling temperature from 0 to 2.")
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.temperature))
          .onChange(async (value) => {
            this.galley.settings.temperature = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Timeout (ms)")
      .setDesc("Request timeout in milliseconds.")
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.timeoutMs))
          .onChange(async (value) => {
            this.galley.settings.timeoutMs = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Context window")
      .setDesc("Maximum model context window in tokens.")
      .addText((component) =>
        component
          .setValue(String(this.galley.settings.contextWindow))
          .onChange(async (value) => {
            this.galley.settings.contextWindow = Number(value);
            await this.galley.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("Output folder")
      .setDesc("Vault folder for generated Galley files.")
      .addText((component) =>
        component.setValue(this.galley.settings.outputFolder).onChange(async (value) => {
          this.galley.settings.outputFolder = value;
          await this.galley.saveSettings();
        })
      );

    if (this.galley.canGenerate) {
      new Setting(this.containerEl)
        .setName("Connection and Skill diagnostic")
        .setDesc(
          "Check the configured model and audit loading of the bundled Skill."
        )
        .addButton((component) =>
          component
            .setButtonText("Check model connection and Skill loading")
            .setCta()
            .onClick(() =>
              this.galley.checkModelConnectionAndSkillLoading()
            )
        );
    }
  }
}
