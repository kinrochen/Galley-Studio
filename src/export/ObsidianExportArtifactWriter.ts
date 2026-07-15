import type { TFile, Vault } from "obsidian";

import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { normalizeExportConfiguration } from "./ExportConfiguration";
import type {
  ExportArtifactWriteInput,
  ExportArtifactWriter
} from "./ExportService";

export class ExportArtifactWriteAmbiguousError extends Error {
  readonly code = "export_artifact_write_ambiguous" as const;

  constructor(readonly path: string, readonly cause: unknown) {
    super(`Galley could not prove the exclusive export write at ${path}.`);
    this.name = "ExportArtifactWriteAmbiguousError";
  }
}

export class ObsidianExportArtifactWriter implements ExportArtifactWriter {
  constructor(private readonly vault: Vault) {}

  async writeNew(
    input: ExportArtifactWriteInput,
    signal?: AbortSignal
  ): Promise<{ readonly path: string }> {
    const configuration = normalizeExportConfiguration(input.configuration);
    if (!isNormalizedVaultRelativePath(input.sourcePath)) {
      throw new Error("Export source path must be vault-relative.");
    }
    const sourceName = input.sourcePath.slice(input.sourcePath.lastIndexOf("/") + 1);
    if (!sourceName.endsWith(".galley.html")) {
      throw new Error("Export source must be a Galley HTML document.");
    }
    const stem = sourceName.slice(0, -".galley.html".length);
    const baseName = configuration.fileNameTemplate
      .replaceAll("{stem}", stem)
      .replaceAll("{profile}", input.profileId);
    if (!safeBasename(baseName)) {
      throw new Error("Export filename configuration is unsafe.");
    }
    const sourceFolder = input.sourcePath.includes("/")
      ? input.sourcePath.slice(0, input.sourcePath.lastIndexOf("/"))
      : "";
    const folder = configuration.outputFolder || sourceFolder;
    if (folder) await ensureFolders(this.vault, folder);
    const reservedPaths = normalizeReservedPaths(input.reservedPaths ?? []);

    for (let number = 1; number < 10_000; number += 1) {
      throwIfAborted(signal);
      const name = number === 1
        ? baseName
        : `${baseName.slice(0, -5)}-${number}.html`;
      const path = folder ? `${folder}/${name}` : name;
      if (!isNormalizedVaultRelativePath(path)) {
        throw new Error("Export path is unsafe.");
      }
      if (reservedPaths.has(path) || this.vault.getAbstractFileByPath(path)) {
        continue;
      }
      let file: TFile;
      try {
        file = await this.vault.create(path, input.html);
      } catch (error) {
        if (this.vault.getAbstractFileByPath(path)) {
          throw new ExportArtifactWriteAmbiguousError(path, error);
        }
        throw error;
      }
      await verifyCreatedArtifact(this.vault, file, path, input.html);
      return Object.freeze({ path });
    }
    throw new Error("Export path collision limit reached.");
  }
}

async function verifyCreatedArtifact(
  vault: Vault,
  file: TFile,
  path: string,
  expectedHtml: string
): Promise<void> {
  try {
    if (file.path !== path || vault.getAbstractFileByPath(path) !== file) {
      throw new Error("Export identity mismatch.");
    }
    const actualHtml = await vault.read(file);
    if (
      actualHtml !== expectedHtml ||
      file.path !== path ||
      vault.getAbstractFileByPath(path) !== file
    ) {
      throw new Error("Export content or identity changed after create.");
    }
  } catch (error) {
    if (error instanceof ExportArtifactWriteAmbiguousError) throw error;
    throw new ExportArtifactWriteAmbiguousError(path, error);
  }
}

function normalizeReservedPaths(paths: readonly string[]): ReadonlySet<string> {
  const reserved = new Set<string>();
  for (const path of paths) {
    if (!isNormalizedVaultRelativePath(path)) {
      throw new Error("Reserved export path must be vault-relative.");
    }
    reserved.add(path);
  }
  return reserved;
}

async function ensureFolders(vault: Vault, path: string): Promise<void> {
  let current = "";
  for (const segment of path.split("/")) {
    current = current ? `${current}/${segment}` : segment;
    const existing = vault.getAbstractFileByPath(current);
    if (existing) {
      if (!("children" in existing)) throw new Error("Export folder conflicts with a file.");
      continue;
    }
    await vault.createFolder(current);
  }
}

function safeBasename(value: string): boolean {
  return (
    value.endsWith(".html") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    value.length <= 160
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
