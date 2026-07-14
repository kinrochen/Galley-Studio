import { expect, it } from "vitest";
import type { App, PluginManifest, SecretStorage } from "obsidian";
import GalleyPlugin from "../../src/main";
import { GalleySettingTab } from "../../src/settings/GalleySettingTab";

it("persists edits from each settings control without persisting the raw secret", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  changeValue(tab.containerEl, "Base URL", "https://api.example.com/v1");
  changeValue(tab.containerEl, "Model", "model-x");
  changeValue(tab.containerEl, "API key", "provider-key");
  changeValue(tab.containerEl, "Temperature", "0.7");
  changeValue(tab.containerEl, "Timeout (ms)", "90000");
  changeValue(tab.containerEl, "Context window", "64000");
  changeValue(tab.containerEl, "Output folder", "Galley output");

  await Promise.resolve();

  expect(plugin.settings).toMatchObject({
    baseUrl: "https://api.example.com/v1",
    model: "model-x",
    secretId: "provider-key",
    temperature: 0.7,
    timeoutMs: 90_000,
    contextWindow: 64_000,
    outputFolder: "Galley output"
  });
  expect(harness.savedData).toEqual(plugin.settings);
  expect(JSON.stringify(harness.savedData)).not.toContain("raw-provider-secret");
  expect(harness.savedData).not.toHaveProperty("apiKey");
});

it("registers the settings tab when the plugin loads", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { settingTabs: unknown[] };

  await plugin.onload();

  expect(harness.settingTabs).toHaveLength(1);
  expect(harness.settingTabs[0]).toBeInstanceOf(GalleySettingTab);
});

function changeValue(containerEl: HTMLElement, settingName: string, value: string): void {
  const input = containerEl.querySelector<HTMLInputElement>(
    `[data-setting-name="${settingName}"] input`
  );

  if (!input) {
    throw new Error(`Missing settings control: ${settingName}`);
  }

  input.value = value;
  input.dispatchEvent(new Event("change"));
}

function makeAppWithSecret(id: string, value: string): App {
  const secrets = new Map([[id, value]]);
  const secretStorage: Pick<SecretStorage, "getSecret" | "listSecrets" | "setSecret"> = {
    getSecret: (secretId) => secrets.get(secretId) ?? null,
    listSecrets: () => [...secrets.keys()],
    setSecret: (secretId, secret) => {
      secrets.set(secretId, secret);
    }
  };

  return { secretStorage } as App;
}
