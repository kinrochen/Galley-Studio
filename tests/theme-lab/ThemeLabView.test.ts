import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "../../src/theme-lab/ThemeLabView";
import type { ThemeDraft } from "../../src/theme-lab/ThemeGenerationService";
import { customThemeManifest, validComponentLibrary, validThemePreview } from "../support/phase5Fixtures";
import { LocaleStore } from "../../src/i18n/LocaleStore";

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
  it("preserves description, draft, issues, and preview when language changes", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate: async () => draft(true),
      save: vi.fn(),
      report: vi.fn(),
      locale
    });
    await view.onOpen();
    const description = view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!;
    description.value = "Warm editorial paper";
    [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate draft"
    )!.click();
    await vi.waitFor(() => expect(view.contentEl.querySelector("iframe")).not.toBeNull());
    const frame = view.contentEl.querySelector("iframe");
    const srcdoc = frame?.getAttribute("srcdoc");

    locale.configure("zh-CN");

    expect(description.value).toBe("Warm editorial paper");
    expect(view.contentEl.querySelector("iframe")).toBe(frame);
    expect(frame?.getAttribute("srcdoc")).toBe(srcdoc);
    expect(view.contentEl.textContent).toContain("保存主题");
  });

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
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain(
        "The theme draft contains a validation issue."
      )
    );
    const saveButton = [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Save theme"
    );
    expect(saveButton?.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an oversized reference from File.size before allocating its bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(12));
    const generate = vi.fn(async () => draft(true));
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => true,
      generate,
      save: vi.fn(),
      report: vi.fn()
    });
    await view.onOpen();
    const input = view.contentEl.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{
        name: "oversized.png",
        type: "image/png",
        size: 10 * 1024 * 1024 + 1,
        arrayBuffer
      }]
    });
    view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!.value = "Reference";
    [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate draft"
    )!.click();

    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toMatch(/10 MiB|too large/iu)
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("stores a stable failure key so a live locale change retranslates the status", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate: async () => {
        throw new Error("provider secret must not render");
      },
      save: vi.fn(),
      report: vi.fn(),
      locale
    });
    await view.onOpen();
    view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!.value = "Failure";
    [...view.contentEl.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate draft"
    )!.click();
    await vi.waitFor(() =>
      expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
        .toBe("Theme operation failed.")
    );

    locale.configure("zh-CN");

    expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
      .toBe("主题操作失败。");
    expect(view.contentEl.textContent).not.toContain("provider secret");
  });
});
