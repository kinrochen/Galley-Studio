export interface SkillPackage {
  id: string;
  version: string;
  files: ReadonlyMap<string, string>;
}
