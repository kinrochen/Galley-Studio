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
  type HistoryRetentionResult,
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
  phase: "prepared" | "committed";
}

interface MemoryOwnershipCleanupJournal {
  readonly ownership: readonly [MemoryPairOwnership, MemoryPairOwnership];
}

interface MemoryHistoryJournal {
  readonly provisional: HistoryFile<MemoryHistoryObservation>;
  readonly promoted: HistoryFile<MemoryHistoryObservation>;
  readonly removals: readonly HistoryFile<MemoryHistoryObservation>[];
  removedCount: number;
  rollback: boolean;
}

interface MemoryPendingCleanupJournal {
  readonly file: HistoryFile<MemoryHistoryObservation>;
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
  | "replace_after_commit_marker"
  | "replace_rollback_html"
  | "replace_rollback_sidecar"
  | "create_after_html"
  | "create_after_sidecar"
  | "create_after_commit_marker"
  | "create_cleanup_html"
  | "create_cleanup_sidecar"
  | "owned_cleanup_after_html"
  | "owned_cleanup_after_sidecar"
  | "history_before_promotion"
  | "history_after_promotion"
  | "history_after_remove"
  | "history_recovery_start"
  | "history_rollback_before_remove"
  | "history_rollback_after_remove"
  | "history_rollback_recovery";

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
  crashStages?: ReadonlySet<MemoryFaultStage>;
  abortAtStage?: MemoryFaultStage;
  abortController?: AbortController;
  beforeHistoryRemove?(
    file: HistoryFile<MemoryHistoryObservation>
  ): Promise<void> | void;
  verifyReadOverride?: VaultPairSnapshot<MemoryPairObservation> | null;
}

export class MemoryCrashError extends Error {
  constructor(readonly stage: MemoryFaultStage) {
    super(`simulated process crash at ${stage}`);
    this.name = "MemoryCrashError";
  }
}

export class MemoryWorkbenchBacking {
  readonly files = new Map<string, MemoryEntry>();
  readonly folders = new Set<string>();
  readonly pairJournals = new Map<string, MemoryPairJournal>();
  readonly ownershipCleanupJournals = new Map<
    string,
    MemoryOwnershipCleanupJournal
  >();
  readonly historyJournals = new Map<MemoryEntry, MemoryHistoryJournal>();
  readonly pendingCleanupJournals = new Map<
    MemoryEntry,
    MemoryPendingCleanupJournal
  >();
  readonly historyReceipts = new Map<
    MemoryEntry,
    HistoryFile<MemoryHistoryObservation>
  >();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    for (const [path, contents] of Object.entries(initialFiles)) {
      this.files.set(path, makeEntry(contents));
    }
  }

  async serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#queues.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#queues.get(key) === current) this.#queues.delete(key);
    }
  }

  rawRead(path: string): string | null {
    return this.files.get(path)?.contents ?? null;
  }

  rawPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  journalCount(): number {
    return (
      this.pairJournals.size +
      this.ownershipCleanupJournals.size +
      this.historyJournals.size +
      this.pendingCleanupJournals.size
    );
  }
}

