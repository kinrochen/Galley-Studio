import { Platform } from "obsidian";

interface DesktopNodeModuleMap {
  readonly electron: {
    readonly clipboard: {
      write(data: { readonly html: string; readonly text: string }): void;
    };
  };
  readonly "node:child_process": typeof import("node:child_process");
  readonly "node:fs": typeof import("node:fs");
  readonly "node:fs/promises": typeof import("node:fs/promises");
  readonly "node:os": typeof import("node:os");
  readonly "node:path": typeof import("node:path");
  readonly "node:process": typeof import("node:process");
}

type DesktopWindow = Window & {
  readonly require?: (specifier: string) => unknown;
};

/**
 * Loads an allowlisted desktop module through Obsidian's Electron bridge.
 * Native ESM imports resolve as app:// requests in the renderer and must not be
 * used here. The Platform guard keeps this bridge unreachable on mobile.
 */
export function loadDesktopNodeModule<K extends keyof DesktopNodeModuleMap>(
  specifier: K
): DesktopNodeModuleMap[K] {
  if (!Platform.isDesktop) {
    throw new Error("Desktop Node modules are unavailable on this platform.");
  }
  const loader = (window as DesktopWindow).require;
  if (typeof loader !== "function") {
    throw new Error("Obsidian's desktop Node module bridge is unavailable.");
  }
  return loader(specifier) as DesktopNodeModuleMap[K];
}
