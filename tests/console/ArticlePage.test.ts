import { expect, it } from "vitest";

import { ArticlePage } from "../../src/console/ArticlePage";
import type { GalleyActions } from "../../src/console/GalleyActions";
import type { UnavailableArticleReason } from "../../src/console/ConsoleTypes";
import { LocaleStore } from "../../src/i18n/LocaleStore";

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
