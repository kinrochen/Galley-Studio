import { describe, expect, it, vi } from "vitest";
import type { HtmlEditorAdapter } from "../../src/editor/HtmlEditorAdapter";
import {
  EditorFactory,
  VisualEditorUnavailableError
} from "../../src/editor/EditorFactory";

function capabilities(canEdit: boolean) {
  return {
    canGenerate: canEdit,
    canEdit,
    canImportSkill: canEdit,
    canPreview: true
  };
}

function adapter(): HtmlEditorAdapter {
  return {
    mount: vi.fn(async () => undefined),
    getHtml: vi.fn(() => ""),
    setHtml: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn()
  };
}

describe("EditorFactory", () => {
  it("never invokes the HugeRTE loader on mobile", async () => {
    const loader = vi.fn(async () => adapter());
    const factory = new EditorFactory(loader);

    await expect(factory.createVisual(capabilities(false))).rejects.toEqual(
      expect.objectContaining({
        code: "visual_editor_unavailable",
        name: "VisualEditorUnavailableError"
      })
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("lazily loads exactly one visual adapter on desktop", async () => {
    const visual = adapter();
    const loader = vi.fn(async () => visual);
    const factory = new EditorFactory(loader);

    await expect(factory.createVisual(capabilities(true))).resolves.toBe(visual);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("propagates loader failure without manufacturing an adapter", async () => {
    const failure = new Error("chunk failed");
    const loader = vi.fn(async () => Promise.reject(failure));
    const factory = new EditorFactory(loader);

    await expect(factory.createVisual(capabilities(true))).rejects.toBe(failure);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("gates source-body editing on the same edit capability", () => {
    const factory = new EditorFactory(async () => adapter());

    expect(() => factory.createSource(capabilities(false))).toThrow(
      VisualEditorUnavailableError
    );
    expect(factory.createSource(capabilities(true))).toEqual(
      expect.objectContaining({
        mount: expect.any(Function),
        destroy: expect.any(Function)
      })
    );
  });
});
