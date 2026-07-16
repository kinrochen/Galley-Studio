import type { TFile, Vault } from "obsidian";

import { DocumentConflictError, DocumentSaveInProgressError, type DocumentSessionState, type SaveReason } from "./DocumentSession";
import type { ArtifactPaths } from "./GalleyDocumentRepository";
import { isNormalizedVaultRelativePath } from "./GalleySidecar";
import type { HistorySnapshot } from "./HistoryRepository";
import type {
  DocumentRecoveryInspection,
  DocumentRecoveryState,
  OpenedGalleyDocumentSession
} from "./DocumentSessionOpener";
import type { GalleyExportRecordV1 } from "../export/ExportRecord";

export class ObsidianSingleHtmlDocumentSessionOpener {
  constructor(private readonly vault: Vault) {}

  async open(path: string, signal?: AbortSignal): Promise<OpenedGalleyDocumentSession> {
    validatePath(path);
    throwIfAborted(signal);
    const file = this.vault.getFileByPath(path);
    if (!file) throw new Error("The HTML file does not exist.");
    const html = await this.vault.read(file);
    throwIfAborted(signal);
    return new ObsidianSingleHtmlDocumentSession(this.vault, file, html);
  }

  async inspectRecovery(
    path: string,
    signal?: AbortSignal
  ): Promise<DocumentRecoveryInspection> {
    validatePath(path);
    throwIfAborted(signal);
    return {
      paths: { html: path, sidecar: "" },
      pair: this.vault.getFileByPath(path) ? "present" : "missing",
      recovery: { status: "ready" }
    };
  }
}

class ObsidianSingleHtmlDocumentSession implements OpenedGalleyDocumentSession {
  readonly #vault: Vault;
  readonly #file: TFile;
  readonly #path: string;
  readonly #shell: HtmlShell;
  #savedHtml: string;
  #bodyHtml: string;
  #dirty = false;
  #saving = false;
  #conflict = false;
  #lastSavedAt: string | null = null;

  constructor(vault: Vault, file: TFile, html: string) {
    this.#vault = vault;
    this.#file = file;
    this.#path = file.path;
    this.#savedHtml = html;
    this.#shell = parseShell(html);
    this.#bodyHtml = this.#shell.bodyHtml;
  }

  state(): DocumentSessionState {
    return {
      dirty: this.#dirty,
      saving: this.#saving,
      conflict: this.#conflict,
      htmlHash: quickHash(this.html()),
      sourceChanged: false,
      lastSavedAt: this.#lastSavedAt
    };
  }

  paths(): ArtifactPaths {
    return { html: this.#path, sidecar: "" };
  }

  documentId(): string {
    return this.#path;
  }

  html(): string {
    return serializeShell(this.#shell, this.#bodyHtml);
  }

  bodyHtml(): string {
    return this.#bodyHtml;
  }

  exportPaths(): readonly string[] {
    return [];
  }

  updateBody(bodyHtml: string): void {
    this.#bodyHtml = bodyHtml;
    this.#dirty = this.html() !== this.#savedHtml;
  }

  async save(reason: SaveReason, signal?: AbortSignal): Promise<void> {
    if (this.#saving) throw new DocumentSaveInProgressError();
    throwIfAborted(signal);
    this.#saving = true;
    try {
      const current = await this.#vault.read(this.#file);
      if (current !== this.#savedHtml && reason !== "overwrite") {
        this.#conflict = true;
        throw new DocumentConflictError();
      }
      const html = this.html();
      await this.#vault.modify(this.#file, html);
      this.#savedHtml = html;
      this.#dirty = false;
      this.#conflict = false;
      this.#lastSavedAt = new Date().toISOString();
    } finally {
      this.#saving = false;
    }
  }

  async reload(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const html = await this.#vault.read(this.#file);
    const shell = parseShell(html);
    this.#savedHtml = html;
    this.#bodyHtml = shell.bodyHtml;
    this.#dirty = false;
    this.#conflict = false;
  }

  async saveCopy(signal?: AbortSignal): Promise<ArtifactPaths> {
    await this.save("overwrite", signal);
    return this.paths();
  }

  async history(): Promise<readonly HistorySnapshot[]> {
    return [];
  }

  async restoreHistory(): Promise<void> {
    throw new Error("Single-file HTML documents do not create history files.");
  }

  async recordExport(_record: GalleyExportRecordV1, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
  }

  recoveryState(): DocumentRecoveryState {
    return { status: "ready" };
  }
}

interface HtmlShell {
  readonly kind: "fragment" | "document";
  readonly original: string;
  readonly bodyHtml: string;
}

function parseShell(html: string): HtmlShell {
  const trimmed = html.trim();
  if (!/<!doctype\s+html|<html(?:\s|>)/iu.test(trimmed)) {
    return { kind: "fragment", original: trimmed, bodyHtml: trimmed };
  }
  const parsed = new DOMParser().parseFromString(trimmed, "text/html");
  return { kind: "document", original: trimmed, bodyHtml: parsed.body.innerHTML };
}

function serializeShell(shell: HtmlShell, bodyHtml: string): string {
  if (shell.kind === "fragment") return bodyHtml.trim();
  const parsed = new DOMParser().parseFromString(shell.original, "text/html");
  parsed.body.innerHTML = bodyHtml;
  return `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
}

function validatePath(path: string): void {
  if (!isSingleHtmlPath(path)) throw new Error("Expected one vault-relative HTML file.");
}

export function isSingleHtmlPath(path: string): boolean {
  return isNormalizedVaultRelativePath(path) && path.endsWith(".html") && !path.endsWith(".galley.html");
}

function quickHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
