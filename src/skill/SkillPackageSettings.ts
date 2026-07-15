export class SkillPackageSettings {
  readonly activeVersion: string;

  constructor(activeVersion: string) {
    const value = activeVersion.trim();
    if (value !== "bundled" && !/^import-[a-f0-9]{12}$/u.test(value)) {
      throw new Error("Active Skill version is invalid.");
    }
    this.activeVersion = value;
    Object.freeze(this);
  }

  activate(version: string): SkillPackageSettings {
    return new SkillPackageSettings(version);
  }
}
