import type { SkillPackage } from "../skill/SkillPackage";
import type { BuiltInThemeRepository } from "./BuiltInThemeRepository";
import type { CustomThemeRepository } from "./CustomThemeRepository";
import { ThemeVirtualMount } from "./ThemeVirtualMount";

export class MergedThemeRepository {
  constructor(
    private readonly base: SkillPackage,
    private readonly builtIns: BuiltInThemeRepository,
    private readonly custom: CustomThemeRepository,
    private readonly virtualMount = new ThemeVirtualMount()
  ) {}

  async mount(): Promise<SkillPackage> {
    const custom = await this.custom.list();
    const builtInIds = new Set(this.builtIns.list().map(({ id }) => id));
    const compatible = custom.filter(({ manifest }) => {
      const path = `references/theme-${manifest.id}.md`;
      return !builtInIds.has(manifest.id) && !this.base.files.has(path);
    });
    return this.virtualMount.mount(this.base, compatible);
  }
}