export class MemoryWorkbenchVault
  implements
    GalleyDocumentVault<MemoryPairObservation, MemoryPairOwnership>,
    HistoryVault<MemoryHistoryObservation>
{
  readonly backing: MemoryWorkbenchBacking;
  readonly hooks: MemoryWorkbenchHooks;
  #destroyed = false;
  replaceCalls = 0;
  createPairCalls = 0;
  removePairCalls = 0;
  historyCreateCalls = 0;

  constructor(
    initialFiles: Readonly<Record<string, string>> = {},
    hooks: MemoryWorkbenchHooks = {},
    backing?: MemoryWorkbenchBacking
  ) {
    this.hooks = hooks;
    this.backing = backing ?? new MemoryWorkbenchBacking();
    for (const [path, contents] of Object.entries(initialFiles)) {
      if (!this.backing.files.has(path)) {
        this.backing.files.set(path, makeEntry(contents));
      }
    }
  }

  static reopen(
    backing: MemoryWorkbenchBacking,
    hooks: MemoryWorkbenchHooks = {}
  ): MemoryWorkbenchVault {
    return new MemoryWorkbenchVault({}, hooks, backing);
  }

  destroy(): void {
    this.#destroyed = true;
  }

  async readPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<VaultPairSnapshot<MemoryPairObservation> | null> {
    throwIfAborted(signal);
    await this.#recoverAll();
    if (this.hooks.verifyReadOverride !== undefined) {
      const override = this.hooks.verifyReadOverride;
      delete this.hooks.verifyReadOverride;
      return override;
    }
    const html = this.backing.files.get(paths.html);
    const sidecar = this.backing.files.get(paths.sidecar);
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
    await this.#recoverAll();
    return this.backing.files.get(path)?.contents ?? null;
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
    await this.#recoverAll();
    await this.hooks.beforeReplace?.();
    throwIfAborted(signal);
    const currentHtml = this.backing.files.get(paths.html);
    const currentSidecar = this.backing.files.get(paths.sidecar);
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
      newSidecar: sidecar,
      phase: "prepared"
    };
    this.backing.pairJournals.set(paths.html, journal);
    try {
      this.backing.files.set(paths.html, html);
      this.#operationStage("replace_after_html", signal);
      this.backing.files.set(paths.sidecar, sidecar);
      this.#operationStage("replace_after_sidecar", signal);
      journal.phase = "committed";
      this.#operationStage("replace_after_commit_marker", signal);
    } catch (error) {
      if (!(error instanceof MemoryCrashError)) {
        try {
          await this.#recoverPairJournal(journal);
        } catch {
          // The durable journal remains for a later adapter instance.
        }
      }
      throw error;
    }
    const observation = { html, sidecar };
    this.backing.pairJournals.delete(paths.html);
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
    await this.#recoverAll();
    await this.hooks.beforeCreatePair?.(paths);
    throwIfAborted(signal);
    if (
      this.backing.files.has(paths.html) ||
      this.backing.files.has(paths.sidecar)
    ) {
      return { status: "collision" };
    }
    if (this.hooks.failCreatePair) {
      throw new Error("injected atomic pair creation failure");
    }
    const html = makeEntry(contents.html);
    const sidecar = makeEntry(contents.sidecarJson);
    const journal: MemoryPairJournal = {
      mode: "create",
      paths,
      oldHtml: null,
      oldSidecar: null,
      newHtml: html,
      newSidecar: sidecar,
      phase: "prepared"
    };
    this.backing.pairJournals.set(paths.html, journal);
    try {
      this.backing.files.set(paths.html, html);
      this.#operationStage("create_after_html", signal);
      this.backing.files.set(paths.sidecar, sidecar);
      this.#operationStage("create_after_sidecar", signal);
      journal.phase = "committed";
      this.#operationStage("create_after_commit_marker", signal);
    } catch (error) {
      if (!(error instanceof MemoryCrashError)) {
        try {
          await this.#recoverPairJournal(journal);
        } catch {
          // The durable journal remains for a later adapter instance.
        }
      }
      throw error;
    }
    const observation = { html, sidecar };
    this.backing.pairJournals.delete(paths.html);
    return {
      status: "created",
      observation,
      ownership: [
        { paths, member: "html", entry: html },
        { paths, member: "sidecar", entry: sidecar }
      ]
    };
  }

  async cleanupCreatedMembers(
    ownership: readonly [MemoryPairOwnership, MemoryPairOwnership]
  ): Promise<void> {
    this.#assertLive();
    const key = ownership[0].paths.html;
    this.backing.ownershipCleanupJournals.set(key, { ownership });
    let firstError: unknown;
    for (const member of ownership) {
      this.removePairCalls += 1;
      try {
        await this.hooks.beforeRemovePair?.(member);
        const path = member.paths[member.member];
        if (this.backing.files.get(path) === member.entry) {
          this.backing.files.delete(path);
        }
        this.#operationStage(
          member.member === "html"
            ? "owned_cleanup_after_html"
            : "owned_cleanup_after_sidecar"
        );
      } catch (error) {
        if (error instanceof MemoryCrashError) throw error;
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
    this.backing.ownershipCleanupJournals.delete(key);
  }

  async ensureFolder(path: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.#recoverAll();
    this.backing.folders.add(path);
  }

  async listFiles(
    folder: string,
    signal?: AbortSignal
  ): Promise<readonly HistoryFile<MemoryHistoryObservation>[]> {
    throwIfAborted(signal);
    await this.#recoverAll();
    const prefix = `${folder}/`;
    return [...this.backing.files]
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
    await this.#recoverAll();
    if (this.backing.files.has(path)) return { status: "collision" };
    const entry = makeEntry(html);
    this.backing.files.set(path, entry);
    return {
      status: "created",
      file: { path, html, observation: { entry } }
    };
  }

  async applyRetentionTransaction(
    provisional: HistoryFile<MemoryHistoryObservation>,
    finalPath: string,
    observedFiles: readonly HistoryFile<MemoryHistoryObservation>[],
    removals: readonly HistoryFile<MemoryHistoryObservation>[],
    signal?: AbortSignal
  ): Promise<HistoryRetentionResult<MemoryHistoryObservation>> {
    throwIfAborted(signal);
    await this.#recoverAll();
    const receipt = this.backing.historyReceipts.get(
      provisional.observation.entry
    );
    if (receipt) return { status: "created", file: receipt };

    const folder = finalPath.slice(0, finalPath.lastIndexOf("/"));
    return this.backing.serialize(`history:${folder}`, async () => {
      const repeated = this.backing.historyReceipts.get(
        provisional.observation.entry
      );
      if (repeated) return { status: "created", file: repeated };
      if (
        this.backing.files.get(provisional.path) !==
        provisional.observation.entry
      ) {
        return { status: "lost" };
      }
      if (this.backing.files.has(finalPath)) return { status: "collision" };
      const prefix = `${folder}/`;
      const currentFiles = [...this.backing.files].filter(([path]) =>
        path.startsWith(prefix)
      );
      if (
        currentFiles.length !== observedFiles.length ||
        observedFiles.some(
          (file) =>
            this.backing.files.get(file.path) !== file.observation.entry
        )
      ) {
        return { status: "conflict" };
      }
      if (
        removals.some(
          (file) =>
            this.backing.files.get(file.path) !== file.observation.entry
        )
      ) {
        return { status: "conflict" };
      }

      this.#operationStage("history_before_promotion", signal);
      const entry = makeEntry(provisional.html);
      const promoted = {
        path: finalPath,
        html: provisional.html,
        observation: { entry }
      };
      const journal: MemoryHistoryJournal = {
        provisional,
        promoted,
        removals,
        removedCount: 0,
        rollback: false
      };
      this.backing.historyJournals.set(provisional.observation.entry, journal);
      try {
        this.backing.files.set(finalPath, entry);
        if (
          this.backing.files.get(provisional.path) ===
          provisional.observation.entry
        ) {
          this.backing.files.delete(provisional.path);
        }
        this.#operationStage("history_after_promotion", signal);

        for (const file of removals) {
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
          if (this.backing.files.get(file.path) !== file.observation.entry) {
            journal.rollback = true;
            await this.#rollbackHistoryJournal(journal);
            return { status: "ownership-conflict" };
          }
          this.backing.files.delete(file.path);
          journal.removedCount += 1;
          this.#operationStage("history_after_remove", signal);
        }

        this.backing.historyReceipts.set(
          provisional.observation.entry,
          promoted
        );
        this.backing.historyJournals.delete(provisional.observation.entry);
        return { status: "created", file: promoted };
      } catch (error) {
        // Once promotion mutates durable state, every failure is resolved by
        // replaying the same journal forward. This makes post-mutation throws
        // and crashes indistinguishable and idempotent across adapter restart.
        throw error;
      }
    });
  }

  async rollbackPrepared(
    file: HistoryFile<MemoryHistoryObservation>
  ): Promise<boolean> {
    this.#assertLive();
    if (this.backing.files.get(file.path) !== file.observation.entry) {
      return false;
    }
    const journal = { file };
    this.backing.pendingCleanupJournals.set(file.observation.entry, journal);
    this.#operationStage("history_rollback_before_remove");
    if (this.backing.files.get(file.path) === file.observation.entry) {
      this.backing.files.delete(file.path);
    }
    this.#operationStage("history_rollback_after_remove");
    this.backing.pendingCleanupJournals.delete(file.observation.entry);
    return true;
  }

  writeExternally(path: string, contents: string): void {
    this.backing.files.set(path, makeEntry(contents));
  }

  removeExternally(path: string): void {
    this.backing.files.delete(path);
  }

  read(path: string): string | null {
    return this.backing.rawRead(path);
  }

  paths(): string[] {
    return this.backing.rawPaths();
  }

  journalCount(): number {
    return this.backing.journalCount();
  }

  #operationStage(stage: MemoryFaultStage, signal?: AbortSignal): void {
    if (this.hooks.abortAtStage === stage) {
      this.hooks.abortController?.abort();
    }
    throwIfAborted(signal);
    if (this.hooks.crashStages?.has(stage) === true) {
      throw new MemoryCrashError(stage);
    }
    if (this.#hasFault(stage)) {
      throw new Error(`injected transaction failure at ${stage}`);
    }
  }

  #hasFault(stage: MemoryFaultStage): boolean {
    return this.hooks.faultStages?.has(stage) === true;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new Error("Memory workbench adapter instance was destroyed.");
    }
  }

  async #recoverAll(): Promise<void> {
    this.#assertLive();
    for (const journal of [...this.backing.pairJournals.values()]) {
      await this.#recoverPairJournal(journal);
    }
    for (const journal of [
      ...this.backing.ownershipCleanupJournals.values()
    ]) {
      for (const ownership of journal.ownership) {
        const path = ownership.paths[ownership.member];
        if (this.backing.files.get(path) === ownership.entry) {
          this.backing.files.delete(path);
        }
      }
      this.backing.ownershipCleanupJournals.delete(
        journal.ownership[0].paths.html
      );
    }
    for (const journal of [...this.backing.historyJournals.values()]) {
      const folder = journal.promoted.path.slice(
        0,
        journal.promoted.path.lastIndexOf("/")
      );
      await this.backing.serialize(`history:${folder}`, async () => {
        if (
          this.backing.historyJournals.get(
            journal.provisional.observation.entry
          ) === journal
        ) {
          await this.#recoverHistoryJournal(journal);
        }
      });
    }
    for (const journal of [
      ...this.backing.pendingCleanupJournals.values()
    ]) {
      this.#operationStage("history_rollback_recovery");
      if (
        this.backing.files.get(journal.file.path) ===
        journal.file.observation.entry
      ) {
        this.backing.files.delete(journal.file.path);
      }
      this.backing.pendingCleanupJournals.delete(
        journal.file.observation.entry
      );
    }
  }

  async #recoverPairJournal(journal: MemoryPairJournal): Promise<void> {
    const rollForward =
      journal.mode === "replace" && journal.phase === "committed";
    if (rollForward) {
      this.#recoverPairMember(
        journal.paths.html,
        journal.oldHtml,
        journal.newHtml,
        journal.newHtml,
        "replace_rollback_html"
      );
      this.#recoverPairMember(
        journal.paths.sidecar,
        journal.oldSidecar,
        journal.newSidecar,
        journal.newSidecar,
        "replace_rollback_sidecar"
      );
    } else {
      this.#recoverPairMember(
        journal.paths.html,
        journal.oldHtml,
        journal.newHtml,
        journal.oldHtml,
        journal.mode === "replace"
          ? "replace_rollback_html"
          : "create_cleanup_html"
      );
      this.#recoverPairMember(
        journal.paths.sidecar,
        journal.oldSidecar,
        journal.newSidecar,
        journal.oldSidecar,
        journal.mode === "replace"
          ? "replace_rollback_sidecar"
          : "create_cleanup_sidecar"
      );
    }
    this.backing.pairJournals.delete(journal.paths.html);
  }

  #recoverPairMember(
    path: string,
    oldEntry: MemoryEntry | null,
    newEntry: MemoryEntry,
    desired: MemoryEntry | null,
    stage: MemoryFaultStage
  ): void {
    this.#operationStage(stage);
    const current = this.backing.files.get(path) ?? null;
    if (current !== oldEntry && current !== newEntry && current !== desired) {
      throw new Error("Memory transaction recovery lost member ownership.");
    }
    if (desired) this.backing.files.set(path, desired);
    else this.backing.files.delete(path);
  }

  async #recoverHistoryJournal(journal: MemoryHistoryJournal): Promise<void> {
    this.#operationStage("history_recovery_start");
    if (journal.rollback) {
      await this.#rollbackHistoryJournal(journal);
      return;
    }
    const promotedEntry = journal.promoted.observation.entry;
    const currentPromoted = this.backing.files.get(journal.promoted.path);
    if (!currentPromoted) {
      this.backing.files.set(journal.promoted.path, promotedEntry);
    } else if (currentPromoted !== promotedEntry) {
      journal.rollback = true;
      await this.#rollbackHistoryJournal(journal);
      throw new Error("History recovery lost promoted-file ownership.");
    }
    if (
      this.backing.files.get(journal.provisional.path) ===
      journal.provisional.observation.entry
    ) {
      this.backing.files.delete(journal.provisional.path);
    }
    for (const file of journal.removals) {
      const current = this.backing.files.get(file.path);
      if (current === file.observation.entry) {
        this.backing.files.delete(file.path);
      } else if (current) {
        journal.rollback = true;
        await this.#rollbackHistoryJournal(journal);
        throw new Error("History recovery lost prune-candidate ownership.");
      }
    }
    this.backing.historyReceipts.set(
      journal.provisional.observation.entry,
      journal.promoted
    );
    this.backing.historyJournals.delete(
      journal.provisional.observation.entry
    );
  }

  async #rollbackHistoryJournal(journal: MemoryHistoryJournal): Promise<void> {
    if (
      this.backing.files.get(journal.promoted.path) ===
      journal.promoted.observation.entry
    ) {
      this.backing.files.delete(journal.promoted.path);
    }
    for (const file of journal.removals.slice(0, journal.removedCount)) {
      if (!this.backing.files.has(file.path)) {
        this.backing.files.set(file.path, file.observation.entry);
      }
    }
    if (!this.backing.files.has(journal.provisional.path)) {
      this.backing.files.set(
        journal.provisional.path,
        journal.provisional.observation.entry
      );
    }
    this.backing.historyJournals.delete(
      journal.provisional.observation.entry
    );
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
  backing: MemoryWorkbenchBacking;
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
  const backing = new MemoryWorkbenchBacking(initialFiles);
  const vault = MemoryWorkbenchVault.reopen(backing, options.hooks);
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
    backing,
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
