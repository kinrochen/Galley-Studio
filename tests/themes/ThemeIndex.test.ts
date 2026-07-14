import { describe, expect, it } from "vitest";

import { BundledSkillLoader } from "../../src/skill/BundledSkillLoader";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import { parseThemeIndex } from "../../src/themes/ThemeIndex";

async function loadPinnedSkill() {
  const skill = await new BundledSkillLoader().load();
  const index = skill.files.get("references/theme-index.md");
  if (index === undefined) {
    throw new Error("Pinned Skill is missing its theme index");
  }
  return { index, vfs: new SkillVirtualFileSystem(skill.files) };
}

describe("parseThemeIndex", () => {
  it("parses the six registered themes from the pinned Skill", async () => {
    const { index } = await loadPinnedSkill();

    const themes = parseThemeIndex(index);

    expect(themes).toHaveLength(6);
    expect(themes.map(({ id, file }) => ({ id, file }))).toEqual([
      {
        id: "moyu-green",
        file: "references/theme-moyu-green.md"
      },
      {
        id: "red-white",
        file: "references/theme-red-white.md"
      },
      {
        id: "graphite-minimal",
        file: "references/theme-graphite-minimal.md"
      },
      {
        id: "zen-whitespace",
        file: "references/theme-zen-whitespace.md"
      },
      {
        id: "moyu-ticket",
        file: "references/theme-moyu-ticket.md"
      },
      {
        id: "olive-journal",
        file: "references/theme-olive-journal.md"
      }
    ]);
    expect(themes[0]).toEqual({
      id: "moyu-green",
      name: "摸鱼绿",
      primaryColor: "#059669 emerald",
      useCases: "教程、测评、清单、工具盘点（卡片丰富、信息密度高，默认推荐）",
      file: "references/theme-moyu-green.md",
      underlineCss: "border-bottom:2px solid #A7F3D0;font-weight:600;"
    });
  });

  it("parses only the table beneath the registered-theme heading", () => {
    const index = `# Theme index

| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |
|---|---|---|---|---|
| ignored | black | ignored | \`references/theme-ignored.md\` | none |

## 已注册主题

| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |
|---|---|---|---|---|
| Registered | \`#123456\` | articles | \`references/theme-registered.md\` | \`font-weight:600;\` |

## Other table

| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |
|---|---|---|---|---|
| ignored too | black | ignored | \`references/theme-ignored-too.md\` | none |
`;

    expect(parseThemeIndex(index)).toEqual([
      {
        id: "registered",
        name: "Registered",
        primaryColor: "#123456",
        useCases: "articles",
        file: "references/theme-registered.md",
        underlineCss: "font-weight:600;"
      }
    ]);
  });

  it.each([
    {
      name: "a row with fewer than five cells",
      row: "| Theme | #000 | articles | `references/theme-short.md` |",
      message: /five cells/
    },
    {
      name: "an empty component file",
      row: "| Theme | #000 | articles |  | underline |",
      message: /component file/
    },
    {
      name: "an absolute component file",
      row: "| Theme | #000 | articles | `/tmp/theme-absolute.md` | underline |",
      message: /component file/
    },
    {
      name: "a component file outside references",
      row: "| Theme | #000 | articles | `../theme-outside.md` | underline |",
      message: /component file/
    }
  ])("rejects $name", ({ row, message }) => {
    const index = registeredTable(row);

    expect(() => parseThemeIndex(index)).toThrow(message);
  });

  it("rejects duplicate IDs derived from registered component files", () => {
    const index = registeredTable(
      "| One | #000 | articles | `references/theme-same.md` | underline |\n" +
        "| Two | #fff | essays | `references/theme-same.md` | underline |"
    );

    expect(() => parseThemeIndex(index)).toThrow(/Duplicate theme id: same/);
  });
});

describe("BuiltInThemeRepository", () => {
  it("lists and gets themes parsed from registered Skill files", async () => {
    const { vfs } = await loadPinnedSkill();
    const repository = new BuiltInThemeRepository(vfs);

    expect(repository.list()).toHaveLength(6);
    expect(repository.get("graphite-minimal")).toMatchObject({
      name: "石墨极简风",
      file: "references/theme-graphite-minimal.md"
    });
    expect(repository.get("not-registered")).toBeUndefined();
  });

  it("rejects an index whose registered component file is missing", () => {
    const vfs = new SkillVirtualFileSystem(
      new Map([
        ["references/theme-index.md", registeredTable(
          "| Missing | #000 | articles | `references/theme-missing.md` | underline |"
        )]
      ])
    );

    expect(() => new BuiltInThemeRepository(vfs)).toThrow(
      /Theme file is not registered: references\/theme-missing\.md/
    );
  });
});

function registeredTable(rows: string): string {
  return `# Theme index

## 已注册主题

| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |
|---|---|---|---|---|
${rows}
`;
}
