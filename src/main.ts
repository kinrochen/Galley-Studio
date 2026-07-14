import { Platform, Plugin } from "obsidian";
import { derivePlatformCapabilities } from "./platform/PlatformCapabilities";
import {
  type GalleySettings,
  normalizeSettings
} from "./settings/GalleySettings";
import { GalleySettingTab } from "./settings/GalleySettingTab";

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    const capabilities = derivePlatformCapabilities(Platform.isMobileApp);
    this.addSettingTab(new GalleySettingTab(this.app, this));
    this.addCommand({
      id: "show-capabilities",
      name: "Show Galley capabilities",
      callback: () => console.info("Galley capabilities", capabilities)
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
