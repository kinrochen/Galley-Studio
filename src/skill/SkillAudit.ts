export type SkillLoadMode = "tool-calls" | "injected" | "filesystem" | "mixed";

export interface SkillLoadAudit {
  skillId: string;
  skillVersion: string;
  packageHash: string;
  loadMode: SkillLoadMode;
  files: string[];
}
