import {
  Notice,
  type App,
  type Plugin,
  type WorkspaceLeaf
} from "obsidian";
import type { OpenedGalleyDocumentSession } from "../documents/DocumentSessionOpener";
import { ObsidianDocumentSessionOpener } from "../documents/ObsidianDocumentSessionOpener";
import { EditorFactory } from "../editor/EditorFactory";
import { EditorResourceResolver } from "../editor/EditorResourceResolver";
import type { LocalizedText } from "../i18n/LocalizedText";
import type { GalleySettings } from "../settings/GalleySettings";
import {
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "../theme-lab/ThemeLabView";
import {
  GALLEY_WORKBENCH_VIEW_TYPE,
  GalleyWorkbenchView,
  type GalleyWorkbenchViewServices,
  type WorkbenchDocument
} from "../workbench/GalleyWorkbenchView";
import { requestConfirmation } from "./ConfirmationModal";
import type { PlatformCapabilities } from "./PlatformCapabilities";

export interface DesktopViewHost {
  readonly app: App;
  readonly capabilities: PlatformCapabilities;
  readonly locale: LocalizedText;
  getSettings(): GalleySettings;
}

/** Registers real ItemViews without loading the generation and Skill runtime. */
export function registerDesktopViews(
  plugin: Pick<Plugin, "registerView">,
  host: DesktopViewHost
): void {
  plugin.registerView(GALLEY_THEME_LAB_VIEW_TYPE, (leaf) =>
    createThemeLabView(leaf, host)
  );
  plugin.registerView(GALLEY_WORKBENCH_VIEW_TYPE, (leaf) =>
    createWorkbenchView(leaf, host)
  );
}

export async function openWorkbench(app: App, path: string): Promise<void> {
  if (!path.endsWith(".html")) return;
  const leaf =
    app.workspace.getLeavesOfType?.(GALLEY_WORKBENCH_VIEW_TYPE)[0] ??
    app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: GALLEY_WORKBENCH_VIEW_TYPE,
    state: { path },
    active: true
  });
  await app.workspace.revealLeaf(leaf);
}

export async function openThemeLab(app: App): Promise<void> {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: GALLEY_THEME_LAB_VIEW_TYPE, active: true });
  await app.workspace.revealLeaf(leaf);
}

export function createThemeLabView(
  leaf: WorkspaceLeaf,
  host: DesktopViewHost
): ThemeLabView {
  return new ThemeLabView(leaf, {
    supportsVision: async () => {
      try {
        const runtime = await import("./DesktopThemeRuntime");
        return await runtime.supportsThemeVision(host.app, host.getSettings());
      } catch {
        return false;
      }
    },
    generate: async (input, signal, progress) => {
      const runtime = await import("./DesktopThemeRuntime");
      return runtime.generateThemeDraft(
        host.app,
        host.getSettings(),
        input,
        signal,
        progress
      );
    },
    save: async (draft, signal, progress) => {
      const runtime = await import("./DesktopThemeRuntime");
      return runtime.finalizeAndSaveThemeDraft(
        host.app,
        draft,
        host.getSettings(),
        signal,
        progress
      );
    },
    report: (message) => new Notice(message),
    locale: host.locale
  });
}

export function createWorkbenchView(
  leaf: WorkspaceLeaf,
  host: DesktopViewHost,
  opener = new ObsidianDocumentSessionOpener(host.app.vault),
  editorFactory = new EditorFactory()
): GalleyWorkbenchView {
  const resourceResolver = new EditorResourceResolver((path) => {
    const file = host.app.vault.getFileByPath(path);
    return file ? host.app.vault.getResourcePath(file) : path;
  });
  const services: GalleyWorkbenchViewServices = {
    capabilities: host.capabilities,
    openDocument: async (path) => asWorkbenchDocument(await opener.open(path)),
    createVisualEditor: () => editorFactory.createVisual(host.capabilities),
    createSourceEditor: () => editorFactory.createSource(host.capabilities),
    openCopy: (path) => openWorkbench(host.app, path),
    confirm: (message) => requestConfirmation(host.app, message),
    resourceResolver,
    documentBaseUrl: () => "app://vault/",
    copyHtml: (html) => navigator.clipboard.writeText(html),
    reportCopyOutcome: (message) => new Notice(message),
    locale: host.locale
  };
  return new GalleyWorkbenchView(leaf, services);
}

function asWorkbenchDocument(
  session: OpenedGalleyDocumentSession
): WorkbenchDocument {
  const recovery = session.recoveryState();
  return {
    session,
    recovery: {
      status: recovery.status,
      quarantinedTransactionId:
        recovery.status === "ready" ? null : recovery.transactionId
    },
    listHistory: async () => [...(await session.history())]
  };
}
