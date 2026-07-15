import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractSafeZip } from "../../src/archive/SafeZipArchive";

const LIMITS = {
  maxArchiveBytes: 128 * 1024,
  maxEntryBytes: 32,
  maxExtractedBytes: 32,
  maxEntries: 4
};

describe("review remediation: actual ZIP resource boundary", () => {
  it("rejects a forged small central size before accepting truncated high-ratio output", () => {
    const payload = strToU8(`VALID${"A".repeat(2 * 1024 * 1024)}`);
    const forged = mutateFirstEntry(zipSync({ "safe.txt": payload }), ({ local, central }) => {
      local.setUint32(local.offset + 22, 5, true);
      central.setUint32(central.offset + 24, 5, true);
    });

    expect(() => extractSafeZip(forged, LIMITS)).toThrow(
      /actual|inflate|length|size|limit/iu
    );
  });

  it("rejects local/central identity disagreement and CRC corruption", () => {
    const identityMismatch = mutateFirstEntry(
      zipSync({ "safe.txt": strToU8("safe") }),
      ({ local, bytes }) => {
        bytes.set(strToU8("evil.txt"), local.offset + 30);
      }
    );
    expect(() => extractSafeZip(identityMismatch, LIMITS)).toThrow(
      /identity|local|name/iu
    );

    const corruptCrc = mutateFirstEntry(
      zipSync({ "safe.txt": strToU8("safe") }),
      ({ local, central }) => {
        local.setUint32(local.offset + 14, 0x12345678, true);
        central.setUint32(central.offset + 16, 0x12345678, true);
      }
    );
    expect(() => extractSafeZip(corruptCrc, LIMITS)).toThrow(/crc/iu);
  });
});

interface OffsetView extends DataView {
  readonly offset: number;
}

function mutateFirstEntry(
  input: Uint8Array,
  mutate: (parts: {
    bytes: Uint8Array;
    local: OffsetView;
    central: OffsetView;
  }) => void
): Uint8Array {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = findSignature(view, 0x04034b50);
  const centralOffset = findSignature(view, 0x02014b50);
  mutate({
    bytes,
    local: offsetView(bytes, localOffset),
    central: offsetView(bytes, centralOffset)
  });
  return bytes;
}

function findSignature(view: DataView, signature: number): number {
  for (let offset = 0; offset <= view.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  throw new Error("ZIP signature not found");
}

function offsetView(bytes: Uint8Array, offset: number): OffsetView {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ) as OffsetView;
  Object.defineProperty(view, "offset", { value: offset });
  return view;
}
