import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";

import { loadDesktopNodeModule } from "../../src/platform/DesktopNodeModuleLoader";

type MutableDesktopWindow = Window & {
  require?: (specifier: string) => unknown;
};

afterEach(() => {
  Reflect.deleteProperty(Platform, "isDesktop");
  Reflect.deleteProperty(window as MutableDesktopWindow, "require");
});

describe("DesktopNodeModuleLoader", () => {
  it("rejects Node module access outside Obsidian Desktop", () => {
    Object.defineProperty(Platform, "isDesktop", {
      configurable: true,
      value: false
    });

    expect(() => loadDesktopNodeModule("node:path")).toThrow(
      "Desktop Node modules are unavailable"
    );
  });

  it("uses Obsidian's allowlisted Electron bridge on Desktop", () => {
    Object.defineProperty(Platform, "isDesktop", {
      configurable: true,
      value: true
    });
    const pathModule = { join: vi.fn() };
    const loader = vi.fn(() => pathModule);
    (window as MutableDesktopWindow).require = loader;

    expect(loadDesktopNodeModule("node:path")).toBe(pathModule);
    expect(loader).toHaveBeenCalledWith("node:path");
  });
});
