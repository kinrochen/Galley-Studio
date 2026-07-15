import { Menu, Platform, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import GalleyPlugin from "../../src/main";

afterEach(() => {
  Platform.isMobileApp = false;
});

describe("Galley plugin workbench registration", () => {
  it("opens only canonical Galley HTML through the command and never claims normal HTML", async () => {
    const harness = makeApp("notes/a.galley.html");
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    const command = (plugin as unknown as {
      commands: Array<{
        id: string;
        checkCallback?: (checking: boolean) => boolean;
      }>;
    }).commands.find(({ id }) => id === "open-current-galley-in-workbench");

    expect(command?.checkCallback?.(true)).toBe(true);
    expect(command?.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() => expect(
      (harness.leaf as unknown as { state: unknown }).state
    ).toMatchObject({
      type: "galley-workbench",
      state: { path: "notes/a.galley.html" },
      active: true
    }));
    expect(harness.revealLeaf).toHaveBeenCalledWith(harness.leaf);

    harness.active.path = "notes/a.html";
    expect(command?.checkCallback?.(true)).toBe(false);
    expect(command?.checkCallback?.(false)).toBe(false);
  });

  it("adds a file-menu action only for a Galley file, not ordinary HTML or a lookalike folder", async () => {
    const harness = makeApp("notes/a.md");
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    const listener = harness.fileMenuListener();
    const galleyMenu = new Menu();
    listener(galleyMenu, { path: "notes/a.galley.html", name: "a.galley.html" });
    expect(menuItems(galleyMenu).map(({ title }) => title)).toEqual([
      "Open in Galley workbench",
      "Open Galley preview"
    ]);

    const normalMenu = new Menu();
    listener(normalMenu, { path: "notes/a.html", name: "a.html" });
    expect(menuItems(normalMenu)).toHaveLength(0);

    const folderMenu = new Menu();
    listener(folderMenu, {
      path: "notes/folder.galley.html",
      name: "folder.galley.html",
      children: []
    });
    expect(menuItems(folderMenu)).toHaveLength(0);
  });
});

function makeApp(initialPath: string) {
  const active = { path: initialPath, name: initialPath.split("/").at(-1) ?? "" };
  const leaf = new WorkspaceLeaf();
  const revealLeaf = vi.fn();
  let fileMenu: ((menu: Menu, file: { path: string; name: string; children?: unknown[] }) => void) | null = null;
  const workspace = {
    getActiveFile: () => active,
    getLeaf: () => leaf,
    revealLeaf,
    on: (name: string, callback: typeof fileMenu) => {
      if (name !== "file-menu" || !callback) throw new Error("unexpected event");
      fileMenu = callback;
      return {};
    }
  };
  const app = {
    workspace,
    vault: {},
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    }
  } as unknown as App;
  return {
    app,
    active,
    leaf,
    revealLeaf,
    fileMenuListener: () => {
      if (!fileMenu) throw new Error("file menu was not registered");
      return fileMenu;
    }
  };
}

function menuItems(menu: Menu): Array<{ title: string }> {
  return (menu as unknown as { items: Array<{ title: string }> }).items;
}
