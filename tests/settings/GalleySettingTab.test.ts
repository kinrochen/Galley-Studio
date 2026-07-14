import { expect, it } from "vitest";
import type { App, PluginManifest, SecretStorage } from "obsidian";
import GalleyPlugin from "../../src/main";
import { GalleySettingTab } from "../../src/settings/GalleySettingTab";

it("persists each settings control as an independent immutable snapshot", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();
  const snapshots: unknown[] = [];

  changeValue(tab.containerEl, "Base URL", "https://api.example.com/v1");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "Model", "model-x");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "API key", "provider-key");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "Temperature", "0.7");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "Timeout (ms)", "90000");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "Context window", "64000");
  await Promise.resolve();
  snapshots.push(harness.savedData);
  changeValue(tab.containerEl, "Output folder", "Galley output");
  await Promise.resolve();
  snapshots.push(harness.savedData);

  expect(snapshots).toMatchObject([
    { baseUrl: "https://api.example.com/v1", model: "", secretId: "" },
    { baseUrl: "https://api.example.com/v1", model: "model-x", secretId: "" },
    { model: "model-x", secretId: "provider-key", temperature: 0.4 },
    { secretId: "provider-key", temperature: 0.7, timeoutMs: 120_000 },
    { temperature: 0.7, timeoutMs: 90_000, contextWindow: 128_000 },
    { timeoutMs: 90_000, contextWindow: 64_000, outputFolder: "" },
    { contextWindow: 64_000, outputFolder: "Galley output" }
  ]);
  expect(JSON.stringify(snapshots)).not.toContain("raw-provider-secret");
  for (const snapshot of snapshots) {
    expect(snapshot).not.toHaveProperty("apiKey");
  }
});

it("normalizes a trailing slash before persisting a Base URL edit", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  changeValue(tab.containerEl, "Base URL", "https://api.example.com/v1///");
  await Promise.resolve();

  expect(plugin.settings.baseUrl).toBe("https://api.example.com/v1");
  expect(harness.savedData).toMatchObject({ baseUrl: "https://api.example.com/v1" });
});

it("clamps finite numeric UI edits to the configured bounds before persisting", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  changeValue(tab.containerEl, "Temperature", "9");
  changeValue(tab.containerEl, "Timeout (ms)", "1");
  changeValue(tab.containerEl, "Context window", "3000000");
  await Promise.resolve();

  expect(plugin.settings).toMatchObject({
    temperature: 2,
    timeoutMs: 10_000,
    contextWindow: 2_000_000
  });
  expect(harness.savedData).toMatchObject({
    temperature: 2,
    timeoutMs: 10_000,
    contextWindow: 2_000_000
  });
});

it("uses numeric defaults for nonnumeric UI edits before persisting", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  changeValue(tab.containerEl, "Temperature", "invalid");
  changeValue(tab.containerEl, "Timeout (ms)", "invalid");
  changeValue(tab.containerEl, "Context window", "invalid");
  await Promise.resolve();

  expect(plugin.settings).toMatchObject({
    temperature: 0.4,
    timeoutMs: 120_000,
    contextWindow: 128_000
  });
  expect(harness.savedData).toMatchObject({
    temperature: 0.4,
    timeoutMs: 120_000,
    contextWindow: 128_000
  });
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
