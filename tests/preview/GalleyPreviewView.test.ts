import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  GALLEY_PREVIEW_VIEW_TYPE,
  GalleyPreviewView,
  openGalleyPreview
} from "../../src/preview/GalleyPreviewView";
import { EditorResourceResolver } from "../../src/editor/EditorResourceResolver";

const HTML = '<!DOCTYPE html><html lang="zh-CN"><head><title>x</title></head><body><article><p>safe preview</p><script>alert(1)</script></article></body></html>';

describe("GalleyPreviewView", () => {
  it("opens only canonical Galley files in an empty-sandbox, no-referrer iframe", async () => {
    const openDocument = vi.fn(async () => ({ html: HTML }));
    const view = new GalleyPreviewView(new WorkspaceLeaf(), { openDocument });

    await view.openPath("notes/a.galley.html");

    const frame = view.contentEl.querySelector("iframe") as HTMLIFrameElement;
    expect(view.getViewType()).toBe(GALLEY_PREVIEW_VIEW_TYPE);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toContain("Content-Security-Policy");
    expect(frame.srcdoc).not.toContain("<script");
    expect(view.contentEl.querySelector("textarea,[contenteditable=true]")).toBeNull();
    await expect(view.openPath("notes/a.html")).rejects.toMatchObject({ code: "galley_preview_path_invalid" });
  });

  it("opens a preview leaf without claiming an html extension", async () => {
    const leaf = new WorkspaceLeaf();
    const workspace = {
      getLeaf: vi.fn(() => leaf),
      revealLeaf: vi.fn()
    };

    await openGalleyPreview(workspace, "notes/a.galley.html");

    expect((leaf as unknown as { state: unknown }).state).toMatchObject({
      type: GALLEY_PREVIEW_VIEW_TYPE,
      state: { path: "notes/a.galley.html" },
      active: true
    });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it("resolves vault-relative images for srcdoc without leaking temporary markers", async () => {
    const html = HTML.replace("</p>", '<img src="images/cover.png" alt="cover"></p>');
    const view = new GalleyPreviewView(new WorkspaceLeaf(), {
      openDocument: async () => ({ html }),
      resourceResolver: new EditorResourceResolver((path) => `app://vault/${path}`)
    });

    await view.openPath("notes/a.galley.html");

    const srcdoc = (view.contentEl.querySelector("iframe") as HTMLIFrameElement).srcdoc;
    expect(srcdoc).toContain('src="app://vault/images/cover.png"');
    expect(srcdoc).not.toContain("data-galley-original");
  });
});
