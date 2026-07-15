import type { GalleySettings } from "../settings/GalleySettings";
import { normalizeSettings } from "../settings/GalleySettings";
import type { ActiveSkillPointerStore } from "./ImportedSkillRepository";
import { SkillPackageSettings } from "./SkillPackageSettings";

export interface ActiveSkillSettingsPersistence {
  load(): Promise<unknown>;
  save(settings: GalleySettings): Promise<void>;
}

const transactionQueues = new WeakMap<object, Promise<void>>();

/**
 * Serializes every participating active-pointer compare-and-set for one plugin
 * instance. The full settings object stays backward compatible; only the
 * activeSkillVersion field is conditionally replaced and then read back.
 */
export class ObsidianActiveSkillPointerStore implements ActiveSkillPointerStore {
  constructor(
    private readonly transactionBoundary: object,
    private readonly persistence: ActiveSkillSettingsPersistence
  ) {}

  async read(): Promise<SkillPackageSettings> {
    return exclusive(this.transactionBoundary, async () =>
      pointerFrom(await this.persistence.load())
    );
  }

  async compareAndSet(
    expected: SkillPackageSettings,
    next: SkillPackageSettings
  ): Promise<"committed" | "collision"> {
    return exclusive(this.transactionBoundary, async () => {
      const durable = normalizeSettings(await this.persistence.load());
      if (durable.activeSkillVersion !== expected.activeVersion) {
        return "collision";
      }
      await this.persistence.save(normalizeSettings({
        ...durable,
        activeSkillVersion: next.activeVersion
      }));
      const verified = pointerFrom(await this.persistence.load());
      if (verified.activeVersion !== next.activeVersion) {
        throw new Error("Active Skill persistence could not be verified.");
      }
      return "committed";
    });
  }
}

function pointerFrom(value: unknown): SkillPackageSettings {
  return new SkillPackageSettings(normalizeSettings(value).activeSkillVersion);
}

async function exclusive<T>(
  boundary: object,
  operation: () => Promise<T>
): Promise<T> {
  const previous = transactionQueues.get(boundary) ?? Promise.resolve();
  let release = (): void => undefined;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.then(() => lock);
  transactionQueues.set(boundary, next);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (transactionQueues.get(boundary) === next) {
      transactionQueues.delete(boundary);
    }
  }
}
