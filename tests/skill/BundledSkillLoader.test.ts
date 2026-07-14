import { expect, it } from "vitest";
import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import {
  BundledSkillLoader,
  PINNED_GZH_DESIGN_VERSION
} from "../../src/skill/BundledSkillLoader";

it("loads the complete pinned gzh-design package as text", async () => {
  const skill = await new BundledSkillLoader().load();

  expect(skill.id).toBe("gzh-design");
  expect(skill.version).toBe(PINNED_GZH_DESIGN_VERSION);
  expect([...skill.files.keys()]).toEqual([...BUNDLED_SKILL.files]);
  expect(skill.files.get("SKILL.md")).toContain("gzh-design");
  expect(skill.files.get("references/theme-index.md")).toContain(
    "theme-graphite-minimal.md"
  );
  expect(skill.files.get("scripts/component_lint.py")).toContain("def ");
});

it("rejects archive bytes that do not match the package hash", async () => {
  const replacement = BUNDLED_SKILL.archiveBase64.endsWith("A") ? "B" : "A";
  const tampered = {
    ...BUNDLED_SKILL,
    archiveBase64: `${BUNDLED_SKILL.archiveBase64.slice(0, -1)}${replacement}`
  };

  await expect(new BundledSkillLoader(tampered).load()).rejects.toThrow(
    /integrity check failed/
  );
});

it("rejects a manifest that does not register every archive entry", async () => {
  const incompleteManifest = {
    ...BUNDLED_SKILL,
    files: BUNDLED_SKILL.files.slice(1)
  };

  await expect(
    new BundledSkillLoader(incompleteManifest).load()
  ).rejects.toThrow(/manifest does not match archive/);
});

it("rejects a package with a different version", async () => {
  const wrongVersion = {
    ...BUNDLED_SKILL,
    version: "0000000000000000000000000000000000000000"
  };

  await expect(new BundledSkillLoader(wrongVersion).load()).rejects.toThrow(
    /Unexpected bundled Skill version/
  );
});

it("rejects non-normalized manifest paths before exposing files", async () => {
  const unsafeManifest = {
    ...BUNDLED_SKILL,
    files: ["../SKILL.md", ...BUNDLED_SKILL.files.slice(1)]
  };

  await expect(new BundledSkillLoader(unsafeManifest).load()).rejects.toThrow(
    /Invalid skill path/
  );
});
