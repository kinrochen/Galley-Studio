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

export interface ActiveSkillPersist {
  (next: SkillPackageSettings): Promise<void>;
  read?: () => Promise<SkillPackageSettings>;
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
    persist: ActiveSkillPersist
  ): Promise<SkillPackageSettings> {
    await this.load(version);
    const next = current.activate(version);
    if (persist.read) {
      const observed = await persist.read();
      if (observed.activeVersion !== current.activeVersion) {
        throw new Error("Active Skill changed before activation could commit.");
      }
    }
    try {
      await persist(next);
    } catch (error) {
      await compensateDurablePointer(persist, current, next);
      throw error;
    }
    if (persist.read) {
      const observed = await persist.read();
      if (observed.activeVersion !== next.activeVersion) {
        await compensateDurablePointer(persist, current, next);
        throw new Error("Active Skill persistence could not be verified.");
      }
    }
    return next;
  }
}

async function compensateDurablePointer(
  persist: ActiveSkillPersist,
  current: SkillPackageSettings,
  observedOrAttempted: SkillPackageSettings
): Promise<void> {
  if (!persist.read) return;
  const observed = await persist.read();
  if (observed.activeVersion === current.activeVersion) return;
  if (observed.activeVersion !== observedOrAttempted.activeVersion) {
    throw new Error("Active Skill rollback refused an unexpected durable version.");
  }
  try {
    await persist(current);
  } catch {
    const afterFailure = await persist.read();
    if (afterFailure.activeVersion !== current.activeVersion) {
      throw new Error("Active Skill durable rollback failed.");
    }
  }
  const restored = await persist.read();
  if (restored.activeVersion !== current.activeVersion) {
    throw new Error("Active Skill durable rollback could not be verified.");
  }
}
