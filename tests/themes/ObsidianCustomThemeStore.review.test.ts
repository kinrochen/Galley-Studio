import { describe, expect, it } from "vitest";

import type { StoredThemeFiles } from "../../src/themes/CustomThemeRepository";
import { ObsidianCustomThemeStore } from "../../src/themes/ObsidianCustomThemeStore";
import {
  customThemeManifest,
  validComponentLibrary,
  validThemePreview
} from "../support/phase5Fixtures";
import { MemoryDataAdapter } from "../support/memoryDataAdapter";

const ID = "crash-safe-theme";
const oldFiles = (): StoredThemeFiles => ({
  manifest: customThemeManifest({ id: ID, name: "Old" }),
  componentLibrary: validComponentLibrary("Old"),
  previewHtml: validThemePreview("Old")
});
const newFiles = (): StoredThemeFiles => ({
  manifest: customThemeManifest({
    id: ID,
    name: "New",
    updatedAt: "2026-07-15T00:00:01.000Z"
  }),
  componentLibrary: validComponentLibrary("New"),
  previewHtml: validThemePreview("New")
});

describe("review remediation: durable theme transactions", () => {
  it.each([
    [1, "before"],
    [1, "after"],
    [2, "before"],
    [2, "after"]
  ] as const)(
    "recovers a complete old or new record after rename %i %s fault",
    async (call, when) => {
      const memory = new MemoryDataAdapter();
      const seed = new ObsidianCustomThemeStore(memory.asDataAdapter(), () => "seed");
      await seed.commit(ID, oldFiles(), null);
      const seeded = await seed.read(ID);
      if (!seeded) throw new Error("Seed record missing");
      memory.renameCalls = 0;
      memory.renameFault = { call, when };
      const writer = new ObsidianCustomThemeStore(memory.asDataAdapter(), () => "update");
      await expect(writer.commit(ID, newFiles(), seeded.revision)).rejects.toThrow(
        "Injected rename fault"
      );

      memory.renameFault = null;
      const recovered = await new ObsidianCustomThemeStore(
        memory.asDataAdapter(),
        () => "recover"
      ).read(ID);
      const files = unwrap(recovered);
      expect(["Old", "New"]).toContain(files?.manifest.name);
      expect(files?.componentLibrary).toContain(files?.manifest.name ?? "missing");
      expect(
        memory.allPaths().filter((path) => /\.staging-|\.backup-|\.journal-/u.test(path))
      ).toEqual([]);
    }
  );

  it("returns a content revision and rejects a stale compare-and-swap update", async () => {
    const memory = new MemoryDataAdapter();
    const store = new ObsidianCustomThemeStore(memory.asDataAdapter(), () => "cas");
    await store.commit(ID, oldFiles(), null);
    const observed = await store.read(ID);
    if (!observed) throw new Error("Observed record missing");
    expect(observed.revision).toMatch(/^[a-f0-9]{64}$/u);

    await expect(
      store.commit(ID, newFiles(), observed.revision)
    ).resolves.toBe("committed");
    await expect(
      store.commit(ID, oldFiles(), observed.revision)
    ).resolves.toBe("collision");
  });

  it("removes an orphan staging directory left by an interrupted pre-pointer write", async () => {
    const memory = new MemoryDataAdapter();
    const store = new ObsidianCustomThemeStore(memory.asDataAdapter(), () => "orphan");
    await store.commit(ID, oldFiles(), null);
    await memory.mkdir(`.galley/themes/${ID}/.staging-interrupted`);
    await memory.write(
      `.galley/themes/${ID}/.staging-interrupted/theme.json`,
      "partial"
    );

    await expect(store.read(ID)).resolves.not.toBeNull();
    expect(
      memory.allPaths().filter((path) => path.includes(".staging-interrupted"))
    ).toEqual([]);
  });
});

function unwrap(
  value: { readonly files: StoredThemeFiles } | null
): StoredThemeFiles | null {
  return value?.files ?? null;
}
