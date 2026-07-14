import {
  GalleyDocumentRepository,
  type ArtifactPaths,
  type GalleyDocumentVault,
  type VaultCreatePairResult,
  type VaultPairSnapshot,
  type VaultReplacePairResult
} from "../../src/documents/GalleyDocumentRepository";
import {
  HistoryRepository,
  type HistoryFile,
  type HistoryPromotionResult,
  type HistoryVault
} from "../../src/documents/HistoryRepository";
import type { DocumentSessionDependencies } from "../../src/documents/DocumentSession";
import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import {
  GalleySidecarV1Schema,
  sha256Text,
  type GalleySidecarV1
} from "../../src/documents/GalleySidecar";
export { memoryVault } from "./memoryVault";

export const TEST_DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";
export const TEST_COPY_ID = "223e4567-e89b-42d3-a456-426614174000";
export const TEST_NOW = new Date("2026-07-14T08:09:10.123Z");
export const TEST_PATHS: ArtifactPaths = {
  html: "notes/article.galley.html",
  sidecar: "notes/article.galley.json"
};

interface MemoryEntry {
  readonly identity: symbol;
  readonly version: number;
  readonly contents: string;
}

interface MemoryPairJournal {
  readonly mode: "replace" | "create";
  readonly paths: ArtifactPaths;
  readonly oldHtml: MemoryEntry | null;
  readonly oldSidecar: MemoryEntry | null;
  readonly newHtml: MemoryEntry;
  readonly newSidecar: MemoryEntry;
}

export interface MemoryPairObservation {
  readonly html: MemoryEntry;
  readonly sidecar: MemoryEntry;
}

export interface MemoryPairOwnership {
  readonly paths: ArtifactPaths;
  readonly member: "html" | "sidecar";
  readonly entry: MemoryEntry;
}

export interface MemoryHistoryObservation {
  readonly entry: MemoryEntry;
}

export type MemoryFaultStage =
  | "replace_after_html"
  | "replace_after_sidecar"
  | "replace_rollback_html"
  | "replace_rollback_sidecar"
  | "create_after_html"
  | "create_after_sidecar"
  | "create_cleanup_html"
  | "create_cleanup_sidecar";

export interface MemoryWorkbenchHooks {
  beforeReplace?(): Promise<void> | void;
  afterReplaceCommitted?(): Promise<void> | void;
  beforeCreatePair?(paths: ArtifactPaths): Promise<void> | void;
  beforeRemovePair?(ownership: MemoryPairOwnership): Promise<void> | void;
  failReplace?: boolean;
  failCreatePair?: boolean;
  failHistoryRemove?: boolean;
  failHistoryRemoveCount?: number;
  faultStages?: ReadonlySet<MemoryFaultStage>;
  abortAtStage?: MemoryFaultStage;
  abortController?: AbortController;
  beforeHistoryRemove?(
    file: HistoryFile<MemoryHistoryObservation>
  ): Promise<void> | void;
  verifyReadOverride?: VaultPairSnapshot<MemoryPairObservation> | null;
}

