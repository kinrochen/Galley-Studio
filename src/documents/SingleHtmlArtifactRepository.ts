import type { TFile, Vault } from "obsidian";

import type { ArtifactPaths, WriteArtifactInput } from "./ArtifactRepository";
import { isNormalizedVaultRelativePath } from "./GalleySidecar";

const MARKDOWN_EXTENSION = /\.md$/iu;

/** Writes the generated article directly to its one final HTML file. */
export class SingleHtmlArtifactRepository {
  constructor(private readonly vault: Vault) {}

  async prepare(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
  }

  async writeNew(
    input: WriteArtifactInput,
    signal?: AbortSignal
  ): Promise<ArtifactPaths> {
    throwIfAborted(signal);
    const path = finalHtmlPath(input.sourcePath);
    const html = input.document.html.trim();
    if (!html) throw Object.assign(new Error("The Agent returned no HTML."), {
      code: "generation_empty"
    });

    const existing = this.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!isFile(existing)) {
        throw new Error("The final HTML path conflicts with a folder.");
      }
      await this.vault.modify(existing, html);
    } else {
      await this.vault.create(path, html);
    }
    throwIfAborted(signal);
    return { html: path, sidecar: "" };
  }
}

export function finalHtmlPath(sourcePath: string): string {
  if (
    !isNormalizedVaultRelativePath(sourcePath) ||
    !MARKDOWN_EXTENSION.test(sourcePath)
  ) {
    throw new Error("Expected a normalized Markdown source path.");
  }
  return sourcePath.replace(MARKDOWN_EXTENSION, ".html");
}

function isFile(value: unknown): value is TFile {
  return Boolean(value) && typeof value === "object" && "extension" in value!;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
