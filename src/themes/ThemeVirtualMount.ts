import type { SkillPackage } from "../skill/SkillPackage";
import type { StoredThemeFiles } from "./CustomThemeRepository";

export class ThemeVirtualMount {
  mount(
    base: SkillPackage,
    customThemes: readonly StoredThemeFiles[]
  ): SkillPackage {
    const files = new Map(base.files);
    const enabled = customThemes
      .filter(({ manifest }) => manifest.enabled)
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
    for (const theme of enabled) {
      files.set(
        `references/theme-${theme.manifest.id}.md`,
        theme.componentLibrary
      );
    }
    const index = files.get("references/theme-index.md");
    if (index === undefined) throw new Error("Skill package is missing references/theme-index.md.");
    files.set("references/theme-index.md", mergeIndex(index, enabled));
    return {
      ...base,
      version: enabled.length === 0 ? base.version : `${base.version}+custom`,
      files
    };
  }
}

function mergeIndex(index: string, themes: readonly StoredThemeFiles[]): string {
  if (themes.length === 0) return index;
  const lines = index.split("\n");
  const header = lines.findIndex((line) =>
    /^\|\s*主题\s*\|\s*主色\s*\|\s*适用场景\s*\|\s*组件库文件\s*\|\s*正文下划线 CSS\s*\|\s*$/u.test(line)
  );
  if (header < 0 || !/^\|(?:\s*:?-+:?\s*\|){5}\s*$/u.test(lines[header + 1] ?? "")) {
    throw new Error("Skill theme index table cannot be merged safely.");
  }
  let insertion = header + 2;
  while (insertion < lines.length && /^\|.*\|\s*$/u.test(lines[insertion] ?? "")) {
    insertion += 1;
  }
  const rows = themes.map(({ manifest }) =>
    `| ${cell(manifest.name)} | ${manifest.primaryColor} | ${cell(manifest.useCases)} | references/theme-${manifest.id}.md | ${cell(manifest.underlineCss)} |`
  );
  lines.splice(insertion, 0, ...rows);
  return lines.join("\n");
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}
