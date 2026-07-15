import {
  Platform,
  WorkspaceLeaf,
  type App,
  type PluginManifest,
  type TFile,
  type Vault
} from "obsidian";
import { afterEach, expect, it, vi } from "vitest";

import GalleyPlugin from "../../src/main";
import { GALLEY_CONSOLE_VIEW_TYPE } from "../../src/console/GalleyConsoleView";
import { LAZY_WORKBENCH_VIEW_TYPE } from "../../src/platform/LazyDesktopView";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import {
  OBSIDIAN_SESSION_PATHS,
  makeObsidianDocumentSessionFixture
} from "../support/obsidianDocumentSessionFixtures";
import { persistentObsidianVault } from "../support/obsidianVaultFixtures";

interface HarnessView {
  readonly contentEl: HTMLElement;
  getViewType(): string;
  onOpen(): Promise<void> | void;
  onClose(): Promise<void> | void;
  setState?(
    value: unknown,
    result: { history: boolean }
  ): Promise<void> | void;
}

type HarnessLeaf = WorkspaceLeaf & {
  readonly containerEl: HTMLElement;
  state: unknown;
  view: HarnessView | null;
};

afterEach(() => {
  Platform.isMobileApp = false;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("composes ribbon → real console action → lazy production workbench → export UI", async () => {
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  })));
  const fixture = await makeObsidianDocumentSessionFixture("plugin composition");
  const vault = persistentObsidianVault(fixture.backing);
  Object.assign(vault as object, {
    getFiles: () => fixture.backing.paths()
      .map((path) => vault.getFileByPath(path))
      .filter((file): file is TFile => file !== null),
    on: () => ({}),
    offref: () => undefined,
    getResourcePath: (file: TFile) => `app://vault/${file.path}`
  });

  const leaves: HarnessLeaf[] = [];
  const revealLeaf = vi.fn();
  let plugin: GalleyPlugin;
  const workspace = {
    getActiveFile: () => vault.getFileByPath(OBSIDIAN_SESSION_PATHS.html),
    getLeavesOfType: (type: string) => leaves.filter((leaf) =>
      (leaf.state as { type?: string } | null)?.type === type
    ),
    getLeaf: () => {
      const leaf = new WorkspaceLeaf() as unknown as HarnessLeaf;
      const setState = leaf.setViewState.bind(leaf);
      leaf.setViewState = async (state: unknown) => {
        await setState(state as never);
        const type = (state as { type?: string }).type;
        if (!type) return;
        const factory = (
          plugin as unknown as {
            views: Map<string, (target: WorkspaceLeaf) => HarnessView>;
          }
        ).views.get(type);
        if (!factory) return;
        const view = factory(leaf);
        leaf.view = view as never;
        await view.setState?.((state as { state?: unknown }).state ?? {}, {
          history: false
        });
        await view.onOpen();
      };
      leaves.push(leaf);
      document.body.append(leaf.containerEl);
      return leaf;
    },
    revealLeaf,
    on: () => ({}),
    offref: () => undefined
  };
  const app = {
    vault: vault as Vault,
    workspace,
    locale: "en",
    commands: { executeCommandById: vi.fn() },
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    }
  } as unknown as App;
  plugin = new GalleyPlugin(app, {} as PluginManifest);
  (
    plugin as unknown as { testData: unknown }
  ).testData = normalizeSettings({
    model: "composition-model",
    exportConfigurations: [{
      id: "composition-export",
      name: "Composition export",
      profileId: "standard-web",
      outputFolder: "exports",
      fileNameTemplate: "{stem}.composition.html"
    }]
  });
  await plugin.onload();

  const ribbon = (
    plugin as unknown as { ribbonIcons: Array<{ callback: () => unknown }> }
  ).ribbonIcons[0];
  if (!ribbon) throw new Error("missing ribbon");
  await ribbon.callback();

  const consoleLeaf = leaves.find((leaf) =>
    (leaf.state as { type?: string } | null)?.type === GALLEY_CONSOLE_VIEW_TYPE
  );
  expect(consoleLeaf?.view?.getViewType()).toBe(GALLEY_CONSOLE_VIEW_TYPE);
  const edit = consoleLeaf?.view?.contentEl.querySelector<HTMLButtonElement>(
    '[data-action="edit"]'
  );
  expect(edit).not.toBeNull();
  edit?.click();

  await vi.waitFor(() => {
    const lazyLeaf = leaves.find((leaf) =>
      (leaf.state as { type?: string } | null)?.type === LAZY_WORKBENCH_VIEW_TYPE
    );
    expect(lazyLeaf?.view?.getViewType()).toBe(LAZY_WORKBENCH_VIEW_TYPE);
    expect(
      lazyLeaf?.view?.contentEl.querySelector('[data-export-action="export"]')
    ).not.toBeNull();
  }, { timeout: 5_000 });

  const workbenchLeaf = leaves.find((leaf) =>
    (leaf.state as { type?: string } | null)?.type === LAZY_WORKBENCH_VIEW_TYPE
  );
  let exportButton: HTMLButtonElement | null | undefined;
  await vi.waitFor(() => {
    exportButton = workbenchLeaf?.view?.contentEl
      .querySelector<HTMLButtonElement>('[data-export-action="export"]');
    expect(exportButton).not.toBeNull();
    expect(exportButton?.disabled).toBe(false);
  }, { timeout: 10_000 });
  exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await vi.waitFor(() =>
    expect(
      workbenchLeaf?.view?.contentEl.querySelector('[data-export-status]')?.textContent
    ).toContain("exports/article.composition.html"),
  { timeout: 20_000 });
  await vi.waitFor(() =>
    expect(consoleLeaf?.view?.contentEl.querySelector(".galley-console__status")?.textContent)
      .toContain("Done")
  , { timeout: 5_000 });
  expect(fixture.backing.read("exports/article.composition.html"))
    .toMatch(/^<!DOCTYPE html>/u);
  const sidecar = JSON.parse(
    fixture.backing.read(OBSIDIAN_SESSION_PATHS.sidecar) ?? "{}"
  ) as { exports?: Array<{ profileId?: string; path?: string }> };
  expect(sidecar.exports).toContainEqual(expect.objectContaining({
    profileId: "standard-web",
    path: "exports/article.composition.html"
  }));
  expect(revealLeaf).toHaveBeenCalledTimes(2);

  await Promise.all(leaves.map((leaf) => leaf.view?.onClose()));
  plugin.onunload();
}, 30_000);
