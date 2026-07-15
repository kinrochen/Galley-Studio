import type { App } from "obsidian";
import { unzipSync, zipSync } from "fflate";
import { expect, it, vi } from "vitest";

import {
  importSkillArchive
} from "../../src/platform/DesktopThemeRuntime";
import {
  createDesktopActions,
  type DesktopConsoleHost
} from "../../src/platform/DesktopConsoleRuntime";
import { derivePlatformCapabilities } from "../../src/platform/PlatformCapabilities";
import { LocaleStore } from "../../src/i18n/LocaleStore";
import { importedSkillRepository } from "../../src/platform/ProductionSkillContext";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import type { ActiveSkillPointerStore } from "../../src/skill/ImportedSkillRepository";
import { ObsidianActiveSkillPointerStore } from "../../src/skill/ObsidianActiveSkillPointerStore";
import { SkillPackageSettings } from "../../src/skill/SkillPackageSettings";
import { validSkillArchive } from "../support/phase5Fixtures";
import { MemoryDataAdapter } from "../support/memoryDataAdapter";

it("does not let A compensation overwrite B after B durably activates between A read and rollback write", async () => {
  const memory = new MemoryDataAdapter();
  const app = {
    vault: { adapter: memory.asDataAdapter(), configDir: ".obsidian" }
  } as unknown as App;
  const versionA = await importSkillArchive(app, variantArchive("a"));
  const versionB = await importSkillArchive(app, variantArchive("b"));
  let durable = normalizeSettings({ activeSkillVersion: "bundled" });
  const rollbackWriteEntered = deferred();
  const allowRollbackWrite = deferred();
  let failFirstSave = true;
  const persistence = {
    load: async () => structuredClone(durable),
    save: async (settings: ReturnType<typeof normalizeSettings>) => {
      durable = structuredClone(settings);
      if (failFirstSave) {
        failFirstSave = false;
        throw new Error("A saveData threw after durable write");
      }
    }
  };
  const productionA = new ObsidianActiveSkillPointerStore(app, persistence);
  const productionB = new ObsidianActiveSkillPointerStore(app, persistence);

  const pointerA: ActiveSkillPointerStore = {
    read: () => productionA.read(),
    compareAndSet: async (expected, next) => {
      if (
        expected.activeVersion === versionA &&
        next.activeVersion === "bundled"
      ) {
        rollbackWriteEntered.resolve();
        await allowRollbackWrite.promise;
      }
      return productionA.compareAndSet(expected, next);
    }
  };
  const activationA = importedSkillRepository(app).activate(
    versionA,
    new SkillPackageSettings("bundled"),
    pointerA
  );

  await rollbackWriteEntered.promise;
  expect(durable.activeSkillVersion).toBe(versionA);
  await expect(
    importedSkillRepository(app).activate(
      versionB,
      new SkillPackageSettings(versionA),
      productionB
    )
  ).resolves.toMatchObject({ activeVersion: versionB });
  expect(durable.activeSkillVersion).toBe(versionB);

  allowRollbackWrite.resolve();
  await expect(activationA).rejects.toThrow(/rollback refused|unexpected durable/iu);
  expect(durable.activeSkillVersion).toBe(versionB);
});

it("refreshes host settings from durable data after an activation collision and rethrows the collision", async () => {
  const memory = new MemoryDataAdapter();
  const app = {
    vault: { adapter: memory.asDataAdapter(), configDir: ".obsidian" },
    secretStorage: { getSecret: () => null, listSecrets: () => [], setSecret: () => undefined }
  } as unknown as App;
  const version = await importSkillArchive(app, variantArchive("collision"));
  let current = normalizeSettings({ activeSkillVersion: "bundled" });
  const durable = normalizeSettings({ activeSkillVersion: "externally-activated" });
  const loadData = vi.fn(async () => structuredClone(durable));
  const host: DesktopConsoleHost = {
    app,
    capabilities: derivePlatformCapabilities(false),
    locale: new LocaleStore({ language: "en", obsidianLocale: () => "en" }),
    getSettings: () => current,
    replaceSettings: (settings) => { current = settings; },
    loadData,
    saveData: async () => undefined,
    saveSettings: async () => undefined
  };

  await expect(createDesktopActions(host).activateSkill?.(version)).rejects.toThrow(
    /invalid|unexpected durable|collision/iu
  );

  expect(loadData).toHaveBeenCalledTimes(2);
  expect(current.activeSkillVersion).toBe("externally-activated");
});

it("does not mask the original activation failure when the final durable refresh also fails", async () => {
  const memory = new MemoryDataAdapter();
  const app = {
    vault: { adapter: memory.asDataAdapter(), configDir: ".obsidian" },
    secretStorage: { getSecret: () => null, listSecrets: () => [], setSecret: () => undefined }
  } as unknown as App;
  const version = await importSkillArchive(app, variantArchive("refresh-failure"));
  let current = normalizeSettings({ activeSkillVersion: "bundled" });
  const loadData = vi.fn()
    .mockResolvedValueOnce(normalizeSettings({ activeSkillVersion: "invalid durable value" }))
    .mockRejectedValueOnce(new Error("refresh failed and must not win"));
  const host: DesktopConsoleHost = {
    app,
    capabilities: derivePlatformCapabilities(false),
    locale: new LocaleStore({ language: "en", obsidianLocale: () => "en" }),
    getSettings: () => current,
    replaceSettings: (settings) => { current = settings; },
    loadData,
    saveData: async () => undefined,
    saveSettings: async () => undefined
  };

  await expect(createDesktopActions(host).activateSkill?.(version)).rejects.toThrow(
    "Active Skill version is invalid."
  );
  expect(loadData).toHaveBeenCalledTimes(2);
  expect(current.activeSkillVersion).toBe("bundled");
});

function variantArchive(name: string): Uint8Array {
  return zipSync({
    ...unzipSync(validSkillArchive()),
    [`references/activation-${name}.txt`]: new TextEncoder().encode(name)
  });
}

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
