import { expect, it, vi } from "vitest";

import { ArticlePage } from "../../src/console/ArticlePage";
import type { GalleyActions } from "../../src/console/GalleyActions";
import type { UnavailableArticleReason } from "../../src/console/ConsoleTypes";
import { LocaleStore } from "../../src/i18n/LocaleStore";

it("shows only Edit on desktop and only Preview on mobile", async () => {
  const openWorkbench = vi.fn(async () => undefined);
  const openPreview = vi.fn(async () => undefined);
  const actions: GalleyActions = {
    desktop: { openWorkbench },
    inspectActiveContext: async () => ({ kind: "empty" }),
    listArticles: async () => ({
      documents: [{
        htmlPath: "notes/article.html",
        sidecarPath: "",
        sourcePath: "notes/article.md",
        documentId: "article",
        themeId: "paper",
        model: "model",
        generatedAt: "2026-07-16T00:00:00.000Z",
        modifiedAt: 0,
        exportCount: 0,
        validation: "valid"
      }],
      unavailable: []
    }),
    openPreview,
    generateActiveMarkdown: async () => {
      throw new Error("unused");
    },
    setLanguage: async () => undefined
  };
  const render = async (mobile: boolean): Promise<HTMLElement> => {
    const container = document.createElement("div");
    await ArticlePage(container, {
      actions,
      text: new LocaleStore({ language: "en", obsidianLocale: () => "en" }),
      mobile,
      state: { query: "" },
      run: async (_operation, action) => {
        await action(new AbortController().signal);
      }
    });
    return container;
  };

  const desktop = await render(false);
  expect(desktop.querySelector('[data-action="preview"]')).toBeNull();
  expect(desktop.querySelector('[data-action="edit"]')?.textContent).toBe("Edit");

  const mobile = await render(true);
  expect(mobile.querySelector('[data-action="edit"]')).toBeNull();
  expect(mobile.querySelector('[data-action="preview"]')?.textContent).toBe("Preview");
});

it("maps every typed unavailable reason to localized article chrome", async () => {
  const reasons: readonly UnavailableArticleReason[] = [
    "missing_sidecar",
    "missing_html",
    "invalid_sidecar",
    "invalid_document",
    "html_hash_mismatch",
    "unreadable"
  ];
  const actions: GalleyActions = {
    inspectActiveContext: async () => ({ kind: "empty" }),
    listArticles: async () => ({
      documents: [],
      unavailable: reasons.map((reason) => ({ path: `${reason}.galley.html`, reason }))
    }),
    openPreview: async () => undefined,
    generateActiveMarkdown: async () => {
      throw new Error("unused");
    },
    setLanguage: async () => undefined
  };
  const container = document.createElement("div");
  await ArticlePage(container, {
    actions,
    text: new LocaleStore({ language: "zh-CN", obsidianLocale: () => "zh-CN" }),
    mobile: false,
    state: { query: "" },
    run: async (_operation, action) => {
      await action(new AbortController().signal);
    }
  });

  const surface = container.textContent ?? "";
  for (const rawReason of reasons) expect(surface).not.toContain(`：${rawReason}`);
  expect(surface).toContain("缺少元数据侧车文件");
  expect(surface).toContain("缺少 HTML 文件");
  expect(surface).toContain("HTML 哈希不匹配");
  expect(surface).toContain("文件无法读取");
});
