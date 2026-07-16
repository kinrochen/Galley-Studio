import { unzipSync } from "fflate";

import { BUNDLED_SKILL } from "../generated/bundledSkill";
import type { SkillPackage } from "./SkillPackage";
import { normalizeSkillPath } from "./SkillVirtualFileSystem";

export const PINNED_GZH_DESIGN_VERSION =
  "ba1f4175519b481cb3566616c9e5178705067904";
const TRUSTED_ARCHIVE_SHA256 =
  "8b8b521997cf4e7c3073a390c1fe0a4af19580835edfb4e024670457e46fdc00";
const TRUSTED_MANIFEST_SHA256 =
  "bd1395a87faabebada1681560aaa1ac6fd47d7b3d4c3acbbd91bde88b391824f";

export interface EmbeddedSkillPackage {
  readonly id: string;
  readonly version: string;
  readonly archiveSha256: string;
  readonly files: readonly string[];
  readonly archiveBase64: string;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function validateManifest(data: EmbeddedSkillPackage): readonly string[] {
  if (data.id !== "gzh-design") {
    throw new Error(`Unexpected bundled Skill id: ${data.id}`);
  }
  if (data.version !== PINNED_GZH_DESIGN_VERSION) {
    throw new Error(`Unexpected bundled Skill version: ${data.version}`);
  }
  if (!/^[a-f0-9]{64}$/.test(data.archiveSha256)) {
    throw new Error("Invalid bundled Skill package hash");
  }

  let previousPath: string | undefined;
  for (const path of data.files) {
    const normalizedPath = normalizeSkillPath(path);
    if (normalizedPath !== path) {
      throw new Error(`Skill manifest path must be normalized: ${path}`);
    }
    if (previousPath !== undefined && previousPath >= path) {
      throw new Error("Bundled Skill manifest paths must be unique and sorted");
    }
    previousPath = path;
  }

  return data.files;
}

export class BundledSkillLoader {
  readonly #data: EmbeddedSkillPackage;

  constructor(data: EmbeddedSkillPackage = BUNDLED_SKILL) {
    this.#data = {
      id: data.id,
      version: data.version,
      archiveSha256: data.archiveSha256,
      files: [...data.files],
      archiveBase64: data.archiveBase64
    };
  }

  async load(): Promise<SkillPackage> {
    const manifest = validateManifest(this.#data);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    if ((await sha256(manifestBytes)) !== TRUSTED_MANIFEST_SHA256) {
      throw new Error("Bundled Skill does not match trusted manifest digest");
    }
    if (this.#data.archiveSha256 !== TRUSTED_ARCHIVE_SHA256) {
      throw new Error("Bundled Skill does not match trusted archive hash");
    }

    let archive: Uint8Array<ArrayBuffer>;
    try {
      archive = decodeBase64(this.#data.archiveBase64);
    } catch {
      throw new Error("Bundled Skill integrity check failed");
    }

    if ((await sha256(archive)) !== TRUSTED_ARCHIVE_SHA256) {
      throw new Error("Bundled Skill integrity check failed");
    }

    const archiveFiles = unzipSync(archive);
    const archivePaths = Object.keys(archiveFiles).sort();
    for (const path of archivePaths) {
      if (normalizeSkillPath(path) !== path) {
        throw new Error(`Skill archive path must be normalized: ${path}`);
      }
    }
    if (
      archivePaths.length !== manifest.length ||
      archivePaths.some((path, index) => path !== manifest[index])
    ) {
      throw new Error("Bundled Skill manifest does not match archive");
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const files = new Map<string, string>();
    for (const path of manifest) {
      const bytes = archiveFiles[path];
      if (bytes === undefined) {
        throw new Error("Bundled Skill manifest does not match archive");
      }
      files.set(path, decoder.decode(bytes));
    }

    return {
      id: this.#data.id,
      version: this.#data.version,
      files
    };
  }
}
