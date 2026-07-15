import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "../../src/theme-lab/ThemeLabView";
import type { ThemeDraft } from "../../src/theme-lab/ThemeGenerationService";
import { customThemeManifest, validComponentLibrary, validThemePreview } from "../support/phase5Fixtures";

function draft(valid: boolean): ThemeDraft {
  return {
    manifest: customThemeManifest(),
    componentLibrary: validComponentLibrary(),
    previewHtml: validThemePreview(),
    skillAudit: {
      skillId: "gzh-design",
      skillVersion: "test",
      packageHash: "a".repeat(64),
      loadMode: "injected",
      files: []
    },
    validation: {
      valid,
      issues: valid
        ? []
        : [{ code: "bad", severity: "error", message: "Unsafe component." }]
    }
  };
}

describe("ThemeLabView", () => {
  it("shows a scriptless full-page draft and saves only on explicit click", async () => {
    const generated = draft(true);
    const save = vi.fn().mockResolvedValue(undefined);
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => true,
      generate: async () => generated,
      save,
      report: vi.fn()
    });
    await view.onOpen();
    const description = view.contentEl.querySelector<HTMLTextAreaElement>("textarea");
    const generate = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate draft"
    );
    description!.value = "Ocean research notebook";
    generate!.click();
    await vi.waitFor(() => expect(view.contentEl.querySelector("iframe")).not.toBeNull());

    expect(save).not.toHaveBeenCalled();
    expect(view.contentEl.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
    const saveButton = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Save theme"
    );
    expect(saveButton?.disabled).toBe(false);
    saveButton!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(generated));
    expect(view.getViewType()).toBe(GALLEY_THEME_LAB_VIEW_TYPE);
  });

  it("hides reference upload without vision and disables save on lint errors", async () => {
    const save = vi.fn();
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate: async () => draft(false),
      save,
      report: vi.fn()
    });
    await view.onOpen();
    expect(view.contentEl.querySelector('input[type="file"]')).toBeNull();
    const description = view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!;
    description.value = "Invalid experiment";
    [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate draft"
    )!.click();
    await vi.waitFor(() => expect(view.contentEl.textContent).toContain("Unsafe component."));
    const saveButton = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Save theme"
    );
    expect(saveButton?.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
