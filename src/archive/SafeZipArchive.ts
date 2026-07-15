import { Inflate } from "fflate";

import { normalizeSkillPath } from "../skill/SkillVirtualFileSystem";
import { MAX_SKILL_ARCHIVE_BYTES } from "./ArchiveLimits";

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
  maxArchiveBytes: MAX_SKILL_ARCHIVE_BYTES,
  maxEntryBytes: 8 * 1024 * 1024,
  maxExtractedBytes: 25 * 1024 * 1024,
  maxEntries: 512
});

interface CentralEntry {
  readonly path: string;
  readonly rawName: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly dataOffset: number;
  readonly dataEnd: number;
  readonly directory: boolean;
}

interface CentralDirectory {
  readonly entries: readonly CentralEntry[];
  readonly offset: number;
}

const CRC_TABLE = createCrcTable();
const INFLATE_INPUT_CHUNK_BYTES = 256;

/**
 * Extracts a deliberately small ZIP subset without trusting declared output
 * lengths. Every local record is reconciled with its central record before any
 * payload is consumed, and deflate output is counted as it is produced.
 */
export function extractSafeZip(
  input: Uint8Array,
  limits: SafeZipLimits = DEFAULT_SKILL_ZIP_LIMITS
): readonly SafeZipEntry[] {
  validateLimits(limits);
  if (input.byteLength === 0 || input.byteLength > limits.maxArchiveBytes) {
    throw new Error("ZIP archive exceeds the configured archive-size limit.");
  }

  const central = scanCentralDirectory(input, limits);
  validateLocalRecords(input, central);

  const entries: SafeZipEntry[] = [];
  let actualTotal = 0;
  for (const entry of central.entries) {
    if (entry.directory) continue;
    const bytes = inflateEntry(input.subarray(entry.dataOffset, entry.dataEnd), entry, {
      entryRemaining: limits.maxEntryBytes,
      totalRemaining: limits.maxExtractedBytes - actualTotal
    });
    actualTotal += bytes.byteLength;
    entries.push(Object.freeze({ path: entry.path, bytes }));
  }
  return Object.freeze(entries);
}

function scanCentralDirectory(
  bytes: Uint8Array,
  limits: SafeZipLimits
): CentralDirectory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not accepted.");
  }
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
  if (
    centralOffset > eocd ||
    centralSize > eocd - centralOffset ||
    centralOffset + centralSize !== eocd
  ) {
    throw new Error("ZIP central directory is invalid.");
  }

  const entries: CentralEntry[] = [];
  const canonicalPaths = new Set<string>();
  let declaredTotal = 0;
  let offset = centralOffset;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 entries are not accepted for Skill import.");
    }
    if ((flags & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not accepted.");
    if ((flags & 0x8) !== 0) {
      throw new Error("ZIP data-descriptor entries are not accepted.");
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`ZIP compression method ${method} is not accepted.`);
    }
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (nameLength === 0 || end > eocd) {
      throw new Error("ZIP entry name is invalid.");
    }
    const rawName = new Uint8Array(bytes.subarray(offset + 46, offset + 46 + nameLength));
    let decodedName: string;
    try {
      decodedName = decoder.decode(rawName);
    } catch {
      throw new Error("ZIP entry name is not valid UTF-8.");
    }
    if (decodedName.includes("\0")) throw new Error("ZIP entry path contains NUL.");
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error("ZIP symbolic link entries are forbidden.");
    }
    const directory = decodedName.endsWith("/");
    const candidate = directory ? decodedName.slice(0, -1) : decodedName;
    let path: string;
    try {
      path = normalizeSkillPath(candidate);
    } catch {
      throw new Error(`ZIP entry has an invalid path: ${decodedName}`);
    }
    if (path !== candidate || decodedName.includes("\\")) {
      throw new Error(`ZIP entry has a non-canonical path: ${decodedName}`);
    }
    const canonicalPath = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonicalPath)) {
      throw new Error(`ZIP contains a duplicate canonical path: ${path}`);
    }
    canonicalPaths.add(canonicalPath);
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      throw new Error("ZIP directory entries must be empty.");
    }
    if (!directory) {
      if (uncompressedSize > limits.maxEntryBytes) {
        throw new Error("ZIP entry exceeds the configured entry-size limit.");
      }
      declaredTotal += uncompressedSize;
      if (declaredTotal > limits.maxExtractedBytes) {
        throw new Error("ZIP exceeds the configured extracted-size limit.");
      }
    }
    entries.push({
      path,
      rawName,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
      dataOffset: 0,
      dataEnd: 0,
      directory
    });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP central-directory length is inconsistent.");
  }
  return { entries, offset: centralOffset };
}

function validateLocalRecords(bytes: Uint8Array, central: CentralDirectory): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges: { readonly start: number; readonly end: number }[] = [];
  for (const entry of central.entries) {
    const offset = entry.localOffset;
    if (offset + 30 > central.offset || view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error(`ZIP local header is invalid for ${entry.path}.`);
    }
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc32 = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset > central.offset || dataEnd > central.offset || dataEnd < dataOffset) {
      throw new Error(`ZIP local payload range is invalid for ${entry.path}.`);
    }
    const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
    if (
      flags !== entry.flags ||
      method !== entry.method ||
      crc32 !== entry.crc32 ||
      compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize ||
      !equalBytes(localName, entry.rawName)
    ) {
      throw new Error(`ZIP local and central identity disagree for ${entry.path}.`);
    }
    Object.assign(entry, { dataOffset, dataEnd });
    ranges.push({ start: offset, end: dataEnd });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new Error("ZIP local entry ranges overlap.");
    }
  }
}

function inflateEntry(
  compressed: Uint8Array,
  entry: CentralEntry,
  remaining: { readonly entryRemaining: number; readonly totalRemaining: number }
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let actualLength = 0;
  let crc = 0xffffffff;
  let failure: Error | null = null;
  const consume = (chunk: Uint8Array): void => {
    if (failure) throw failure;
    const nextLength = actualLength + chunk.byteLength;
    if (
      nextLength > remaining.entryRemaining ||
      nextLength > remaining.totalRemaining
    ) {
      failure = new Error("ZIP actual inflated output exceeds a configured limit.");
      throw failure;
    }
    actualLength = nextLength;
    crc = updateCrc32(crc, chunk);
    chunks.push(new Uint8Array(chunk));
  };

  try {
    if (entry.method === 0) {
      for (let offset = 0; offset < compressed.byteLength; offset += 64 * 1024) {
        consume(compressed.subarray(offset, Math.min(offset + 64 * 1024, compressed.byteLength)));
        if (failure) throw failure;
      }
    } else {
      const inflater = new Inflate((chunk) => consume(chunk));
      for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_INPUT_CHUNK_BYTES) {
        const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.byteLength);
        inflater.push(compressed.subarray(offset, end), end === compressed.byteLength);
        if (failure) throw failure;
      }
      if (compressed.byteLength === 0) inflater.push(compressed, true);
    }
  } catch (error) {
    if (failure) throw failure;
    throw new Error(
      `ZIP entry could not be safely inflated: ${error instanceof Error ? error.message : "invalid stream"}`
    );
  }

  if (actualLength !== entry.uncompressedSize) {
    throw new Error(`ZIP actual output length disagrees for ${entry.path}.`);
  }
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
    throw new Error(`ZIP CRC validation failed for ${entry.path}.`);
  }
  const output = new Uint8Array(actualLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return value >>> 0;
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
