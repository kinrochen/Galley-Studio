import { Platform } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import GalleyPlugin from "../../src/main";

afterEach(() => {
  Platform.isMobileApp = false;
});

it("does not expose Skill import or activation through the plugin UI API", async () => {
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

  const exposed = plugin as unknown as {
    commands: readonly { readonly id: string }[];
    importSkillPackage?: unknown;
    activateImportedSkill?: unknown;
  };
  expect(exposed.importSkillPackage).toBeUndefined();
  expect(exposed.activateImportedSkill).toBeUndefined();
  expect(exposed.commands.some(({ id }) => id.startsWith("skill-"))).toBe(false);
});
