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
  expect(settings.exportConfigurations).toHaveLength(3);
  expect(settings.language).toBe("auto");
});

it("migrates old settings to auto and the fixed 30-minute timeout", () => {
  const oldSettings = {
    baseUrl: "https://api.example.com/v1/",
    model: "existing-model",
    secretId: "existing-secret",
    temperature: 0.8,
    timeoutMs: 45_000,
    contextWindow: 64_000,
    outputFolder: "Galley",
    activeSkillVersion: "2026.7.15"
  };

  const migrated = normalizeSettings(oldSettings);
  const { language, ...withoutLanguage } = migrated;
  const { language: explicitLanguage, ...explicitWithoutLanguage } =
    normalizeSettings({ ...oldSettings, language: "auto" });

  expect(language).toBe("auto");
  expect(explicitLanguage).toBe("auto");
  expect(withoutLanguage).toEqual(explicitWithoutLanguage);
  expect(migrated.timeoutMs).toBe(1_800_000);
});

it.each(["auto", "zh-CN", "en"] as const)(
  "preserves supported language %s",
  (language) => {
    expect(normalizeSettings({ language }).language).toBe(language);
  }
);

it("normalizes unsupported languages to auto", () => {
  expect(normalizeSettings({ language: "de" }).language).toBe("auto");
  expect(normalizeSettings({ language: null }).language).toBe("auto");
});

it("normalizes the selected generation Agent and local executable paths", () => {
  expect(normalizeSettings({
    generationAgent: "codex-cli",
    codexCliPath: "  /opt/bin/codex  ",
    claudeCliPath: ""
  })).toMatchObject({
    generationAgent: "codex-cli",
    codexCliPath: "/opt/bin/codex",
    claudeCliPath: "claude"
  });
  expect(normalizeSettings({ generationAgent: "unknown" })).toMatchObject({
    generationAgent: "plugin",
    codexCliPath: "codex",
    claudeCliPath: "claude"
  });
});

it("normalizes reusable export configurations and drops unsafe persisted entries", () => {
  const settings = normalizeSettings({
    exportConfigurations: [
      {
        id: "client-handoff",
        name: "Client handoff",
        profileId: "portable-inline",
        outputFolder: "exports/client",
        fileNameTemplate: "{stem}-handoff.html"
      },
      {
        id: "unsafe",
        name: "Unsafe",
        profileId: "standard-web",
        outputFolder: "../outside",
        fileNameTemplate: "{stem}.html"
      }
    ]
  });

  expect(settings.exportConfigurations).toEqual([
    expect.objectContaining({ id: "client-handoff", profileId: "portable-inline" })
  ]);
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

it.each([45_000, 300_000, 600_000, 3_600_000])(
  "migrates legacy timeout %i to 30 minutes",
  (timeoutMs) => {
    expect(normalizeSettings({ timeoutMs }).timeoutMs).toBe(1_800_000);
  }
);

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
