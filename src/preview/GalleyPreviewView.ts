import { ItemView, type WorkspaceLeaf } from "obsidian";

import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { GalleyDocumentCodec } from "../documents/GalleyDocumentCodec";
import type { EditorResourceResolver } from "../editor/EditorResourceResolver";
import { createSafePreviewFrame } from "./SafeHtmlPreview";

export const GALLEY_PREVIEW_VIEW_TYPE = "galley-preview";

export interface GalleyPreviewViewServices {
  readonly openDocument: (path: string) => Promise<{ readonly html: string }>;
  readonly resourceResolver?: Pick<EditorResourceResolver, "rewriteForDisplay">;
}

export class GalleyPreviewPathError extends Error {
  readonly code = "galley_preview_path_invalid" as const;

  constructor() {
    super("Galley preview accepts only canonical *.galley.html artifacts.");
    this.name = "GalleyPreviewPathError";
  }
}

export class GalleyPreviewView extends ItemView {
  #path: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly services: GalleyPreviewViewServices
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return GALLEY_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.#path?.split("/").at(-1) ?? "Galley preview";
  }

  getState(): Record<string, unknown> {
    return this.#path ? { path: this.#path } : {};
  }

  async setState(state: unknown): Promise<void> {
    const path = state && typeof state === "object" && "path" in state
      ? (state as { path?: unknown }).path
      : null;
    if (typeof path === "string") await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    if (!isGalleyPreviewPath(path)) throw new GalleyPreviewPathError();
    const opened = await this.services.openDocument(path);
    this.#path = path;
    this.contentEl.classList.add("galley-preview-view");
    let html = opened.html;
    if (this.services.resourceResolver) {
      const parsed = GalleyDocumentCodec.parse(html);
      html = GalleyDocumentCodec.serialize({
        ...parsed,
        bodyHtml: this.services.resourceResolver.rewriteForDisplay(parsed.bodyHtml)
      });
    }
    createSafePreviewFrame(this.contentEl, html);
  }
}

export interface GalleyPreviewWorkspace {
  getLeaf(type: "tab"): WorkspaceLeaf;
  revealLeaf?(leaf: WorkspaceLeaf): void;
}

export async function openGalleyPreview(
  workspace: GalleyPreviewWorkspace,
  path: string
): Promise<void> {
  if (!isGalleyPreviewPath(path)) throw new GalleyPreviewPathError();
  const leaf = workspace.getLeaf("tab");
  await leaf.setViewState({
    type: GALLEY_PREVIEW_VIEW_TYPE,
    state: { path },
    active: true
  });
  workspace.revealLeaf?.(leaf);
}

export function isGalleyPreviewPath(path: string): boolean {
  const nameStart = path.lastIndexOf("/") + 1;
  return (
    isNormalizedVaultRelativePath(path) &&
    path.endsWith(".galley.html") &&
    path.length - ".galley.html".length > nameStart
  );
}
