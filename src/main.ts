import { Platform, Plugin } from "obsidian";
import { derivePlatformCapabilities } from "./platform/PlatformCapabilities";

export default class GalleyPlugin extends Plugin {
  async onload(): Promise<void> {
    const capabilities = derivePlatformCapabilities(Platform.isMobileApp);
    this.addCommand({
      id: "show-capabilities",
      name: "Show Galley capabilities",
      callback: () => console.info("Galley capabilities", capabilities)
    });
  }
}
