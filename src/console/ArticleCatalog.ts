import type { EventRef } from "obsidian";
import { GalleyDocumentCodec } from "../documents/GalleyDocumentCodec";
import {
  GalleySidecarV1Schema,
  sha256Text
} from "../documents/GalleySidecar";
import type {
  ArticleCatalogSnapshot,
  CatalogArticle,
  UnavailableArticle,
  UnavailableArticleReason
} from "./ConsoleTypes";

export interface ArticleCatalogFile {
  readonly path: string;
  readonly name?: string;
  readonly stat?: {
    readonly mtime?: number;
    readonly ctime?: number;
    readonly size?: number;
  };
}

export interface ArticleCatalogVault {
  getFiles(): readonly ArticleCatalogFile[];
  read(file: ArticleCatalogFile): Promise<string>;
  on(
    event: "create" | "modify" | "rename" | "delete",
    callback: (...args: unknown[]) => unknown
  ): EventRef | unknown;
  offref?(ref: EventRef | unknown): void;
}

const HTML_SUFFIX = ".galley.html";
const SIDECAR_SUFFIX = ".galley.json";

export class ArticleCatalog {
  readonly #eventRefs: unknown[];
  readonly #listeners = new Set<() => void>();
  #cached: Promise<ArticleCatalogSnapshot> | null = null;
  #disposed = false;

  constructor(private readonly vault: ArticleCatalogVault) {
    const invalidate = () => this.#invalidate();
    this.#eventRefs = (["create", "modify", "rename", "delete"] as const).map(
      (event) => this.vault.on(event, invalidate)
    );
  }

  snapshot(): Promise<ArticleCatalogSnapshot> {
    if (!this.#cached) this.#cached = this.#scan();
    return this.#cached;
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.vault.offref) {
      for (const ref of this.#eventRefs) this.vault.offref(ref);
    }
    this.#listeners.clear();
    this.#cached = null;
  }

  #invalidate(): void {
    if (this.#disposed) return;
    this.#cached = null;
    for (const listener of [...this.#listeners]) listener();
  }

  async #scan(): Promise<ArticleCatalogSnapshot> {
    const files = this.vault.getFiles();
    const byPath = new Map(files.map((file) => [file.path, file]));
    const documents: CatalogArticle[] = [];
    const unavailable: UnavailableArticle[] = [];
    const pairedSidecars = new Set<string>();

    for (const htmlFile of files.filter(({ path }) => path.endsWith(HTML_SUFFIX))) {
      const sidecarPath = pairPath(htmlFile.path, HTML_SUFFIX, SIDECAR_SUFFIX);
      const sidecarFile = byPath.get(sidecarPath);
      if (!sidecarFile) {
        unavailable.push({ path: htmlFile.path, reason: "missing_sidecar" });
        continue;
      }
      pairedSidecars.add(sidecarPath);
      const inspected = await this.#inspectPair(htmlFile, sidecarFile);
      if ("reason" in inspected) {
        unavailable.push({ path: htmlFile.path, reason: inspected.reason });
      } else {
        documents.push(inspected.article);
      }
    }

    for (const sidecarFile of files.filter(({ path }) => path.endsWith(SIDECAR_SUFFIX))) {
      if (pairedSidecars.has(sidecarFile.path)) continue;
      const htmlPath = pairPath(sidecarFile.path, SIDECAR_SUFFIX, HTML_SUFFIX);
      if (!byPath.has(htmlPath)) {
        unavailable.push({ path: sidecarFile.path, reason: "missing_html" });
      }
    }

    documents.sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt ||
        left.htmlPath.localeCompare(right.htmlPath)
    );
    unavailable.sort((left, right) => left.path.localeCompare(right.path));
    return Object.freeze({
      documents: Object.freeze(documents),
      unavailable: Object.freeze(unavailable)
    });
  }

  async #inspectPair(
    htmlFile: ArticleCatalogFile,
    sidecarFile: ArticleCatalogFile
  ): Promise<
    | { readonly article: CatalogArticle }
    | { readonly reason: UnavailableArticleReason }
  > {
    let html: string;
    let sidecarJson: string;
    try {
      [html, sidecarJson] = await Promise.all([
        this.vault.read(htmlFile),
        this.vault.read(sidecarFile)
      ]);
    } catch {
      return { reason: "unreadable" };
    }

    let sidecar;
    try {
      sidecar = GalleySidecarV1Schema.parse(JSON.parse(sidecarJson) as unknown);
    } catch {
      return { reason: "invalid_sidecar" };
    }
    if ((await sha256Text(html)) !== sidecar.htmlHash) {
      return { reason: "html_hash_mismatch" };
    }
    try {
      GalleyDocumentCodec.parse(html);
    } catch {
      return { reason: "invalid_document" };
    }

    return {
      article: Object.freeze({
        htmlPath: htmlFile.path,
        sidecarPath: sidecarFile.path,
        sourcePath: sidecar.sourcePath,
        documentId: sidecar.documentId,
        themeId: sidecar.themeId,
        model: sidecar.model,
        generatedAt: sidecar.generatedAt,
        modifiedAt: Math.max(
          htmlFile.stat?.mtime ?? 0,
          sidecarFile.stat?.mtime ?? 0
        ),
        exportCount: sidecar.exports.length,
        validation: sidecar.validation.valid ? "valid" : "unverified"
      })
    };
  }
}

function pairPath(path: string, from: string, to: string): string {
  return `${path.slice(0, -from.length)}${to}`;
}
