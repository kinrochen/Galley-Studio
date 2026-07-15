import { unzipSync } from "fflate";

import { normalizeSkillPath } from "../skill/SkillVirtualFileSystem";

export interface SafeZipLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntryBytes: number;
  readonly maxExtractedBytes: number;
  readonly maxEntries: number;
}

export interface SafeZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export const DEFAULT_SKILL_ZIP_LIMITS: SafeZipLimits = Object.freeze({
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
  maxExtractedBytes: 25 * 1024 * 1024,
  maxEntries: 512
});

interface CentralEntry {
  readonly path: string;
  readonly canonicalPath: string;
  readonly uncompressedSize: number;
  readonly directory: boolean;
}

export function extractSafeZip(
  input: Uint8Array,
  limits: SafeZipLimits = DEFAULT_SKILL_ZIP_LIMITS
): readonly SafeZipEntry[] {
  validateLimits(limits);
  if (input.byteLength === 0 || input.byteLength > limits.maxArchiveBytes) {
    throw new Error("ZIP archive exceeds the configured archive-size limit.");
  }
  const central = scanCentralDirectory(input, limits);
  const allowed = new Set(
    central.filter(({ directory }) => !directory).map(({ path }) => path)
  );
  let observedInflatedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input, {
      filter(file) {
        if (!allowed.has(file.name)) return false;
        if (file.originalSize > limits.maxEntryBytes) {
          throw new Error("ZIP entry exceeds the configured entry-size limit.");
        }
        observedInflatedBytes += file.originalSize;
        if (observedInflatedBytes > limits.maxExtractedBytes) {
          throw new Error("ZIP exceeds the configured extracted-size limit.");
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof Error && /limit/iu.test(error.message)) throw error;
    throw new Error("ZIP archive could not be safely inflated.");
  }

  const entries: SafeZipEntry[] = [];
  let actualTotal = 0;
  for (const entry of central) {
    if (entry.directory) continue;
    const bytes = files[entry.path];
    if (!bytes || bytes.byteLength !== entry.uncompressedSize) {
      throw new Error("ZIP entry size or central-directory identity is inconsistent.");
    }
    actualTotal += bytes.byteLength;
    if (
      bytes.byteLength > limits.maxEntryBytes ||
      actualTotal > limits.maxExtractedBytes
    ) {
      throw new Error("ZIP exceeds an inflation limit.");
    }
    entries.push({ path: entry.path, bytes: new Uint8Array(bytes) });
  }
  return Object.freeze(entries);
}

function scanCentralDirectory(
  bytes: Uint8Array,
  limits: SafeZipLimits
): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 archives are not accepted for Skill import.");
  }
  if (entryCount === 0 || entryCount > limits.maxEntries) {
    throw new Error("ZIP entry-count limit exceeded.");
  }
  if (centralOffset + centralSize > eocd || centralOffset > bytes.byteLength) {
    throw new Error("ZIP central directory is invalid.");
  }

  const entries: CentralEntry[] = [];
  const canonicalPaths = new Set<string>();
  let total = 0;
  let offset = centralOffset;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = view.getUint16(offset + 8, true);
    if ((flags & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not accepted.");
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (nameLength === 0 || end > bytes.byteLength) {
      throw new Error("ZIP entry name is invalid.");
    }
    const rawName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (rawName.includes("\0")) throw new Error("ZIP entry path contains NUL.");
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error("ZIP symbolic link entries are forbidden.");
    }
    const directory = rawName.endsWith("/");
    const candidate = directory ? rawName.slice(0, -1) : rawName;
    let path: string;
    try {
      path = normalizeSkillPath(candidate);
    } catch {
      throw new Error(`ZIP entry has an invalid path: ${rawName}`);
    }
    if (path !== candidate || rawName.includes("\\")) {
      throw new Error(`ZIP entry has a non-canonical path: ${rawName}`);
    }
    const canonicalPath = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonicalPath)) {
      throw new Error(`ZIP contains a duplicate canonical path: ${path}`);
    }
    canonicalPaths.add(canonicalPath);
    if (!directory) {
      if (uncompressedSize > limits.maxEntryBytes) {
        throw new Error("ZIP entry exceeds the configured entry-size limit.");
      }
      total += uncompressedSize;
      if (total > limits.maxExtractedBytes) {
        throw new Error("ZIP exceeds the configured extracted-size limit.");
      }
    }
    entries.push({ path, canonicalPath, uncompressedSize, directory });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP central-directory length is inconsistent.");
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === view.byteLength) return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record is missing.");
}

function validateLimits(limits: SafeZipLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("ZIP safety limits must be positive safe integers.");
    }
  }
  if (limits.maxEntryBytes > limits.maxExtractedBytes) {
    throw new Error("ZIP entry limit cannot exceed the extracted-size limit.");
  }
}
