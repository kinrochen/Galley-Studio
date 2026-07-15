import { describe, expect, it } from "vitest";

import { BundledSkillLoader } from "../../src/skill/BundledSkillLoader";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import {
  CustomThemeRepository,
  type AtomicThemeStore,
  type StoredThemeFiles,
  type StoredThemeRecord
} from "../../src/themes/CustomThemeRepository";
import { MergedThemeRepository } from "../../src/themes/MergedThemeRepository";
import { ThemeArchive } from "../../src/themes/ThemeArchive";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import { ComponentLibraryValidator } from "../../src/theme-lab/ComponentLibraryValidator";
import {
  CUSTOM_THEME_ID,
  customThemeManifest,
  validComponentLibrary,
  validThemePreview
} from "../support/phase5Fixtures";

class MemoryAtomicThemeStore implements AtomicThemeStore {
  readonly records = new Map<string, StoredThemeRecord>();
  failNextCommit = false;
  revision = 0;

  async listIds(): Promise<readonly string[]> {
    return [...this.records.keys()].sort();
  }

  async read(id: string): Promise<StoredThemeRecord | null> {
    const value = this.records.get(id);
    return value ? structuredClone(value) : null;
  }

  async commit(
    id: string,
    files: StoredThemeFiles,
    expectedRevision: string | null
  ): Promise<"committed" | "collision"> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("injected atomic commit failure");
    }
    if ((this.records.get(id)?.revision ?? null) !== expectedRevision) return "collision";
    this.revision += 1;
    this.records.set(id, {
      files: structuredClone(files),
      revision: `revision-${this.revision}`
    });
    return "committed";
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}

const files = (): StoredThemeFiles => ({
  manifest: customThemeManifest(),
  componentLibrary: validComponentLibrary(),
  previewHtml: validThemePreview()
});

describe("custom theme persistence and merged Skill mount", () => {
  it("accepts all six pinned built-in component libraries under the TypeScript lint contract", async () => {
    const bundled = await new BundledSkillLoader().load();
    const vfs = new SkillVirtualFileSystem(bundled.files);
    const themes = new BuiltInThemeRepository(vfs);
    const validator = new ComponentLibraryValidator();
    expect(themes.list()).toHaveLength(6);
    for (const theme of themes.list()) {
      const validation = validator.validateSource(vfs.read(theme.file));
      expect(validation.valid, theme.id).toBe(true);
      expect(
        validation.issues.filter(({ severity }) => severity === "error"),
        theme.id
      ).toEqual([]);
    }
  });

  it("commits all theme files atomically and preserves absence on failure", async () => {
    const store = new MemoryAtomicThemeStore();
    const repository = new CustomThemeRepository(store, []);
    store.failNextCommit = true;

    await expect(repository.save(files())).rejects.toThrow("atomic commit");
    await expect(repository.list()).resolves.toEqual([]);

    await repository.save(files());
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.toEqual(files());
  });

  it("rejects built-in/custom collisions and supports enable, disable, and delete", async () => {
    const store = new MemoryAtomicThemeStore();
    const repository = new CustomThemeRepository(store, ["moyu-green"]);

    await expect(
      repository.save({
        ...files(),
        manifest: customThemeManifest({ id: "moyu-green" })
      })
    ).rejects.toMatchObject({ code: "theme_id_collision" });

    await repository.save(files());
    await repository.setEnabled(CUSTOM_THEME_ID, false);
    expect((await repository.get(CUSTOM_THEME_ID))?.manifest.enabled).toBe(false);
    await repository.setEnabled(CUSTOM_THEME_ID, true);
    expect((await repository.get(CUSTOM_THEME_ID))?.manifest.enabled).toBe(true);
    await expect(repository.delete(CUSTOM_THEME_ID)).resolves.toBe(true);
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.toBeNull();
  });

  it("round-trips a theme ZIP and fails closed on an id collision", async () => {
    const store = new MemoryAtomicThemeStore();
    const repository = new CustomThemeRepository(store, []);
    const archive = new ThemeArchive();
    const zip = archive.export(files());

    await repository.import(zip, archive);
    await expect(repository.export(CUSTOM_THEME_ID, archive)).resolves.toEqual(zip);
    await expect(repository.import(zip, archive)).rejects.toMatchObject({
      code: "theme_id_collision"
    });
  });

  it("mounts only enabled custom themes into a new Skill session VFS", async () => {
    const bundled = await new BundledSkillLoader().load();
    const builtIns = new BuiltInThemeRepository(
      new SkillVirtualFileSystem(bundled.files)
    );
    const repository = new CustomThemeRepository(
      new MemoryAtomicThemeStore(),
      builtIns.list().map(({ id }) => id)
    );
    await repository.save(files());

    const merged = await new MergedThemeRepository(
      bundled,
      builtIns,
      repository
    ).mount();
    const vfs = new SkillVirtualFileSystem(merged.files);

    expect(vfs.read(`references/theme-${CUSTOM_THEME_ID}.md`)).toBe(
      files().componentLibrary
    );
    expect(vfs.read("references/theme-index.md")).toContain(
      `references/theme-${CUSTOM_THEME_ID}.md`
    );

    await repository.setEnabled(CUSTOM_THEME_ID, false);
    const next = await new MergedThemeRepository(
      bundled,
      builtIns,
      repository
    ).mount();
    const nextVfs = new SkillVirtualFileSystem(next.files);
    expect(nextVfs.has(`references/theme-${CUSTOM_THEME_ID}.md`)).toBe(false);
  });

  it.each(["index", "generator"])(
    "never lets a custom %s id overwrite a base Skill path",
    async (id) => {
      const bundled = await new BundledSkillLoader().load();
      const builtIns = new BuiltInThemeRepository(
        new SkillVirtualFileSystem(bundled.files)
      );
      const store = new MemoryAtomicThemeStore();
      store.records.set(id, {
        revision: `reserved-${id}`,
        files: {
          ...files(),
          manifest: customThemeManifest({ id, name: `Reserved ${id}` })
        }
      });
      const repository = new CustomThemeRepository(store, []);
      const path = `references/theme-${id}.md`;
      const original = bundled.files.get(path);

      const mounted = await new MergedThemeRepository(
        bundled,
        builtIns,
        repository
      ).mount();

      expect(mounted.files.get(path)).toBe(original);
      expect(mounted.files.get(path)).not.toBe(files().componentLibrary);
    }
  );

  it("keeps production mount usable when a newly active Skill conflicts with stored custom themes", async () => {
    const bundled = await new BundledSkillLoader().load();
    const baseVfs = new SkillVirtualFileSystem(bundled.files);
    const builtIns = new BuiltInThemeRepository(baseVfs);
    const activeTheme = builtIns.list()[0]!;
    const store = new MemoryAtomicThemeStore();
    store.records.set(activeTheme.id, {
      revision: "conflict",
      files: {
        ...files(),
        manifest: customThemeManifest({
          id: activeTheme.id,
          name: `Conflicting ${activeTheme.id}`
        })
      }
    });
    const repository = new CustomThemeRepository(store, []);

    const mounted = await new MergedThemeRepository(
      bundled,
      builtIns,
      repository
    ).mount();

    expect(mounted.files.get(activeTheme.file)).toBe(
      bundled.files.get(activeTheme.file)
    );
  });
});
