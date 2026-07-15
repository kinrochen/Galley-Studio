import { ComponentLibraryValidator } from "../theme-lab/ComponentLibraryValidator";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../themes/ThemeIndex";
import type { SkillPackage } from "./SkillPackage";
import { SkillVirtualFileSystem } from "./SkillVirtualFileSystem";

export const REQUIRED_SKILL_PRODUCT_FILES = Object.freeze([
  "SKILL.md",
  "references/theme-index.md",
  "references/theme-generator.md",
  "references/common-components.md"
] as const);

export interface ValidatedSkillPackage {
  readonly skillPackage: SkillPackage;
  readonly vfs: SkillVirtualFileSystem;
  readonly themes: readonly ThemeDefinition[];
  readonly capabilities: {
    readonly generation: true;
    readonly themeLab: true;
    readonly wechatExport: true;
  };
}

export class SkillPackageValidator {
  readonly #componentValidator = new ComponentLibraryValidator();

  validate(skillPackage: SkillPackage): ValidatedSkillPackage {
    const vfs = new SkillVirtualFileSystem(skillPackage.files);
    for (const path of REQUIRED_SKILL_PRODUCT_FILES) {
      if (!vfs.has(path)) {
        throw new Error(`Skill ZIP is missing required Theme Lab file: ${path}`);
      }
      if (!vfs.read(path).trim()) {
        throw new Error(`Skill required file is empty: ${path}`);
      }
    }
    const skillRoot = vfs.read("SKILL.md");
    if (!/(?:^---\s*$[\s\S]*?^---\s*$|^#\s+)/mu.test(skillRoot)) {
      throw new Error("Skill root has no recognizable frontmatter or heading structure.");
    }
    const themeGenerator = vfs.read("references/theme-generator.md");
    if (!/(?:theme|主题)/iu.test(themeGenerator)) {
      throw new Error("Skill theme-generator file has no theme-generation structure.");
    }

    let themes: BuiltInThemeRepository;
    try {
      themes = new BuiltInThemeRepository(vfs);
    } catch (error) {
      throw new Error(`Skill theme index is invalid: ${safeMessage(error)}`);
    }
    for (const theme of themes.list()) {
      const validation = this.#componentValidator.validateSource(vfs.read(theme.file));
      if (!validation.valid) {
        throw new Error(
          `Skill component validation failed for ${theme.id}: ${validation.issues
            .map(({ code }) => code)
            .join(", ")}`
        );
      }
    }
    return Object.freeze({
      skillPackage,
      vfs,
      themes: themes.list(),
      capabilities: Object.freeze({
        generation: true as const,
        themeLab: true as const,
        wechatExport: true as const
      })
    });
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid package";
}
