import type { ImportedSkillPackage } from "./SkillArchiveImporter";
import { SkillArchiveImporter } from "./SkillArchiveImporter";
import { SkillPackageSettings } from "./SkillPackageSettings";

export interface AtomicSkillArchiveStore {
  listVersions(): Promise<readonly string[]>;
  read(version: string): Promise<Uint8Array | null>;
  commit(
    version: string,
    archive: Uint8Array
  ): Promise<"committed" | "exists">;
}

export interface ActiveSkillPointerStore {
  read(): Promise<SkillPackageSettings>;
  compareAndSet(
    expected: SkillPackageSettings,
    next: SkillPackageSettings
  ): Promise<"committed" | "collision">;
}

export class ImportedSkillRepository {
  constructor(
    private readonly store: AtomicSkillArchiveStore,
    private readonly importer: SkillArchiveImporter
  ) {}

  async import(archive: Uint8Array): Promise<ImportedSkillPackage> {
    const imported = await this.importer.import(archive);
    const result = await this.store.commit(imported.version, imported.archive);
    if (result === "exists") {
      const existing = await this.load(imported.version);
      if (existing.packageHash !== imported.packageHash) {
        throw new Error("Imported Skill version collision.");
      }
    }
    return imported;
  }

  async list(): Promise<readonly string[]> {
    return Object.freeze([...(await this.store.listVersions())].sort());
  }

  async load(version: string): Promise<ImportedSkillPackage> {
    const archive = await this.store.read(new SkillPackageSettings(version).activeVersion);
    if (!archive) throw new Error(`Imported Skill version not found: ${version}`);
    const imported = await this.importer.import(archive);
    if (imported.version !== version) {
      throw new Error("Stored Skill archive hash does not match its version.");
    }
    return imported;
  }

  async activate(
    version: string,
    current: SkillPackageSettings,
    pointer: ActiveSkillPointerStore
  ): Promise<SkillPackageSettings> {
    await this.load(version);
    const next = current.activate(version);
    const observed = await pointer.read();
    if (observed.activeVersion !== current.activeVersion) {
      throw new Error("Active Skill changed before activation could commit.");
    }
    let result: "committed" | "collision";
    try {
      result = await pointer.compareAndSet(current, next);
    } catch (error) {
      await compensateDurablePointer(pointer, current, next);
      throw error;
    }
    if (result === "collision") {
      throw new Error("Active Skill changed before activation could commit.");
    }
    return next;
  }
}

async function compensateDurablePointer(
  pointer: ActiveSkillPointerStore,
  current: SkillPackageSettings,
  attempted: SkillPackageSettings
): Promise<void> {
  const observed = await pointer.read();
  if (observed.activeVersion === current.activeVersion) return;
  if (observed.activeVersion !== attempted.activeVersion) {
    throw new Error("Active Skill rollback refused an unexpected durable version.");
  }
  let rollback: "committed" | "collision";
  try {
    rollback = await pointer.compareAndSet(attempted, current);
  } catch {
    const afterFailure = await pointer.read();
    if (afterFailure.activeVersion !== current.activeVersion) {
      throw new Error("Active Skill durable rollback failed.");
    }
    return;
  }
  if (rollback === "collision") {
    const collided = await pointer.read();
    if (collided.activeVersion === current.activeVersion) return;
    throw new Error("Active Skill rollback refused an unexpected durable version.");
  }
  const restored = await pointer.read();
  if (restored.activeVersion !== current.activeVersion) {
    throw new Error("Active Skill durable rollback could not be verified.");
  }
}
