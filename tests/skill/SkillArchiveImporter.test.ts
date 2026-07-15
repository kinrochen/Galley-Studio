import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ImportedSkillRepository,
  type AtomicSkillArchiveStore
} from "../../src/skill/ImportedSkillRepository";
import { SkillArchiveImporter } from "../../src/skill/SkillArchiveImporter";
import { SkillPackageSettings } from "../../src/skill/SkillPackageSettings";
import {
  themeIndexMarkdown,
  validComponentLibrary,
  validSkillArchive
} from "../support/phase5Fixtures";

class Store implements AtomicSkillArchiveStore {
  readonly archives = new Map<string, Uint8Array>();
  failCommit = false;
  async listVersions(): Promise<readonly string[]> { return [...this.archives.keys()]; }
  async read(version: string): Promise<Uint8Array | null> {
    const value = this.archives.get(version);
    return value ? new Uint8Array(value) : null;
  }
  async commit(version: string, bytes: Uint8Array): Promise<"committed" | "exists"> {
    if (this.failCommit) throw new Error("atomic failure");
    if (this.archives.has(version)) return "exists";
    this.archives.set(version, new Uint8Array(bytes));
    return "committed";
  }
}

function markFirstEntrySymlink(zip: Uint8Array): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  for (let offset = 0; offset <= copy.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 38, 0xa1ff0000, true);
    return copy;
  }
  throw new Error("central directory not found");
}

describe("safe Skill ZIP import", () => {
  it("imports a valid package as inactive reference text and never executes scripts", async () => {
    const importer = new SkillArchiveImporter();
    const imported = await importer.import(validSkillArchive());

    expect(imported.skillPackage.files.get("scripts/validate.py")).toContain(
      "must never execute"
    );
    expect(imported.version).toMatch(/^import-[a-f0-9]{12}$/u);
    expect(imported.packageHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ["traversal", "../escape", "path"],
    ["absolute", "/etc/passwd", "path"],
    ["drive absolute", "C:/secret", "path"]
  ])("rejects %s entries", async (_label, path, message) => {
    const zip = zipSync({ [path]: strToU8("bad") });
    await expect(new SkillArchiveImporter().import(zip)).rejects.toThrow(message);
  });

  it("rejects symlinks and duplicate canonical paths", async () => {
    await expect(
      new SkillArchiveImporter().import(markFirstEntrySymlink(validSkillArchive()))
    ).rejects.toThrow("symbolic link");
    await expect(new SkillArchiveImporter().import(zipSync({
      "SKILL.md": strToU8("a"),
      "skill.md": strToU8("b")
    }))).rejects.toThrow("duplicate canonical");
  });

  it("enforces archive, entry, and extracted-size limits before or during inflation", async () => {
    const importer = new SkillArchiveImporter({
      maxArchiveBytes: 512,
      maxEntryBytes: 32,
      maxExtractedBytes: 64,
      maxEntries: 4
    });
    await expect(importer.import(validSkillArchive())).rejects.toThrow(/limit|large/iu);
  });

  it("rejects packages missing required files or a valid theme component", async () => {
    const missing = zipSync({ "SKILL.md": strToU8("only") });
    await expect(new SkillArchiveImporter().import(missing)).rejects.toThrow(
      "missing required"
    );

    const invalid = zipSync({
      "SKILL.md": strToU8("skill"),
      "references/theme-index.md": strToU8(themeIndexMarkdown()),
      "references/common-components.md": strToU8("common"),
      "references/theme-ocean-notes.md": strToU8(
        validComponentLibrary().replace("<section style=", "<div style=")
      )
    });
    await expect(new SkillArchiveImporter().import(invalid)).rejects.toThrow(
      "component"
    );
  });
});

describe("imported Skill repository activation", () => {
  it("stores atomically without auto-activation and switches only after explicit validation", async () => {
    const store = new Store();
    const repository = new ImportedSkillRepository(
      store,
      new SkillArchiveImporter()
    );
    const current = new SkillPackageSettings("bundled");
    const imported = await repository.import(validSkillArchive());

    expect(current.activeVersion).toBe("bundled");
    expect(await repository.list()).toEqual([imported.version]);

    let persisted = current;
    const next = await repository.activate(imported.version, current, async (value) => {
      persisted = value;
    });
    expect(next.activeVersion).toBe(imported.version);
    expect(persisted.activeVersion).toBe(imported.version);
  });

  it("preserves the prior active version when validation or persistence fails", async () => {
    const store = new Store();
    const repository = new ImportedSkillRepository(store, new SkillArchiveImporter());
    const imported = await repository.import(validSkillArchive());
    const current = new SkillPackageSettings("bundled");

    await expect(repository.activate(imported.version, current, async () => {
      throw new Error("settings write failed");
    })).rejects.toThrow("settings write failed");
    expect(current.activeVersion).toBe("bundled");
  });
});
