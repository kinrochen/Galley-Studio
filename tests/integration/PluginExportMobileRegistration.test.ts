import { Platform, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import GalleyPlugin from "../../src/main";
import { GALLEY_PREVIEW_VIEW_TYPE } from "../../src/preview/GalleyPreviewView";
import { GALLEY_WORKBENCH_VIEW_TYPE } from "../../src/workbench/GalleyWorkbenchView";

afterEach(() => { Platform.isMobileApp = false; });

describe("desktop export and mobile preview registration", () => {
  it("registers only preview access on mobile and never workbench, generation, or repair commands", async () => {
    Platform.isMobileApp = true;
    const harness = makeApp("notes/a.galley.html");
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    const exposed = plugin as unknown as {
      commands: Array<{ id: string }>;
      views: Map<string, unknown>;
    };
    const commandIds = exposed.commands.map(({ id }) => id);

    expect([...exposed.views.keys()]).toEqual([
      "galley-console",
      GALLEY_PREVIEW_VIEW_TYPE
    ]);
    expect(commandIds).toContain("open-current-galley-preview");
    expect(commandIds).not.toContain("open-current-galley-in-workbench");
    expect(commandIds).not.toContain("generate-current-article");
    expect(commandIds).not.toContain("check-model-connection-and-skill-loading");
    expect(commandIds.some((id) => /repair|skill-import/u.test(id))).toBe(false);
    expect(harness.registerExtensions).not.toHaveBeenCalled();
  });

  it("registers desktop preview plus workbench/export capabilities but still does not claim ordinary html", async () => {
    const harness = makeApp("notes/a.galley.html");
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();

    const views = (plugin as unknown as { views: Map<string, unknown> }).views;
    expect([...views.keys()]).toEqual(expect.arrayContaining([
      GALLEY_PREVIEW_VIEW_TYPE,
      GALLEY_WORKBENCH_VIEW_TYPE
    ]));
    expect(harness.registerExtensions).not.toHaveBeenCalled();
  });
});

function makeApp(path: string) {
  const active = { path, name: path.split("/").at(-1) ?? "" };
  const leaf = new WorkspaceLeaf();
  const registerExtensions = vi.fn();
  const workspace = {
    getActiveFile: () => active,
    getLeaf: () => leaf,
    revealLeaf: vi.fn(),
    on: vi.fn(() => ({}))
  };
  const app = {
    workspace,
    vault: {},
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    },
    registerExtensions
  } as unknown as App;
  return { app, registerExtensions };
}
