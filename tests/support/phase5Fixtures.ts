import { strToU8, zipSync } from "fflate";

import type { ThemeManifestV1 } from "../../src/themes/ThemeManifest";

export const CUSTOM_THEME_ID = "ocean-notes";

export function customThemeManifest(
  overrides: Partial<ThemeManifestV1> = {}
): ThemeManifestV1 {
  return {
    schemaVersion: 1,
    id: CUSTOM_THEME_ID,
    name: "Ocean Notes",
    primaryColor: "#075985",
    useCases: "research notes and technical essays",
    underlineCss: "border-bottom:2px solid #075985;",
    enabled: true,
    license: "AGPL-3.0",
    attribution: "Based on isjiamu/gzh-design-skill",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides
  };
}

export function validComponentLibrary(label = "Ocean"): string {
  return [
    "# Ocean Notes",
    "",
    "## 设计变量速查表",
    "主色 #075985；正文色 #0f172a。",
    "",
    "## 各组件完整 HTML",
    "```html",
    `<section style="color:#0f172a"><span leaf="">${label}</span></section>`,
    "```",
    "",
    "## 完整文章模板骨架",
    "```html",
    "<section><span leaf=\"\">{{正文}}</span></section>",
    "```",
    "",
    "## 文章类型 → 组件组合配方表",
    "| 类型 | 核心组件 |",
    "| --- | --- |",
    "| 教程 | 标题 + 正文 |",
    "",
    "## Markdown → 组件映射规则表",
    "| Markdown | 组件 |",
    "| --- | --- |",
    "| 段落 | 正文 |"
  ].join("\n");
}

export function validThemePreview(label = "Ocean"): string {
  const blocks = Array.from(
    { length: 45 },
    (_, index) =>
      `<section data-galley-theme-block="${index + 1}" style="padding:8px"><span>${label} ${index + 1}</span></section>`
  ).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${label}</title></head><body><article>${blocks}</article></body></html>`;
}

export function themeModelResponse(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    manifest: {
      id: CUSTOM_THEME_ID,
      name: "Ocean Notes",
      primaryColor: "#075985",
      useCases: "research notes and technical essays",
      underlineCss: "border-bottom:2px solid #075985;"
    },
    componentLibrary: validComponentLibrary(),
    previewHtml: validThemePreview(),
    ...overrides
  });
}

export function themeIndexMarkdown(
  id = CUSTOM_THEME_ID,
  name = "Ocean Notes"
): string {
  return [
    "## 已注册主题",
    "",
    "| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |",
    "| --- | --- | --- | --- | --- |",
    `| ${name} | #075985 | research notes | references/theme-${id}.md | border-bottom:2px solid #075985; |`
  ].join("\n");
}

export function validSkillArchive(): Uint8Array {
  return zipSync({
    "SKILL.md": strToU8("---\nname: gzh-design\n---\nWorkflow."),
    "references/theme-index.md": strToU8(themeIndexMarkdown()),
    "references/common-components.md": strToU8("Common components."),
    [`references/theme-${CUSTOM_THEME_ID}.md`]: strToU8(
      validComponentLibrary()
    ),
    "scripts/validate.py": strToU8("raise SystemExit('must never execute')")
  });
}

export function tinyPng(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d
  ]);
}
