import { describe, expect, it, vi } from "vitest";
import {
  createGalleyActions,
  type GalleyActionDependencies
} from "../../src/console/GalleyActions";

describe("GalleyActions", () => {
  it("calls typed generation directly without command execution or prompt input", async () => {
    const generate = vi.fn(async () => ({
      status: "committed" as const,
      htmlPath: "article.galley.html",
      sidecarPath: "article.galley.json"
    }));
    const commandExecute = vi.fn();
    const prompt = vi.spyOn(window, "prompt");
    const actions = createGalleyActions(dependencies({ generate }));
    const signal = new AbortController().signal;

    const result = await actions.generateActiveMarkdown(
      { themeId: "paper-lab" },
      signal
    );

    expect(result).toMatchObject({ htmlPath: "article.galley.html" });
    expect(generate).toHaveBeenCalledWith({ themeId: "paper-lab" }, signal);
    expect(commandExecute).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("passes AbortSignal through and rejects an already-cancelled operation", async () => {
    const generate = vi.fn(async () => ({
      status: "committed" as const,
      htmlPath: "article.galley.html",
      sidecarPath: "article.galley.json"
    }));
    const actions = createGalleyActions(dependencies({ generate }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      actions.generateActiveMarkdown({}, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("exposes desktop actions only when a desktop runtime is supplied", async () => {
    const mobile = createGalleyActions(dependencies());
    expect(mobile.desktop).toBeUndefined();

    const openWorkbench = vi.fn(async () => undefined);
    const desktop = createGalleyActions(
      dependencies({ desktop: { openWorkbench } })
    );
    expect(desktop.desktop).toBeDefined();
    await desktop.desktop?.openWorkbench("a.galley.html");
    expect(openWorkbench).toHaveBeenCalledWith("a.galley.html");
  });

  it("persists language before publishing the locale change", async () => {
    const order: string[] = [];
    const actions = createGalleyActions(
      dependencies({
        saveLanguage: async () => {
          order.push("persist");
        },
        publishLanguage: () => {
          order.push("publish");
        }
      })
    );

    await actions.setLanguage("zh-CN");

    expect(order).toEqual(["persist", "publish"]);
  });
});

function dependencies(
  overrides: Partial<GalleyActionDependencies> = {}
): GalleyActionDependencies {
  return {
    inspectActiveContext: async () => ({ kind: "empty" }),
    listArticles: async () => ({ documents: [], unavailable: [] }),
    openPreview: async () => undefined,
    saveLanguage: async () => undefined,
    publishLanguage: () => undefined,
    ...overrides
  };
}
