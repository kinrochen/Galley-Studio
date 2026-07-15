import {
  DEFAULT_SKILL_ZIP_LIMITS,
  extractSafeZip,
  type SafeZipLimits
} from "../archive/SafeZipArchive";
import type { SkillPackage } from "./SkillPackage";
import { SkillPackageValidator } from "./SkillPackageValidator";

export interface ImportedSkillPackage {
  readonly version: string;
  readonly packageHash: string;
  readonly archive: Uint8Array;
  readonly skillPackage: SkillPackage;
}

export class SkillArchiveImporter {
  readonly #limits: SafeZipLimits;

  constructor(limits: Partial<SafeZipLimits> = {}) {
    this.#limits = { ...DEFAULT_SKILL_ZIP_LIMITS, ...limits };
  }

  async import(archive: Uint8Array): Promise<ImportedSkillPackage> {
    const entries = extractSafeZip(archive, this.#limits);
    const files = new Map<string, string>();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (const entry of entries) files.set(entry.path, decoder.decode(entry.bytes));
    } catch {
      throw new Error("Skill ZIP entries must be valid UTF-8 reference text.");
    }
    const skillPackage: SkillPackage = {
      id: "gzh-design",
      version: "pending-import-validation",
      files
    };
    new SkillPackageValidator().validate(skillPackage);

    const copy = new Uint8Array(archive);
    const packageHash = await sha256(copy);
    const version = `import-${packageHash.slice(0, 12)}`;
    return Object.freeze({
      version,
      packageHash,
      archive: copy,
      skillPackage: { ...skillPackage, version }
    });
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
