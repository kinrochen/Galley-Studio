import { afterEach, expect, it, vi } from "vitest";
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

it("persists each provider control as an independent immutable snapshot", async () => {
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
  expect(snapshots).toMatchObject([
    {
      generationAgent: "plugin",
      baseUrl: "https://api.example.com/v1",
      model: "",
      secretId: ""
    },
    { baseUrl: "https://api.example.com/v1", model: "model-x", secretId: "" },
    { model: "model-x", secretId: "provider-key" }
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

it("does not expose low-level generation and output controls", () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  for (const name of ["Temperature", "Timeout (ms)", "Context window", "Output folder"]) {
    expect(tab.containerEl.querySelector(`[data-setting-name="${name}"]`)).toBeNull();
  }
});

it("switches from provider settings to automatic local CLI discovery", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const harness = plugin as unknown as { savedData: unknown };
  const tab = new GalleySettingTab(app, plugin);
  tab.display();

  const agent = tab.containerEl.querySelector<HTMLSelectElement>(
    '[data-setting-name="Generation Agent"] select'
  );
  if (!agent) throw new Error("missing Agent selector");
  agent.value = "codex-cli";
  agent.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(tab.containerEl.querySelector('[data-setting-name="CLI executable"]'))
      .not.toBeNull()
  );
  expect(tab.containerEl.querySelector('[data-setting-name="Base URL"]')).toBeNull();
  expect(
    tab.containerEl.querySelector('[data-setting-name="CLI executable"] input')
  ).toBeNull();

  expect(plugin.settings.generationAgent).toBe("codex-cli");
  expect(harness.savedData).toMatchObject({
    generationAgent: "codex-cli"
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

it("switches localized settings chrome after persistence without losing values", async () => {
  const app = makeAppWithSecret("provider-key", "raw-provider-secret");
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  await plugin.onload();
  const tab = (
    plugin as unknown as { settingTabs: GalleySettingTab[] }
  ).settingTabs[0]!;
  plugin.settings.model = "stateful-model";
  plugin.settings.secretId = "provider-key";
  tab.display();
  const language = tab.containerEl.querySelector<HTMLSelectElement>(
    '[data-setting-name="Language"] select'
  );
  if (!language) throw new Error("missing language setting");

  language.value = "zh-CN";
  language.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(
      tab.containerEl.querySelector('[data-setting-name="模型"]')
    ).not.toBeNull()
  );

  expect(plugin.settings.language).toBe("zh-CN");
  expect(
    tab.containerEl.querySelector<HTMLInputElement>(
      '[data-setting-name="模型"] input'
    )?.value
  ).toBe("stateful-model");
  expect(
    tab.containerEl.querySelector<HTMLInputElement>(
      '[data-setting-name="API 密钥"] input'
    )?.value
  ).toBe("provider-key");
});

it("registers the Agent availability check only on desktop", async () => {
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
      id: "check-generation-agent-availability",
      name: "Galley Studio: Check Agent availability / 检查 Agent 可用性"
    })
  );
  expect(
    desktopHarness.settingTabs[0]?.containerEl.querySelector(
      '[data-setting-name="Agent availability"] button'
    )?.textContent
  ).toBe("Check Agent availability");

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
      id: "check-generation-agent-availability"
    })
  );
  expect(
    mobileHarness.settingTabs[0]?.containerEl.querySelector(
      '[data-setting-name="Agent availability"]'
    )
  ).toBeNull();
});

it("shows only the result of one minimal model call", async () => {
  const secret = "raw-provider-secret";
  const app = makeAppWithSecret("provider-key", secret);
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  const providerResponses = [openAiContent("OK")];
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
    ({ id }) => id === "check-generation-agent-availability"
  );
  await command?.callback?.();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers).toMatchObject({
    Authorization: `Bearer ${secret}`
  });
  expect(notices).toHaveLength(1);
  expect(openedModals).toHaveLength(1);
  const visibleSurface = `${notices.join("\n")}\n${
    openedModals[0]?.titleEl.textContent ?? ""
  }\n${openedModals[0]?.contentEl.textContent ?? ""}`;
  expect(visibleSurface).toContain("diagnostic-model");
  expect(visibleSurface).toContain("Available");
  expect(visibleSurface).not.toContain("SKILL.md");
  expect(visibleSurface).not.toContain("tool-calls");
  expect(visibleSurface).not.toContain(secret);
  expect(visibleSurface).not.toContain("Authorization");
  expect(visibleSurface).not.toContain("OK");
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
