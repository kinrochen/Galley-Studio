import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ImportedSkillRepository,
  type ActiveSkillPointerStore,
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
      "SKILL.md": strToU8("---\nname: gzh-design\n---\nWorkflow."),
      "references/theme-index.md": strToU8(themeIndexMarkdown()),
      "references/theme-generator.md": strToU8("# Theme generator"),
      "references/common-components.md": strToU8("common"),
      "references/theme-ocean-notes.md": strToU8(
        validComponentLibrary().replace("<section style=", "<div style=")
      )
    });
    await expect(new SkillArchiveImporter().import(invalid)).rejects.toThrow(
      "component"
    );
  });

  it("requires the complete non-empty Theme Lab Skill contract at import time", async () => {
    const missing = { ...unzipSync(validSkillArchive()) };
    delete missing["references/theme-generator.md"];
    await expect(
      new SkillArchiveImporter().import(zipSync(missing))
    ).rejects.toThrow(/theme-generator|Theme Lab|missing required/iu);

    const empty = {
      ...unzipSync(validSkillArchive()),
      "references/theme-generator.md": new Uint8Array()
    };
    await expect(
      new SkillArchiveImporter().import(zipSync(empty))
    ).rejects.toThrow(/theme-generator|empty|structure/iu);
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

    const pointer = new MemoryActivePointer(current);
    const next = await repository.activate(imported.version, current, pointer);
    expect(next.activeVersion).toBe(imported.version);
    expect(pointer.durable.activeVersion).toBe(imported.version);
  });

  it("preserves the prior active version when validation or persistence fails", async () => {
    const store = new Store();
    const repository = new ImportedSkillRepository(store, new SkillArchiveImporter());
    const imported = await repository.import(validSkillArchive());
    const current = new SkillPackageSettings("bundled");

    const pointer = new MemoryActivePointer(current);
    pointer.beforeCommit = () => { throw new Error("settings write failed"); };
    await expect(
      repository.activate(imported.version, current, pointer)
    ).rejects.toThrow("settings write failed");
    expect(current.activeVersion).toBe("bundled");
    expect(pointer.durable.activeVersion).toBe("bundled");
  });

  it("compensates when the durable active pointer is written before persistence throws", async () => {
    const store = new Store();
    const repository = new ImportedSkillRepository(store, new SkillArchiveImporter());
    const imported = await repository.import(validSkillArchive());
    const current = new SkillPackageSettings("bundled");
    const pointer = new MemoryActivePointer(current);
    pointer.afterCommit = () => {
      if (pointer.writes === 1) {
        throw new Error("saveData threw after durable write");
      }
    };

    await expect(
      repository.activate(imported.version, current, pointer)
    ).rejects.toThrow("saveData threw after durable write");
    expect(pointer.durable.activeVersion).toBe("bundled");
    expect(pointer.writes).toBe(2);
  });

  it("never rolls back an unexpected concurrently changed durable pointer", async () => {
    const store = new Store();
    const repository = new ImportedSkillRepository(store, new SkillArchiveImporter());
    const imported = await repository.import(validSkillArchive());
    const current = new SkillPackageSettings("bundled");
    const pointer = new MemoryActivePointer(current);
    const concurrent = new SkillPackageSettings("import-abcdef123456");
    pointer.afterCommit = () => {
      pointer.durable = concurrent;
      throw new Error("concurrent durable update");
    };

    await expect(
      repository.activate(imported.version, current, pointer)
    ).rejects.toThrow(/unexpected durable version|changed/iu);
    expect(pointer.durable.activeVersion).toBe("import-abcdef123456");
    expect(pointer.writes).toBe(1);
  });
});

class MemoryActivePointer implements ActiveSkillPointerStore {
  writes = 0;
  beforeCommit: (() => void) | null = null;
  afterCommit: (() => void) | null = null;

  constructor(public durable: SkillPackageSettings) {}

  async read(): Promise<SkillPackageSettings> {
    return this.durable;
  }

  async compareAndSet(
    expected: SkillPackageSettings,
    next: SkillPackageSettings
  ): Promise<"committed" | "collision"> {
    if (this.durable.activeVersion !== expected.activeVersion) return "collision";
    this.beforeCommit?.();
    this.durable = next;
    this.writes += 1;
    this.afterCommit?.();
    return "committed";
  }
}
