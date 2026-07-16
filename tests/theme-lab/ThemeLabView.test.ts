import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  composeConversationDescription,
  GALLEY_THEME_LAB_VIEW_TYPE,
  ThemeLabView
} from "../../src/theme-lab/ThemeLabView";
import type {
  ThemeDraft,
  ThemeGenerationInput
} from "../../src/theme-lab/ThemeGenerationService";
import {
  customThemeManifest,
  validComponentLibrary,
  validThemeConceptPreview,
  validThemePreview
} from "../support/phase5Fixtures";
import { LocaleStore } from "../../src/i18n/LocaleStore";

function draft(
  valid: boolean,
  name = "Custom Theme",
  primaryColor = "#336699",
  finalized = false
): ThemeDraft {
  return {
    manifest: {
      ...customThemeManifest(),
      name,
      primaryColor
    },
    componentLibrary: finalized ? validComponentLibrary() : "",
    previewHtml: finalized
      ? validThemePreview()
      : validThemeConceptPreview(),
    description: "Cumulative theme conversation",
    finalized,
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
  it("preserves the conversation, draft, and preview when language changes", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate: async () => draft(true),
      save: vi.fn(),
      report: vi.fn(),
      locale
    });
    await view.onOpen();
    const composer = view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!;
    composer.value = "Warm editorial paper";
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();
    await vi.waitFor(() => expect(view.contentEl.querySelector("iframe")).not.toBeNull());
    const frame = view.contentEl.querySelector("iframe");
    const srcdoc = frame?.getAttribute("srcdoc");

    locale.configure("zh-CN");

    expect(
      view.contentEl.querySelector(".galley-theme-lab__message.is-user")
        ?.textContent
    ).toContain("Warm editorial paper");
    expect(view.contentEl.querySelector("iframe")).toBe(frame);
    expect(frame?.getAttribute("srcdoc")).toBe(srcdoc);
    expect(view.contentEl.textContent).toContain("保存主题");
    expect(view.contentEl.textContent).toContain("继续提出修改");
  });

  it("carries every turn into refinements and saves only the latest explicit draft", async () => {
    const first = draft(true, "Ocean Notes", "#225577");
    const refined = draft(true, "Deep Ocean Notes", "#123344");
    const finalized = draft(
      true,
      "Deep Ocean Notes",
      "#123344",
      true
    );
    const generate = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(refined);
    const save = vi.fn().mockResolvedValue(finalized);
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => true,
      generate,
      save,
      report: vi.fn()
    });
    await view.onOpen();
    const composer = view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!;
    const send = view.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="theme-generate"]'
    )!;
    composer.value = "Ocean research notebook";
    send.click();
    await vi.waitFor(() => expect(view.contentEl.querySelector("iframe")).not.toBeNull());

    expect(save).not.toHaveBeenCalled();
    expect(view.contentEl.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
    composer.value = "Use a much darker green-blue and more compact headings";
    send.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain("Deep Ocean Notes")
    );

    expect(generate.mock.calls[0]?.[0].description).toBe(
      composeConversationDescription(["Ocean research notebook"])
    );
    expect(generate.mock.calls[1]?.[0].description).toBe(
      composeConversationDescription([
        "Ocean research notebook",
        "Use a much darker green-blue and more compact headings"
      ])
    );
    const saveButton = view.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="theme-save"]'
    )!;
    expect(saveButton.disabled).toBe(false);
    saveButton.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toBe(refined);
    expect(save.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(save).not.toHaveBeenCalledWith(
      first,
      expect.anything(),
      expect.anything()
    );
    await vi.waitFor(() =>
      expect(
        view.contentEl.querySelector("iframe")?.getAttribute("srcdoc")
      ).toContain('data-galley-theme-block="45"')
    );
    expect(saveButton.disabled).toBe(true);
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
    const composer = view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!;
    composer.value = "Invalid experiment";
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain(
        "The theme draft contains a validation issue."
      )
    );
    const saveButton = view.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="theme-save"]'
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
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();

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
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();
    await vi.waitFor(() =>
      expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
        .toBe("Theme operation failed.")
    );

    locale.configure("zh-CN");

    expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
      .toBe("主题操作失败。");
    expect(view.contentEl.textContent).not.toContain("provider secret");
  });

  it("shows an actionable localized reason when final theme validation fails", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate: async () => draft(true),
      save: async () => {
        throw Object.assign(new Error("private validator details"), {
          code: "theme_validation_failed"
        });
      },
      report: vi.fn(),
      locale
    });
    await view.onOpen();
    view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!.value =
      "Science fiction editorial";
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();
    await vi.waitFor(() =>
      expect(
        view.contentEl.querySelector<HTMLButtonElement>(
          '[data-action="theme-save"]'
        )?.disabled
      ).toBe(false)
    );
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-save"]')
      ?.click();

    await vi.waitFor(() =>
      expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
        .toBe("The complete theme did not pass validation. Save again to regenerate it.")
    );
    expect(view.contentEl.textContent).not.toContain("private validator details");

    locale.configure("zh-CN");
    expect(view.contentEl.querySelector(".galley-theme-lab__status")?.textContent)
      .toBe("完整主题未通过校验，请再次点击保存重新生成。");
  });

  it("shows elapsed progress and lets the user cancel a slow request", async () => {
    let requestSignal: AbortSignal | undefined;
    const generate = vi.fn(
      async (
        _input: ThemeGenerationInput,
        signal: AbortSignal
      ): Promise<ThemeDraft> => {
        requestSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true }
          );
        });
        return draft(true);
      }
    );
    const view = new ThemeLabView(new WorkspaceLeaf(), {
      supportsVision: async () => false,
      generate,
      save: async (value) => value,
      report: vi.fn()
    });
    await view.onOpen();
    view.contentEl.querySelector<HTMLTextAreaElement>("textarea")!.value =
      "Slow science fiction concept";
    view.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();

    await vi.waitFor(() =>
      expect(
        view.contentEl.querySelector(".galley-theme-lab__status")?.textContent
      ).toContain("lightweight preview")
    );
    const cancel = view.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="theme-cancel"]'
    )!;
    expect(cancel.hidden).toBe(false);
    cancel.click();

    expect(requestSignal?.aborted).toBe(true);
    expect(cancel.hidden).toBe(true);
    expect(
      view.contentEl.querySelector(".galley-theme-lab__status")?.textContent
    ).toBe("Theme generation cancelled.");
  });
});
