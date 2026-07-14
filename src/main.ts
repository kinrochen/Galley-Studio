import { Modal, Notice, Platform, Plugin } from "obsidian";
import {
  type ConnectionDiagnosticResult,
  runConnectionDiagnostic
} from "./diagnostics/ConnectionDiagnostic";
import { createObsidianTransport } from "./diagnostics/ObsidianTransport";
import {
  derivePlatformCapabilities,
  type PlatformCapabilities
} from "./platform/PlatformCapabilities";
import { ObsidianSecretStore } from "./secrets/SecretStore";
import {
  type GalleySettings,
  normalizeSettings
} from "./settings/GalleySettings";
import { GalleySettingTab } from "./settings/GalleySettingTab";

export default class GalleyPlugin extends Plugin {
  settings: GalleySettings = normalizeSettings(undefined);
  readonly capabilities: PlatformCapabilities = derivePlatformCapabilities(
    Platform.isMobileApp
  );

  get canGenerate(): boolean {
    return this.capabilities.canGenerate;
  }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.addSettingTab(new GalleySettingTab(this.app, this));
    this.addCommand({
      id: "show-capabilities",
      name: "Show Galley capabilities",
      callback: () => console.info("Galley capabilities", this.capabilities)
    });
    if (this.canGenerate) {
      this.addCommand({
        id: "check-model-connection-and-skill-loading",
        name: "Galley: Check model connection and Skill loading",
        callback: () => this.checkModelConnectionAndSkillLoading()
      });
    }
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  async checkModelConnectionAndSkillLoading(): Promise<void> {
    if (!this.canGenerate) {
      return;
    }

    const result = await runConnectionDiagnostic(
      {
        settings: this.settings,
        secretStore: new ObsidianSecretStore(this.app),
        transport: createObsidianTransport()
      },
      new AbortController().signal
    );

    new Notice(diagnosticSummary(result));
    new ConnectionDiagnosticModal(this.app, result).open();
  }
}

class ConnectionDiagnosticModal extends Modal {
  constructor(app: GalleyPlugin["app"], result: ConnectionDiagnosticResult) {
    super(app);
    this.titleEl.textContent = "Galley connection and Skill diagnostic";
    this.contentEl.replaceChildren();
    appendFact(this.contentEl, "Status", result.ok ? "Passed" : "Failed");
    appendFact(this.contentEl, "Model", result.model);
    appendFact(
      this.contentEl,
      "Tools",
      result.capabilities.tools ? "Supported" : "Not observed"
    );
    appendFact(
      this.contentEl,
      "Streaming",
      result.capabilities.streaming ? "Supported" : "Not observed"
    );
    appendFact(
      this.contentEl,
      "Vision",
      result.capabilities.vision ? "Supported" : "Not observed"
    );
    appendFact(this.contentEl, "Skill version", result.skillVersion);
    appendFact(this.contentEl, "Skill load mode", result.skillLoadMode);
    if (result.errorCode) {
      appendFact(this.contentEl, "Error code", result.errorCode);
    }

    const filesHeading = document.createElement("p");
    filesHeading.textContent = "Skill files:";
    const files = document.createElement("ul");
    for (const path of result.skillFiles) {
      const item = document.createElement("li");
      item.textContent = path;
      files.append(item);
    }
    this.contentEl.append(filesHeading, files);
  }
}

function appendFact(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement("p");
  row.textContent = `${label}: ${value}`;
  container.append(row);
}

function diagnosticSummary(result: ConnectionDiagnosticResult): string {
  if (!result.ok) {
    return `Galley diagnostic failed (${result.errorCode ?? "diagnostic_failed"}).`;
  }
  return `Galley diagnostic passed: Skill loaded via ${result.skillLoadMode}.`;
}
