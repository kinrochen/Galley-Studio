import { expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GalleyPlugin from "../../src/main";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/settings/GalleySettings";

it("normalizes provider settings without an apiKey field", () => {
  const settings = normalizeSettings({
    baseUrl: "https://api.example.com/",
    model: "x",
    apiKey: "leak"
  });

  expect(settings.baseUrl).toBe("https://api.example.com");
  expect(settings).not.toHaveProperty("apiKey");
  expect(settings.secretId).toBe("");
  expect(DEFAULT_SETTINGS.contextWindow).toBe(128_000);
});

it("uses field defaults for non-finite numeric settings", () => {
  const settings = normalizeSettings({
    temperature: "not-a-number",
    timeoutMs: Number.POSITIVE_INFINITY,
    contextWindow: Number.NaN
  });

  expect(settings.temperature).toBe(DEFAULT_SETTINGS.temperature);
  expect(settings.timeoutMs).toBe(DEFAULT_SETTINGS.timeoutMs);
  expect(settings.contextWindow).toBe(DEFAULT_SETTINGS.contextWindow);
});

it("loads normalized settings and saves only the normalized settings object", async () => {
  const plugin = new GalleyPlugin({} as App, {} as PluginManifest);
  const harness = plugin as unknown as {
    testData: unknown;
    savedData: unknown;
  };
  harness.testData = {
    baseUrl: "https://api.example.com/",
    model: "model-x",
    secretId: "galley-key",
    apiKey: "must-not-persist"
  };

  await plugin.onload();

  expect(plugin.settings).toMatchObject({
    baseUrl: "https://api.example.com",
    model: "model-x",
    secretId: "galley-key"
  });
  expect(plugin.settings).not.toHaveProperty("apiKey");

  await plugin.saveSettings();

  expect(harness.savedData).toEqual(plugin.settings);
  expect(JSON.stringify(harness.savedData)).not.toContain("must-not-persist");
});
