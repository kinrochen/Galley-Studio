export type SupportedReferenceImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export interface ReferenceImageInput {
  readonly selected: boolean;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface ValidatedReferenceImage {
  readonly name: string;
  readonly mimeType: SupportedReferenceImageMime;
  readonly bytes: Uint8Array;
  readonly dataUrl: string;
}

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateReferenceImage(
  input: ReferenceImageInput
): ValidatedReferenceImage {
  if (!input.selected) {
    throw new Error("A theme reference image must be explicitly selected.");
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("A theme reference image must be non-empty and no larger than 10 MiB.");
  }
  const detected = detectMime(input.bytes);
  if (!detected || detected !== input.mimeType) {
    throw new Error("The reference image MIME type does not match its magic bytes.");
  }
  const bytes = new Uint8Array(input.bytes);
  return {
    name: input.name,
    mimeType: detected,
    bytes,
    dataUrl: `data:${detected};base64,${encodeBase64(bytes)}`
  };
}

function detectMime(bytes: Uint8Array): SupportedReferenceImageMime | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value
    )
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    text(bytes.subarray(0, 4)) === "RIFF" &&
    text(bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function text(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
