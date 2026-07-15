import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Platform } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import GalleyPlugin from "../../src/main";

afterEach(() => { Platform.isMobileApp = false; });

it("keeps Theme Lab and Skill import behind a desktop-only dynamic boundary", async () => {
  const main = readFileSync(resolve("src/main.ts"), "utf8");
  expect(main).not.toMatch(
    /from\s+["'][^"']*(?:ThemeGenerationService|SkillArchiveImporter|ImportedSkillRepository)["']/u
  );
  expect(main).toContain('import("./platform/DesktopThemeRuntime")');

  Platform.isMobileApp = true;
  const app = {
    workspace: {
      getActiveFile: () => null,
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
  const commandIds = (
    plugin as unknown as { commands: Array<{ id: string }> }
  ).commands.map(({ id }) => id);

  expect(
    commandIds.some((id) =>
      /theme-(?:lab|import|export|toggle|delete)|skill-(?:import|activate)/u.test(id)
    )
  ).toBe(false);
});
