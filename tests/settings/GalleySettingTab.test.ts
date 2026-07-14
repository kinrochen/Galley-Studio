import { afterEach, expect, it } from "vitest";
import type { App, PluginManifest, SecretStorage } from "obsidian";
import GalleyPlugin from "../../src/main";
import { GalleySettingTab } from "../../src/settings/GalleySettingTab";
import {
  notices,
  openedModals,
  Platform,
  resetRequestUrlHandler,
  setRequestUrlHandler,
  type RequestUrlParam
} from "../setup/obsidian";

afterEach(() => {
  Platform.isMobileApp = false;
  notices.length = 0;
  openedModals.length = 0;
  resetRequestUrlHandler();
});

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

it("registers the connection and Skill diagnostic only on desktop", async () => {
  const desktop = new GalleyPlugin(
    makeAppWithSecret("provider-key", "raw-provider-secret"),
    {} as PluginManifest
  );
  await desktop.onload();
  const desktopHarness = desktop as unknown as {
    commands: Array<{ id: string; name: string }>;
    settingTabs: GalleySettingTab[];
  };
  desktopHarness.settingTabs[0]?.display();

  expect(desktopHarness.commands).toContainEqual(
    expect.objectContaining({
      id: "check-model-connection-and-skill-loading",
      name: "Galley: Check model connection and Skill loading"
    })
  );
  expect(
    desktopHarness.settingTabs[0]?.containerEl.querySelector(
      '[data-setting-name="Connection and Skill diagnostic"] button'
    )?.textContent
  ).toBe("Check model connection and Skill loading");

  Platform.isMobileApp = true;
  const mobile = new GalleyPlugin(
    makeAppWithSecret("provider-key", "raw-provider-secret"),
    {} as PluginManifest
  );
  await mobile.onload();
  const mobileHarness = mobile as unknown as {
    commands: Array<{ id: string }>;
    settingTabs: GalleySettingTab[];
  };
  mobileHarness.settingTabs[0]?.display();

  expect(mobileHarness.commands).not.toContainEqual(
    expect.objectContaining({
      id: "check-model-connection-and-skill-loading"
    })
  );
  expect(
    mobileHarness.settingTabs[0]?.containerEl.querySelector(
      '[data-setting-name="Connection and Skill diagnostic"]'
    )
  ).toBeNull();
});

it("shows only audited diagnostic facts in the Notice and detail modal", async () => {
  const secret = "raw-provider-secret";
  const app = makeAppWithSecret("provider-key", secret);
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const providerResponses = [
    openAiToolCall("capability", "galley_capability_echo", "{}"),
    openAiContent("galley_stream_probe"),
    openAiToolCall(
      "root",
      "read_skill_file",
      JSON.stringify({ path: "SKILL.md" })
    ),
    openAiToolCall(
      "themes",
      "read_skill_file",
      JSON.stringify({ path: "references/theme-index.md" })
    ),
    openAiContent("provider-content-must-not-be-shown")
  ];
  const requests: RequestUrlParam[] = [];
  setRequestUrlHandler(async (request) => {
    if (typeof request === "string") {
      throw new Error("Expected structured request");
    }
    requests.push(request);
    const response = providerResponses.shift();
    if (!response) {
      throw new Error("Unexpected provider request");
    }
    return response;
  });

  await plugin.onload();
  plugin.settings.model = "diagnostic-model";
  plugin.settings.secretId = "provider-key";
  const command = (
    plugin as unknown as {
      commands: Array<{ id: string; callback?: () => unknown }>;
    }
  ).commands.find(
    ({ id }) => id === "check-model-connection-and-skill-loading"
  );
  await command?.callback?.();

  expect(requests).toHaveLength(5);
  expect(requests[0]?.headers).toMatchObject({
    Authorization: `Bearer ${secret}`
  });
  expect(notices).toHaveLength(1);
  expect(openedModals).toHaveLength(1);
  const visibleSurface = `${notices.join("\n")}\n${
    openedModals[0]?.titleEl.textContent ?? ""
  }\n${openedModals[0]?.contentEl.textContent ?? ""}`;
  expect(visibleSurface).toContain("diagnostic-model");
  expect(visibleSurface).toContain("SKILL.md");
  expect(visibleSurface).toContain("tool-calls");
  expect(visibleSurface).not.toContain(secret);
  expect(visibleSurface).not.toContain("Authorization");
  expect(visibleSurface).not.toContain("galley_stream_probe");
  expect(visibleSurface).not.toContain("provider-content-must-not-be-shown");
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

function openAiContent(content: string): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: "stop"
        }
      ]
    }
  };
}

function openAiToolCall(
  id: string,
  name: string,
  argumentsJson: string
): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: argumentsJson }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    }
  };
}
