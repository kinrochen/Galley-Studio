import wechatProfile from "../../assets/profiles/wechat.md?raw";

import type { SkillPackage } from "../skill/SkillPackage";

export function createWechatRepairSkillPackage(
  skillPackage: SkillPackage
): SkillPackage {
  const files = new Map<string, string>();
  for (const path of ["SKILL.md", "references/theme-index.md"] as const) {
    const content = skillPackage.files.get(path);
    if (content === undefined) {
      throw new Error(`Bundled Skill is missing required repair file: ${path}`);
    }
    files.set(path, content);
  }
  files.set("assets/profiles/wechat.md", wechatProfile);
  return { ...skillPackage, files };
}
