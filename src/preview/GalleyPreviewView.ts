import { ItemView, type WorkspaceLeaf } from "obsidian";

import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { GalleyDocumentCodec } from "../documents/GalleyDocumentCodec";
import type { EditorResourceResolver } from "../editor/EditorResourceResolver";
import { createSafePreviewFrame } from "./SafeHtmlPreview";
import type { PreviewResourceResolver } from "./PreviewResourceResolver";
import {
  ENGLISH_LOCALIZED_TEXT,
  type LocalizedText
} from "../i18n/LocalizedText";

export const GALLEY_PREVIEW_VIEW_TYPE = "galley-studio-preview";

export interface GalleyPreviewViewServices {
  readonly openDocument: (path: string) => Promise<{ readonly html: string }>;
  readonly resourceResolver?: Pick<EditorResourceResolver, "rewriteForDisplay">;
  readonly previewResourceResolver?: Pick<
    PreviewResourceResolver,
    "rewriteForPreview"
  >;
  readonly locale?: LocalizedText;
}

export class GalleyPreviewPathError extends Error {
  readonly code = "galley_preview_path_invalid" as const;

  constructor() {
    super("Galley Studio preview accepts only vault-relative HTML files.");
    this.name = "GalleyPreviewPathError";
  }
}

export class GalleyPreviewView extends ItemView {
  #path: string | null = null;
  readonly #text: LocalizedText;
  #unsubscribeLocale: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly services: GalleyPreviewViewServices
  ) {
    super(leaf);
    this.#text = services.locale ?? ENGLISH_LOCALIZED_TEXT;
    this.navigation = true;
  }

  getViewType(): string {
    return GALLEY_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.#path?.split("/").at(-1) ?? this.#text.t("preview.title");
  }

  getState(): Record<string, unknown> {
    return this.#path ? { file: this.#path } : {};
  }

  async setState(state: unknown): Promise<void> {
    const path = filePathFromState(state);
    if (typeof path === "string") await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    if (!isGalleyPreviewPath(path)) throw new GalleyPreviewPathError();
    const opened = await this.services.openDocument(path);
    this.#path = path;
    this.contentEl.classList.add("galley-preview-view");
    let html = opened.html;
    if (this.services.previewResourceResolver) {
      try {
        const parsed = GalleyDocumentCodec.parse(html);
        html = GalleyDocumentCodec.serialize({
          ...parsed,
          bodyHtml: await this.services.previewResourceResolver.rewriteForPreview(
            parsed.bodyHtml,
            path
          )
        });
      } catch {
        html = await this.services.previewResourceResolver.rewriteForPreview(
          html,
          path
        );
      }
    } else if (this.services.resourceResolver) {
      try {
        const parsed = GalleyDocumentCodec.parse(html);
        html = GalleyDocumentCodec.serialize({
          ...parsed,
          bodyHtml: this.services.resourceResolver.rewriteForDisplay(
            parsed.bodyHtml,
            path
          )
        });
      } catch {
        html = this.services.resourceResolver.rewriteForDisplay(html, path);
      }
    }
    createSafePreviewFrame(
      this.contentEl,
      html,
      this.#text.t("preview.frameTitle")
    );
    this.#unsubscribeLocale ??= this.#text.subscribe(() => {
      const frame = this.contentEl.querySelector("iframe");
      if (frame) frame.title = this.#text.t("preview.frameTitle");
    });
  }

  async onClose(): Promise<void> {
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
    this.contentEl.replaceChildren();
  }
}

function filePathFromState(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  if ("file" in state && typeof state.file === "string") return state.file;
  if ("path" in state && typeof state.path === "string") return state.path;
  return null;
}

export interface GalleyPreviewWorkspace {
  getLeaf(type: "tab"): WorkspaceLeaf;
  getLeavesOfType?(type: string): WorkspaceLeaf[];
  revealLeaf?(leaf: WorkspaceLeaf): void;
}

export async function openGalleyPreview(
  workspace: GalleyPreviewWorkspace,
  path: string
): Promise<void> {
  if (!isGalleyPreviewPath(path)) throw new GalleyPreviewPathError();
  const leaf =
    workspace.getLeavesOfType?.(GALLEY_PREVIEW_VIEW_TYPE)[0] ??
    workspace.getLeaf("tab");
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
    path.endsWith(".html") &&
    path.length - ".html".length > nameStart
  );
}
