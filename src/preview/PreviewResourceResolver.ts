import { parseHtmlFragment } from "../dom/HtmlFragment";
import { resolveVaultResourcePath } from "../editor/EditorResourceResolver";

export type VaultResourceReader = (
  vaultPath: string
) => Promise<ArrayBuffer | Uint8Array | null>;

export const MAX_PREVIEW_IMAGE_BYTES = 20 * 1024 * 1024;

type PreviewImageMime = "image/png" | "image/jpeg" | "image/webp";

/**
 * Embeds validated vault-local raster images into the in-memory preview copy.
 * The saved authoring HTML keeps its original relative URLs.
 */
export class PreviewResourceResolver {
  constructor(private readonly readResource: VaultResourceReader) {}

  async rewriteForPreview(bodyHtml: string, documentPath = ""): Promise<string> {
    const fragment = parseHtmlFragment(bodyHtml);
    const images = [...fragment.querySelectorAll<HTMLImageElement>("img[src]")];
    await Promise.all(images.map(async (image) => {
      const source = image.getAttribute("src");
      if (source === null) return;
      const vaultPath = resolveVaultResourcePath(source, documentPath);
      if (vaultPath === null) return;

      let loaded: ArrayBuffer | Uint8Array | null;
      try {
        loaded = await this.readResource(vaultPath);
      } catch {
        return;
      }
      if (loaded === null) return;
      const bytes = loaded instanceof Uint8Array
        ? new Uint8Array(loaded)
        : new Uint8Array(loaded);
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > MAX_PREVIEW_IMAGE_BYTES
      ) return;
      const mime = detectImageMime(bytes);
      if (mime === null) return;
      image.setAttribute("src", `data:${mime};base64,${encodeBase64(bytes)}`);
    }));
    return serializeFragment(fragment);
  }
}

function detectImageMime(bytes: Uint8Array): PreviewImageMime | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value
    )
  ) return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    ascii(bytes.subarray(0, 4)) === "RIFF" &&
    ascii(bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function ascii(bytes: Uint8Array): string {
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

function serializeFragment(fragment: DocumentFragment): string {
  const host = document.createElement("div");
  host.append(fragment.cloneNode(true));
  return host.innerHTML;
}