export class MemoryWorkbenchVault
  implements
    GalleyDocumentVault<MemoryPairObservation, MemoryPairOwnership>,
    HistoryVault<MemoryHistoryObservation>
{
  readonly #files = new Map<string, MemoryEntry>();
  readonly #pairJournals = new Map<string, MemoryPairJournal>();
  readonly #folders = new Set<string>();
  readonly hooks: MemoryWorkbenchHooks;
  replaceCalls = 0;
  createPairCalls = 0;
  removePairCalls = 0;
  historyCreateCalls = 0;

  constructor(
    initialFiles: Readonly<Record<string, string>> = {},
    hooks: MemoryWorkbenchHooks = {}
  ) {
    this.hooks = hooks;
    for (const [path, contents] of Object.entries(initialFiles)) {
      this.#files.set(path, makeEntry(contents));
    }
  }

  async readPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<VaultPairSnapshot<MemoryPairObservation> | null> {
    throwIfAborted(signal);
    if (this.hooks.verifyReadOverride !== undefined) {
      const override = this.hooks.verifyReadOverride;
      delete this.hooks.verifyReadOverride;
      return override;
    }
    const html = this.#files.get(paths.html);
    const sidecar = this.#files.get(paths.sidecar);
    if (!html && !sidecar) return null;
    if (!html || !sidecar) {
      throw new Error("Memory vault contains a one-sided document pair");
    }
    return {
      html: html.contents,
      sidecarJson: sidecar.contents,
      observation: { html, sidecar }
    };
  }

  async readText(path: string, signal?: AbortSignal): Promise<string | null> {
    throwIfAborted(signal);
    return this.#files.get(path)?.contents ?? null;
  }

  samePairObservation(
    left: MemoryPairObservation,
    right: MemoryPairObservation
  ): boolean {
    return left.html === right.html && left.sidecar === right.sidecar;
  }

  async replacePairTransactional(
    paths: ArtifactPaths,
    expected: MemoryPairObservation,
    next: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<VaultReplacePairResult<MemoryPairObservation>> {
    this.replaceCalls += 1;
    throwIfAborted(signal);
    await this.hooks.beforeReplace?.();
    throwIfAborted(signal);
    const currentHtml = this.#files.get(paths.html);
    const currentSidecar = this.#files.get(paths.sidecar);
    if (currentHtml !== expected.html || currentSidecar !== expected.sidecar) {
      return { status: "conflict" };
    }
    if (this.hooks.failReplace) {
      throw new Error("injected atomic pair replacement failure");
    }
    const html = makeEntry(next.html);
    const sidecar = makeEntry(next.sidecarJson);
    const journal: MemoryPairJournal = {
      mode: "replace",
      paths,
      oldHtml: currentHtml,
      oldSidecar: currentSidecar,
      newHtml: html,
      newSidecar: sidecar
    };
    this.#pairJournals.set(paths.html, journal);
    let wroteHtml = false;
    let wroteSidecar = false;
    try {
      this.#files.set(paths.html, html);
      wroteHtml = true;
      this.#operationStage("replace_after_html", signal);
      this.#files.set(paths.sidecar, sidecar);
      wroteSidecar = true;
      this.#operationStage("replace_after_sidecar", signal);
    } catch (error) {
      if (wroteHtml && this.#files.get(paths.html) === html) {
        if (!this.#hasFault("replace_rollback_html")) {
          this.#files.set(paths.html, currentHtml);
        }
        // The durable recovery journal retries independently of the failed
        // first rollback attempt.
        if (this.#files.get(paths.html) === html) {
          this.#files.set(paths.html, currentHtml);
        }
      }
      if (wroteSidecar && this.#files.get(paths.sidecar) === sidecar) {
        if (!this.#hasFault("replace_rollback_sidecar")) {
          this.#files.set(paths.sidecar, currentSidecar);
        }
        if (this.#files.get(paths.sidecar) === sidecar) {
          this.#files.set(paths.sidecar, currentSidecar);
        }
      }
      this.#pairJournals.delete(paths.html);
      throw error;
    }
    const observation = { html, sidecar };
    this.#pairJournals.delete(paths.html);
    await this.hooks.afterReplaceCommitted?.();
    return { status: "committed", observation };
  }

  async createPairTransactional(
    paths: ArtifactPaths,
    contents: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<
    VaultCreatePairResult<MemoryPairObservation, MemoryPairOwnership>
  > {
    this.createPairCalls += 1;
    throwIfAborted(signal);
    await this.hooks.beforeCreatePair?.(paths);
    throwIfAborted(signal);
    if (this.#files.has(paths.html) || this.#files.has(paths.sidecar)) {
      return { status: "collision" };
    }
    if (this.hooks.failCreatePair) {
      throw new Error("injected atomic pair creation failure");
    }
    const html = makeEntry(contents.html);
    const sidecar = makeEntry(contents.sidecarJson);
    this.#pairJournals.set(paths.html, {
      mode: "create",
      paths,
      oldHtml: null,
      oldSidecar: null,
      newHtml: html,
      newSidecar: sidecar
    });
    let wroteHtml = false;
    let wroteSidecar = false;
    try {
      this.#files.set(paths.html, html);
      wroteHtml = true;
      this.#operationStage("create_after_html", signal);
      this.#files.set(paths.sidecar, sidecar);
      wroteSidecar = true;
      this.#operationStage("create_after_sidecar", signal);
    } catch (error) {
      if (wroteHtml && this.#files.get(paths.html) === html) {
        if (!this.#hasFault("create_cleanup_html")) {
          this.#files.delete(paths.html);
        }
        if (this.#files.get(paths.html) === html) this.#files.delete(paths.html);
      }
      if (wroteSidecar && this.#files.get(paths.sidecar) === sidecar) {
        if (!this.#hasFault("create_cleanup_sidecar")) {
          this.#files.delete(paths.sidecar);
        }
        if (this.#files.get(paths.sidecar) === sidecar) {
          this.#files.delete(paths.sidecar);
        }
      }
      this.#pairJournals.delete(paths.html);
      throw error;
    }
    const observation = { html, sidecar };
    this.#pairJournals.delete(paths.html);
    return {
      status: "created",
      observation,
      ownership: [
        { paths, member: "html", entry: html },
        { paths, member: "sidecar", entry: sidecar }
      ]
    };
  }

  async removeCreatedMember(ownership: MemoryPairOwnership): Promise<void> {
    this.removePairCalls += 1;
    await this.hooks.beforeRemovePair?.(ownership);
    const path = ownership.paths[ownership.member];
    if (this.#files.get(path) === ownership.entry) this.#files.delete(path);
  }

  async ensureFolder(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.#folders.add(path);
  }

  async listFiles(
    folder: string,
    signal?: AbortSignal
  ): Promise<readonly HistoryFile<MemoryHistoryObservation>[]> {
    throwIfAborted(signal);
    const prefix = `${folder}/`;
    return [...this.#files]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, entry]) => ({
        path,
        html: entry.contents,
        observation: { entry }
      }));
  }

  async createFileExclusive(
    path: string,
    html: string,
    signal?: AbortSignal
  ): Promise<
    | { status: "created"; file: HistoryFile<MemoryHistoryObservation> }
    | { status: "collision" }
  > {
    this.historyCreateCalls += 1;
    throwIfAborted(signal);
    if (this.#files.has(path)) return { status: "collision" };
    const entry = makeEntry(html);
    this.#files.set(path, entry);
    return {
      status: "created",
      file: { path, html, observation: { entry } }
    };
  }

  async promoteObserved(
    provisional: HistoryFile<MemoryHistoryObservation>,
    finalPath: string,
    signal?: AbortSignal
  ): Promise<HistoryPromotionResult<MemoryHistoryObservation>> {
    throwIfAborted(signal);
    if (this.#files.get(provisional.path) !== provisional.observation.entry) {
      return { status: "lost" };
    }
    if (this.#files.has(finalPath)) return { status: "collision" };
    const entry = makeEntry(provisional.html);
    this.#files.set(finalPath, entry);
    this.#files.delete(provisional.path);
    return {
      status: "created",
      file: {
        path: finalPath,
        html: provisional.html,
        observation: { entry }
      }
    };
  }

  async removeObserved(
    file: HistoryFile<MemoryHistoryObservation>,
    signal?: AbortSignal
  ): Promise<boolean> {
    throwIfAborted(signal);
    await this.hooks.beforeHistoryRemove?.(file);
    throwIfAborted(signal);
    if (
      this.hooks.failHistoryRemoveCount !== undefined &&
      this.hooks.failHistoryRemoveCount > 0
    ) {
      this.hooks.failHistoryRemoveCount -= 1;
      throw new Error("injected history prune failure");
    }
    if (this.hooks.failHistoryRemove) {
      throw new Error("injected history prune failure");
    }
    if (this.#files.get(file.path) !== file.observation.entry) return false;
    this.#files.delete(file.path);
    return true;
  }

  async removePrepared(
    file: HistoryFile<MemoryHistoryObservation>
  ): Promise<boolean> {
    if (this.#files.get(file.path) !== file.observation.entry) return false;
    this.#files.delete(file.path);
    return true;
  }

  writeExternally(path: string, contents: string): void {
    this.#files.set(path, makeEntry(contents));
  }

  removeExternally(path: string): void {
    this.#files.delete(path);
  }

  read(path: string): string | null {
    return this.#files.get(path)?.contents ?? null;
  }

  paths(): string[] {
    return [...this.#files.keys()].sort();
  }

  journalCount(): number {
    return this.#pairJournals.size;
  }

  #operationStage(stage: MemoryFaultStage, signal?: AbortSignal): void {
    if (this.hooks.abortAtStage === stage) {
      this.hooks.abortController?.abort();
    }
    throwIfAborted(signal);
    if (this.#hasFault(stage)) {
      throw new Error(`injected transaction failure at ${stage}`);
    }
  }

  #hasFault(stage: MemoryFaultStage): boolean {
    return this.hooks.faultStages?.has(stage) === true;
  }
}

export function memoryHistoryVault(
  initialFiles: Readonly<Record<string, string>> = {},
  hooks: MemoryWorkbenchHooks = {}
): MemoryWorkbenchVault {
  return new MemoryWorkbenchVault(initialFiles, hooks);
}

export interface SessionFixture {
  dependencies: DocumentSessionDependencies<
    MemoryPairObservation,
    MemoryPairOwnership
  >;
  vault: MemoryWorkbenchVault;
  repository: GalleyDocumentRepository<
    MemoryPairObservation,
    MemoryPairOwnership
  >;
  history: HistoryRepository<MemoryHistoryObservation>;
  paths: ArtifactPaths;
  html: string;
  sidecar: GalleySidecarV1;
  replaceExternally(bodyHtml: string): Promise<void>;
  replacePairExternally(bodyHtml: string): Promise<void>;
}

export async function makeSessionDeps(options: {
  bodyHtml?: string;
  documentId?: string;
  source?: string | null;
  hooks?: MemoryWorkbenchHooks;
  initialFiles?: Readonly<Record<string, string>>;
  now?: () => Date;
  randomUUID?: () => string;
} = {}): Promise<SessionFixture> {
  const source = options.source === undefined ? "# Original source\n" : options.source;
  const html = GalleyDocumentCodec.serialize({
    doctype: "<!DOCTYPE html>",
    lang: "zh-CN",
    headHtml:
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Article</title>',
    bodyHtml:
      options.bodyHtml ??
      '<article data-galley-role="story"><p data-galley-source="paragraph-001">original</p></article>'
  });
  const sidecar = GalleySidecarV1Schema.parse({
    schemaVersion: 1,
    documentId: options.documentId ?? TEST_DOCUMENT_ID,
    sourcePath: "notes/article.md",
    sourceHash: await sha256Text(source ?? "missing source"),
    htmlHash: await sha256Text(html),
    themeId: "graphite-minimal",
    skillVersion: "test-version",
    skillLoadMode: "injected",
    skillFiles: ["SKILL.md", "references/theme-index.md"],
    model: "test-model",
    promptVersion: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    validation: { valid: true, issues: [] },
    exports: []
  });
  const initialFiles: Record<string, string> = {
    [TEST_PATHS.html]: html,
    [TEST_PATHS.sidecar]: `${JSON.stringify(sidecar, null, 2)}\n`,
    ...(source === null ? {} : { [sidecar.sourcePath]: source }),
    ...options.initialFiles
  };
  const vault = new MemoryWorkbenchVault(initialFiles, options.hooks);
  const repository = new GalleyDocumentRepository(vault);
  const history = new HistoryRepository(vault, 20, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  const dependencies: SessionFixture["dependencies"] = {
    repository,
    history,
    htmlPath: TEST_PATHS.html,
    sidecarPath: TEST_PATHS.sidecar,
    now: options.now ?? (() => TEST_NOW),
    randomUUID: options.randomUUID ?? (() => TEST_COPY_ID)
  };

  return {
    dependencies,
    vault,
    repository,
    history,
    paths: TEST_PATHS,
    html,
    sidecar,
    async replaceExternally(bodyHtml) {
      const changed = GalleyDocumentCodec.serialize({
        ...GalleyDocumentCodec.parse(html),
        bodyHtml
      });
      vault.writeExternally(TEST_PATHS.html, changed);
    },
    async replacePairExternally(bodyHtml) {
      const changed = GalleyDocumentCodec.serialize({
        ...GalleyDocumentCodec.parse(html),
        bodyHtml
      });
      const changedSidecar = {
        ...sidecar,
        htmlHash: await sha256Text(changed)
      };
      vault.writeExternally(TEST_PATHS.html, changed);
      vault.writeExternally(
        TEST_PATHS.sidecar,
        `${JSON.stringify(changedSidecar, null, 2)}\n`
      );
    }
  };
}

function makeEntry(contents: string): MemoryEntry {
  return { identity: Symbol("memory-file"), version: 1, contents };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
