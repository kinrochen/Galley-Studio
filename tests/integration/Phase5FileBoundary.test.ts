import { Platform } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import GalleyPlugin from "../../src/main";
import { notices } from "../setup/obsidian";

afterEach(() => {
  Platform.isMobileApp = false;
  notices.length = 0;
  vi.restoreAllMocks();
});

it("rejects an oversized Skill ZIP from File.size before arrayBuffer allocation", async () => {
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, "files", {
      configurable: true,
      value: [{
        name: "oversized.zip",
        type: "application/zip",
        size: 25 * 1024 * 1024 + 1,
        arrayBuffer
      }]
    });
    this.dispatchEvent(new Event("change"));
  });
  const app = {
    workspace: {
      getActiveFile: () => null,
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(),
      on: vi.fn(() => ({}))
    },
    vault: {},
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    }
  } as unknown as App;
  const plugin = new GalleyPlugin(app, {} as PluginManifest);
  await plugin.onload();

  await plugin.importSkillPackage();

  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(notices.at(-1)).toMatch(/25 MiB|too large/iu);
});
