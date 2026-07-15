import {
  DEFAULT_SKILL_ZIP_LIMITS,
  extractSafeZip,
  type SafeZipLimits
} from "../archive/SafeZipArchive";
import { ComponentLibraryValidator } from "../theme-lab/ComponentLibraryValidator";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import type { SkillPackage } from "./SkillPackage";
import { SkillVirtualFileSystem } from "./SkillVirtualFileSystem";

const REQUIRED_FILES = [
  "SKILL.md",
  "references/theme-index.md",
  "references/common-components.md"
] as const;

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
    for (const path of REQUIRED_FILES) {
      if (!files.has(path)) throw new Error(`Skill ZIP is missing required file: ${path}`);
    }

    const vfs = new SkillVirtualFileSystem(files);
    let themes: BuiltInThemeRepository;
    try {
      themes = new BuiltInThemeRepository(vfs);
    } catch (error) {
      throw new Error(`Skill theme index is invalid: ${safeMessage(error)}`);
    }
    const validator = new ComponentLibraryValidator();
    for (const theme of themes.list()) {
      const validation = validator.validateSource(vfs.read(theme.file));
      if (!validation.valid) {
        throw new Error(
          `Skill component validation failed for ${theme.id}: ${validation.issues
            .map(({ code }) => code)
            .join(", ")}`
        );
      }
    }

    const copy = new Uint8Array(archive);
    const packageHash = await sha256(copy);
    const version = `import-${packageHash.slice(0, 12)}`;
    return Object.freeze({
      version,
      packageHash,
      archive: copy,
      skillPackage: {
        id: "gzh-design",
        version,
        files
      }
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

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid package";
}
