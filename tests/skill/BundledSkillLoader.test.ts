import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import {
  BundledSkillLoader,
  type EmbeddedSkillPackage,
  PINNED_GZH_DESIGN_VERSION
} from "../../src/skill/BundledSkillLoader";

async function sha256(bytes: Uint8Array): Promise<string> {
  const stableBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stableBytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function replacementDescriptor(
  files: Record<string, Uint8Array>
): Promise<EmbeddedSkillPackage> {
  const archive = zipSync(files, {
    level: 9,
    mtime: new Date(1980, 0, 1, 0, 0, 0)
  });

  return {
    id: BUNDLED_SKILL.id,
    version: BUNDLED_SKILL.version,
    archiveSha256: await sha256(archive),
    files: Object.keys(files).sort(),
    archiveBase64: Buffer.from(archive).toString("base64")
  };
}

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

it("rejects a self-consistent replacement archive under the pinned identity", async () => {
  const replacementFiles = unzipSync(
    Buffer.from(BUNDLED_SKILL.archiveBase64, "base64")
  );
  replacementFiles["SKILL.md"] = strToU8("replacement workflow");
  const replacement = await replacementDescriptor(replacementFiles);

  await expect(new BundledSkillLoader(replacement).load()).rejects.toThrow(
    /trusted archive hash/
  );
});

it("rejects a self-consistent replacement manifest and archive", async () => {
  const replacement = await replacementDescriptor({
    "SKILL.md": strToU8("replacement workflow")
  });

  await expect(new BundledSkillLoader(replacement).load()).rejects.toThrow(
    /trusted manifest digest/
  );
});

it("rejects a manifest that does not register every archive entry", async () => {
  const incompleteManifest = {
    ...BUNDLED_SKILL,
    files: BUNDLED_SKILL.files.slice(1)
  };

  await expect(
    new BundledSkillLoader(incompleteManifest).load()
  ).rejects.toThrow(/trusted manifest digest/);
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
