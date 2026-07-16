import { Platform, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import GalleyPlugin from "../../src/main";
import { GALLEY_CONSOLE_VIEW_TYPE } from "../../src/console/GalleyConsoleView";

afterEach(() => {
  Platform.isMobileApp = false;
});

describe("plugin console registration", () => {
  it.each([false, true])(
    "registers the same accessible ribbon and console view when mobile=%s",
    async (mobile) => {
      Platform.isMobileApp = mobile;
      const harness = makeApp();
      const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
      await plugin.onload();
      const exposed = plugin as unknown as {
        ribbonIcons: Array<{ icon: string; title: string; callback: () => unknown }>;
        views: Map<string, unknown>;
      };

      expect(exposed.views.has(GALLEY_CONSOLE_VIEW_TYPE)).toBe(true);
      expect(exposed.ribbonIcons).toHaveLength(1);
      expect(exposed.ribbonIcons[0]).toMatchObject({
        icon: "newspaper",
        title: "Open Galley Studio console"
      });
    }
  );

  it("reuses one console leaf, resets home, and never executes a command", async () => {
    const harness = makeApp();
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    const ribbon = (
      plugin as unknown as {
        ribbonIcons: Array<{ callback: () => Promise<void> }>;
      }
    ).ribbonIcons[0];
    if (!ribbon) throw new Error("missing ribbon");

    await ribbon.callback();
    const existingView = { resetHome: vi.fn() };
    harness.leaves[0]!.view = existingView as never;
    await ribbon.callback();

    expect(harness.leaves).toHaveLength(1);
    expect(existingView.resetHome).toHaveBeenCalledTimes(1);
    expect(harness.revealLeaf).toHaveBeenCalledTimes(2);
    expect(harness.getRightLeaf).toHaveBeenCalledTimes(1);
    expect(harness.getRightLeaf).toHaveBeenCalledWith(false);
    expect(harness.getLeaf).not.toHaveBeenCalled();
    expect(harness.detachLeavesOfType).toHaveBeenCalledTimes(1);
    expect(harness.executeCommandById).not.toHaveBeenCalled();
  });

  it("migrates an existing central console leaf into the right sidebar", async () => {
    const harness = makeApp();
    const central = harness.getLeaf("tab");
    await central.setViewState({
      type: GALLEY_CONSOLE_VIEW_TYPE,
      state: { route: "home" },
      active: true
    });
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();

    await plugin.openGalleyConsole();

    expect(harness.detachLeavesOfType)
      .toHaveBeenCalledWith(GALLEY_CONSOLE_VIEW_TYPE);
    expect(harness.getRightLeaf).toHaveBeenCalledWith(false);
    expect(harness.leaves).toHaveLength(1);
    expect(harness.leaves[0]).not.toBe(central);
  });

  it("keeps compatibility command ids with permanent bilingual names", async () => {
    const harness = makeApp();
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    const commands = (plugin as unknown as {
      commands: Array<{ id: string; name: string }>;
    }).commands;

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "generate-current-article",
          name: "Galley Studio: Generate current article / 生成当前文章"
        }),
      ])
    );
    expect(commands.some(({ id }) => id === "theme-import-zip")).toBe(false);
    expect(commands.some(({ id }) => id.startsWith("skill-"))).toBe(false);
  });
});

function makeApp() {
  const leaves: Array<WorkspaceLeaf & { view: unknown }> = [];
  const revealLeaf = vi.fn();
  const executeCommandById = vi.fn();
  const createLeaf = () => {
    const leaf = new WorkspaceLeaf() as WorkspaceLeaf & { view: unknown };
    const original = leaf.setViewState.bind(leaf);
    leaf.setViewState = async (state) => {
      await original(state);
    };
    leaves.push(leaf);
    return leaf;
  };
  const getLeaf = vi.fn((_kind?: string) => createLeaf());
  const getRightLeaf = vi.fn(() => createLeaf());
  const detachLeavesOfType = vi.fn((type: string) => {
    for (let index = leaves.length - 1; index >= 0; index -= 1) {
      const leaf = leaves[index];
      if (
        (leaf as unknown as { state?: { type?: string } }).state?.type === type
      ) {
        leaves.splice(index, 1);
      }
    }
  });
  const workspace = {
    getActiveFile: () => null,
    getLeavesOfType: (type: string) =>
      leaves.filter(
        (leaf) =>
          (leaf as unknown as { state?: { type?: string } }).state?.type === type
      ),
    getLeaf,
    getRightLeaf,
    detachLeavesOfType,
    revealLeaf,
    on: vi.fn(() => ({}))
  };
  const app = {
    workspace,
    vault: {
      getFiles: () => [],
      on: vi.fn(() => ({})),
      offref: vi.fn()
    },
    commands: { executeCommandById },
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    }
  } as unknown as App;
  return {
    app,
    leaves,
    revealLeaf,
    executeCommandById,
    getLeaf,
    getRightLeaf,
    detachLeavesOfType
  };
}
