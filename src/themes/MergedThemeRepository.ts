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
    for (const theme of custom) {
      if (builtInIds.has(theme.manifest.id)) {
        throw new Error(`Custom theme collides with a built-in theme: ${theme.manifest.id}`);
      }
    }
    return this.virtualMount.mount(this.base, custom);
  }
}
