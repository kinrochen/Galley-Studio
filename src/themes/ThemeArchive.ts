import { strToU8, zipSync } from "fflate";

import { MAX_THEME_ARCHIVE_BYTES } from "../archive/ArchiveLimits";
import { extractSafeZip, type SafeZipLimits } from "../archive/SafeZipArchive";
import { parseThemeManifest } from "./ThemeManifest";
import type { StoredThemeFiles } from "./CustomThemeRepository";

const THEME_ARCHIVE_FILES = [
  "theme.json",
  "component-library.md",
  "preview.html"
] as const;
const STABLE_MTIME = new Date("1980-01-01T00:00:00.000Z");
const THEME_LIMITS: SafeZipLimits = {
  maxArchiveBytes: MAX_THEME_ARCHIVE_BYTES,
  maxEntryBytes: 10 * 1024 * 1024,
  maxExtractedBytes: 12 * 1024 * 1024,
  maxEntries: 3
};

export class ThemeArchive {
  export(files: StoredThemeFiles): Uint8Array {
    const options = { level: 9 as const, mtime: STABLE_MTIME };
    return zipSync({
      "theme.json": [strToU8(stableManifest(files)), options],
      "component-library.md": [strToU8(files.componentLibrary), options],
      "preview.html": [strToU8(files.previewHtml), options]
    });
  }

  import(bytes: Uint8Array): StoredThemeFiles {
    const entries = extractSafeZip(bytes, THEME_LIMITS);
    if (
      entries.length !== THEME_ARCHIVE_FILES.length ||
      entries.some(({ path }, index) => path !== [...THEME_ARCHIVE_FILES].sort()[index])
    ) {
      const actual = entries.map(({ path }) => path).sort();
      if (actual.join("\n") !== [...THEME_ARCHIVE_FILES].sort().join("\n")) {
        throw new Error("Theme ZIP must contain exactly the three theme files.");
      }
    }
    const files = new Map(entries.map(({ path, bytes: value }) => [path, decode(value)]));
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(required(files, "theme.json")) as unknown;
    } catch {
      throw new Error("Theme ZIP manifest is not valid JSON.");
    }
    return {
      manifest: parseThemeManifest(manifestValue),
      componentLibrary: required(files, "component-library.md"),
      previewHtml: required(files, "preview.html")
    };
  }
}

function stableManifest(files: StoredThemeFiles): string {
  return `${JSON.stringify(parseThemeManifest(files.manifest), null, 2)}\n`;
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Theme ZIP files must be valid UTF-8 text.");
  }
}

function required(files: ReadonlyMap<string, string>, path: string): string {
  const value = files.get(path);
  if (value === undefined) throw new Error(`Theme ZIP is missing ${path}.`);
  return value;
}
