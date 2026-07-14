import {
  GalleyDocumentRepository,
  type ArtifactPaths,
  type GalleyDocumentVault,
  type VaultCreatePairResult,
  type VaultPairSnapshot,
  type VaultReconcilePairWithHistoryResult,
  type VaultReplacePairResult,
  type VaultReplacePairWithHistoryResult
} from "../../src/documents/GalleyDocumentRepository";
import {
  HistoryRepository,
  type HistoryCommitPlan,
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
  readonly history?: MemoryHistoryJournal;
  phase: "prepared" | "committed";
}

interface MemoryOwnershipCleanupJournal {
  readonly ownership: readonly [MemoryPairOwnership, MemoryPairOwnership];
}

interface MemoryHistoryJournal {
  readonly kind: "combined-save" | "history-only";
  readonly provisional: HistoryFile<MemoryHistoryObservation>;
  readonly promoted: HistoryFile<MemoryHistoryObservation>;
  readonly observedFiles: readonly HistoryFile<MemoryHistoryObservation>[];
  readonly removals: readonly HistoryFile<MemoryHistoryObservation>[];
  removedCount: number;
  rollback: boolean;
}

interface MemoryPendingCleanupJournal {
  readonly file: HistoryFile<MemoryHistoryObservation>;
}

interface MemoryHistoryReceipt {
  readonly kind: "combined-save" | "history-only";
  readonly file: HistoryFile<MemoryHistoryObservation>;
  readonly observedFiles: readonly HistoryFile<MemoryHistoryObservation>[];
  readonly removals: readonly HistoryFile<MemoryHistoryObservation>[];
}

interface MemoryRecoveryConflict {
  readonly paths: ArtifactPaths;
  readonly historyFolder: string | null;
  readonly reason: string;
  readonly journal: MemoryPairJournal;
  historyRolledBack: boolean;
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

export class MemoryTransactionRecoveryConflictError extends Error {
  readonly code = "transaction_recovery_conflict";

  constructor(readonly conflict: MemoryRecoveryConflict) {
    super(conflict.reason);
    this.name = "MemoryTransactionRecoveryConflictError";
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
    MemoryHistoryReceipt
  >();
  readonly recoveryConflicts = new Map<string, MemoryRecoveryConflict>();
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
    const activePairJournals = new Set(this.pairJournals.values());
    const quarantinedOnly = [...this.recoveryConflicts.values()].filter(
      ({ journal }) => !activePairJournals.has(journal)
    ).length;
    return (
      this.pairJournals.size +
      this.ownershipCleanupJournals.size +
      this.historyJournals.size +
      this.pendingCleanupJournals.size +
      quarantinedOnly
    );
  }
}

export class MemoryWorkbenchVault
  implements
    GalleyDocumentVault<
      MemoryPairObservation,
      MemoryPairOwnership,
      MemoryHistoryObservation
    >,
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
    await this.#recoverPairScope(paths);
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
    await this.#recoverTextScope(path);
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
    await this.#recoverPairScope(paths);
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

  async replacePairWithHistoryTransactional(
    paths: ArtifactPaths,
    expected: MemoryPairObservation,
    next: { html: string; sidecarJson: string },
    historyPlan: HistoryCommitPlan<MemoryHistoryObservation>,
    signal?: AbortSignal
  ): Promise<VaultReplacePairWithHistoryResult<MemoryPairObservation>> {
    this.replaceCalls += 1;
    throwIfAborted(signal);
    await this.#recoverPairScope(paths);
    await this.hooks.beforeReplace?.();
    throwIfAborted(signal);

    const folder = folderOf(historyPlan.finalPath);
    return this.backing.serialize(`history:${folder}`, async () => {
      const currentHtml = this.backing.files.get(paths.html);
      const currentSidecar = this.backing.files.get(paths.sidecar);
      if (currentHtml !== expected.html || currentSidecar !== expected.sidecar) {
        return { status: "conflict" };
      }
      if (!this.#historyPlanStillObserved(historyPlan, folder)) {
        return { status: "history-conflict" };
      }
      if (this.hooks.failReplace) {
        throw new Error("injected atomic pair replacement failure");
      }

      const html = makeEntry(next.html);
      const sidecar = makeEntry(next.sidecarJson);
      const promotedEntry = makeEntry(historyPlan.provisional.html);
      const history: MemoryHistoryJournal = {
        kind: "combined-save",
        provisional: historyPlan.provisional,
        promoted: {
          path: historyPlan.finalPath,
          html: historyPlan.provisional.html,
          observation: { entry: promotedEntry }
        },
        observedFiles: historyPlan.observedFiles,
        removals: historyPlan.removals,
        removedCount: 0,
        rollback: false
      };
      const journal: MemoryPairJournal = {
        mode: "replace",
        paths,
        oldHtml: currentHtml,
        oldSidecar: currentSidecar,
        newHtml: html,
        newSidecar: sidecar,
        history,
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
        this.#operationStage("history_before_promotion", signal);
        await this.#applyHistoryMutation(history, signal);
      } catch (error) {
        if (!(error instanceof MemoryCrashError)) {
          try {
            await this.#recoverPairJournal(journal);
          } catch {
            // A later scoped adapter entry retries or surfaces quarantine.
          }
        }
        throw error;
      }

      this.backing.pairJournals.delete(paths.html);
      await this.hooks.afterReplaceCommitted?.();
      return { status: "committed", observation: { html, sidecar } };
    });
  }

  async reconcilePairWithHistoryTransaction(
    paths: ArtifactPaths,
    expected: MemoryPairObservation,
    next: { html: string; sidecarJson: string },
    historyPlan: HistoryCommitPlan<MemoryHistoryObservation>
  ): Promise<VaultReconcilePairWithHistoryResult<MemoryPairObservation>> {
    this.#assertLive();
    try {
      await this.#recoverPairScope(paths);
    } catch (error) {
      if (error instanceof MemoryTransactionRecoveryConflictError) {
        return { status: "unknown" };
      }
      throw error;
    }

    const currentHtml = this.backing.files.get(paths.html);
    const currentSidecar = this.backing.files.get(paths.sidecar);
    const receipt = this.backing.historyReceipts.get(
      historyPlan.provisional.observation.entry
    );
    if (receipt) {
      if (
        !this.#historyReceiptMatchesPlan(receipt, historyPlan) ||
        !currentHtml ||
        !currentSidecar ||
        currentHtml.contents !== next.html ||
        currentSidecar.contents !== next.sidecarJson
      ) {
        return { status: "unknown" };
      }
      return {
        status: "committed",
        observation: { html: currentHtml, sidecar: currentSidecar }
      };
    }
    if (currentHtml === expected.html && currentSidecar === expected.sidecar) {
      return { status: "precommit" };
    }
    return { status: "conflict" };
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
    await this.#recoverPairScope(paths);
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
    await this.#recoverHistoryFolder(path);
    this.backing.folders.add(path);
  }

  async listFiles(
    folder: string,
    signal?: AbortSignal
  ): Promise<readonly HistoryFile<MemoryHistoryObservation>[]> {
    throwIfAborted(signal);
    await this.#recoverHistoryFolder(folder);
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
    await this.#recoverHistoryFolder(folderOf(path));
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
    const folder = folderOf(finalPath);
    await this.#recoverHistoryFolder(folder);
    const receipt = this.backing.historyReceipts.get(
      provisional.observation.entry
    );
    if (receipt) return { status: "created", file: receipt.file };

    return this.backing.serialize(`history:${folder}`, async () => {
      const repeated = this.backing.historyReceipts.get(
        provisional.observation.entry
      );
      if (repeated) return { status: "created", file: repeated.file };
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
        kind: "history-only",
        provisional,
        promoted,
        observedFiles,
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

        this.#recordHistoryReceipt(journal);
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

  async acknowledgeRetention(
    provisional: HistoryFile<MemoryHistoryObservation>
  ): Promise<void> {
    this.backing.historyReceipts.delete(provisional.observation.entry);
  }

  async acceptCurrentPairAndAbandonQuarantinedTransaction(
    paths: ArtifactPaths,
    accepted: { html: string; sidecarJson: string }
  ): Promise<void> {
    this.#assertLive();
    const conflict = this.backing.recoveryConflicts.get(paths.html);
    if (!conflict || conflict.paths.sidecar !== paths.sidecar) {
      throw new Error("No quarantined Galley transaction exists for this pair.");
    }
    GalleyDocumentCodec.parse(accepted.html);
    const acceptedSidecar = GalleySidecarV1Schema.parse(
      JSON.parse(accepted.sidecarJson) as unknown
    );
    if (acceptedSidecar.htmlHash !== (await sha256Text(accepted.html))) {
      throw new Error(
        "The accepted Galley sidecar does not match the exact accepted HTML."
      );
    }

    const journal = conflict.journal;
    // Hashing is asynchronous. Re-observe the exact bytes immediately before
    // the synchronous history cleanup and quarantine removal below.
    const currentHtml = this.backing.files.get(paths.html);
    const currentSidecar = this.backing.files.get(paths.sidecar);
    if (
      !currentHtml ||
      !currentSidecar ||
      currentHtml.contents !== accepted.html ||
      currentSidecar.contents !== accepted.sidecarJson
    ) {
      throw new MemoryTransactionRecoveryConflictError(conflict);
    }
    if (
      journal.history &&
      !conflict.historyRolledBack &&
      !this.#rollbackCombinedHistoryForQuarantine(journal.history)
    ) {
      throw new MemoryTransactionRecoveryConflictError(conflict);
    }
    if (journal.history) {
      conflict.historyRolledBack = true;
      const pending = this.backing.files.get(journal.history.provisional.path);
      if (
        pending !== undefined &&
        pending !== journal.history.provisional.observation.entry
      ) {
        throw new MemoryTransactionRecoveryConflictError(conflict);
      }
      if (pending === journal.history.provisional.observation.entry) {
        this.backing.files.delete(journal.history.provisional.path);
      }
    }
    if (this.backing.pairJournals.get(paths.html) === journal) {
      this.backing.pairJournals.delete(paths.html);
    }
    this.backing.recoveryConflicts.delete(paths.html);
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

  #historyPlanStillObserved(
    plan: HistoryCommitPlan<MemoryHistoryObservation>,
    folder: string
  ): boolean {
    if (
      this.backing.files.get(plan.provisional.path) !==
        plan.provisional.observation.entry ||
      this.backing.files.has(plan.finalPath)
    ) {
      return false;
    }
    const prefix = `${folder}/`;
    const currentFiles = [...this.backing.files].filter(([path]) =>
      path.startsWith(prefix)
    );
    return (
      currentFiles.length === plan.observedFiles.length &&
      plan.observedFiles.every(
        (file) =>
          this.backing.files.get(file.path) === file.observation.entry
      ) &&
      plan.removals.every(
        (file) =>
          this.backing.files.get(file.path) === file.observation.entry
      )
    );
  }

  async #applyHistoryMutation(
    journal: MemoryHistoryJournal,
    signal?: AbortSignal
  ): Promise<void> {
    const promotedEntry = journal.promoted.observation.entry;
    this.backing.files.set(journal.promoted.path, promotedEntry);
    if (
      this.backing.files.get(journal.provisional.path) ===
      journal.provisional.observation.entry
    ) {
      this.backing.files.delete(journal.provisional.path);
    }
    this.#operationStage("history_after_promotion", signal);
    for (const file of journal.removals) {
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
        throw new Error("History save transaction lost removal ownership.");
      }
      this.backing.files.delete(file.path);
      journal.removedCount += 1;
      this.#operationStage("history_after_remove", signal);
    }
    this.#recordHistoryReceipt(journal);
    this.#compactHistoryReceipts(folderOf(journal.promoted.path));
  }

  #compactHistoryReceipts(folder: string): void {
    const prefix = `${folder}/`;
    for (const [key, receipt] of this.backing.historyReceipts) {
      const file = receipt.file;
      if (
        file.path.startsWith(prefix) &&
        this.backing.files.get(file.path) !== file.observation.entry
      ) {
        this.backing.historyReceipts.delete(key);
      }
    }
  }

  #recordHistoryReceipt(journal: MemoryHistoryJournal): void {
    this.backing.historyReceipts.set(journal.provisional.observation.entry, {
      kind: journal.kind,
      file: journal.promoted,
      observedFiles: journal.observedFiles,
      removals: journal.removals
    });
  }

  #historyReceiptMatchesPlan(
    receipt: MemoryHistoryReceipt,
    plan: HistoryCommitPlan<MemoryHistoryObservation>
  ): boolean {
    return (
      receipt.kind === "combined-save" &&
      receipt.file.path === plan.finalPath &&
      receipt.file.html === plan.provisional.html &&
      this.backing.files.get(receipt.file.path) ===
        receipt.file.observation.entry &&
      sameHistoryFiles(receipt.observedFiles, plan.observedFiles) &&
      sameHistoryFiles(receipt.removals, plan.removals)
    );
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new Error("Memory workbench adapter instance was destroyed.");
    }
  }

  async #recoverPairScope(paths: ArtifactPaths): Promise<void> {
    this.#assertLive();
    const conflict = this.backing.recoveryConflicts.get(paths.html);
    if (conflict) throw new MemoryTransactionRecoveryConflictError(conflict);
    const journal = this.backing.pairJournals.get(paths.html);
    if (journal) await this.#recoverPairJournal(journal);
    const cleanup = this.backing.ownershipCleanupJournals.get(paths.html);
    if (cleanup) this.#recoverOwnershipCleanup(cleanup);
    const recoveredConflict = this.backing.recoveryConflicts.get(paths.html);
    if (recoveredConflict) {
      throw new MemoryTransactionRecoveryConflictError(recoveredConflict);
    }
  }

  async #recoverTextScope(path: string): Promise<void> {
    this.#assertLive();
    const conflict = [...this.backing.recoveryConflicts.values()].find(
      ({ paths }) => paths.html === path || paths.sidecar === path
    );
    if (conflict) throw new MemoryTransactionRecoveryConflictError(conflict);
    const journal = [...this.backing.pairJournals.values()].find(
      ({ paths }) => paths.html === path || paths.sidecar === path
    );
    if (journal) await this.#recoverPairJournal(journal);
    const cleanup = [...this.backing.ownershipCleanupJournals.values()].find(
      ({ ownership }) => {
        const paths = ownership[0].paths;
        return paths.html === path || paths.sidecar === path;
      }
    );
    if (cleanup) this.#recoverOwnershipCleanup(cleanup);
  }

  async #recoverHistoryFolder(folder: string): Promise<void> {
    this.#assertLive();
    const conflict = [...this.backing.recoveryConflicts.values()].find(
      ({ historyFolder }) => historyFolder === folder
    );
    if (conflict) throw new MemoryTransactionRecoveryConflictError(conflict);

    const pairJournals = [...this.backing.pairJournals.values()].filter(
      ({ history }) =>
        history !== undefined && folderOf(history.promoted.path) === folder
    );
    for (const journal of pairJournals) await this.#recoverPairJournal(journal);

    for (const journal of [...this.backing.historyJournals.values()]) {
      if (folderOf(journal.promoted.path) !== folder) continue;
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
    for (const journal of [...this.backing.pendingCleanupJournals.values()]) {
      if (folderOf(journal.file.path) !== folder) continue;
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
    this.#compactHistoryReceipts(folder);
    const recoveredConflict = [...this.backing.recoveryConflicts.values()].find(
      ({ historyFolder }) => historyFolder === folder
    );
    if (recoveredConflict) {
      throw new MemoryTransactionRecoveryConflictError(recoveredConflict);
    }
  }

  #recoverOwnershipCleanup(journal: MemoryOwnershipCleanupJournal): void {
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

  async #recoverPairJournal(journal: MemoryPairJournal): Promise<void> {
    if (journal.mode === "create") {
      const currentHtml = this.backing.files.get(journal.paths.html) ?? null;
      const currentSidecar =
        this.backing.files.get(journal.paths.sidecar) ?? null;
      this.#operationStage("create_cleanup_html");
      this.#operationStage("create_cleanup_sidecar");
      if (currentHtml === journal.newHtml) {
        this.backing.files.delete(journal.paths.html);
      }
      if (currentSidecar === journal.newSidecar) {
        this.backing.files.delete(journal.paths.sidecar);
      }
      this.backing.pairJournals.delete(journal.paths.html);
      return;
    }

    const reason = this.#pairRecoveryConflictReason(journal);
    if (reason) {
      const historyRolledBack = journal.history
        ? this.#rollbackCombinedHistoryForQuarantine(journal.history)
        : true;
      const conflict: MemoryRecoveryConflict = {
        paths: journal.paths,
        historyFolder: journal.history
          ? folderOf(journal.history.promoted.path)
          : null,
        reason,
        journal,
        historyRolledBack
      };
      this.backing.recoveryConflicts.set(journal.paths.html, conflict);
      throw new MemoryTransactionRecoveryConflictError(conflict);
    }

    const rollForward =
      journal.mode === "replace" && journal.phase === "committed";
    this.#operationStage(
      journal.mode === "replace"
        ? "replace_rollback_html"
        : "create_cleanup_html"
    );
    this.#operationStage(
      journal.mode === "replace"
        ? "replace_rollback_sidecar"
        : "create_cleanup_sidecar"
    );

    this.#setEntry(
      journal.paths.html,
      rollForward ? journal.newHtml : journal.oldHtml
    );
    this.#setEntry(
      journal.paths.sidecar,
      rollForward ? journal.newSidecar : journal.oldSidecar
    );

    if (journal.history) {
      if (rollForward) {
        this.#rollForwardHistoryJournal(journal.history);
      } else if (
        this.backing.files.get(journal.history.provisional.path) ===
        journal.history.provisional.observation.entry
      ) {
        this.backing.files.delete(journal.history.provisional.path);
      }
    }
    this.backing.pairJournals.delete(journal.paths.html);
  }

  #pairRecoveryConflictReason(journal: MemoryPairJournal): string | null {
    const html = this.backing.files.get(journal.paths.html) ?? null;
    const sidecar = this.backing.files.get(journal.paths.sidecar) ?? null;
    if (!isOwnedPairMember(html, journal.oldHtml, journal.newHtml)) {
      return "Document transaction recovery lost HTML member ownership.";
    }
    if (!isOwnedPairMember(sidecar, journal.oldSidecar, journal.newSidecar)) {
      return "Document transaction recovery lost sidecar member ownership.";
    }
    const history = journal.history;
    if (!history) return null;
    const provisional = this.backing.files.get(history.provisional.path) ?? null;
    const promoted = this.backing.files.get(history.promoted.path) ?? null;
    if (
      provisional !== null &&
      provisional !== history.provisional.observation.entry
    ) {
      return "Document transaction recovery lost provisional-history ownership.";
    }
    if (promoted !== null && promoted !== history.promoted.observation.entry) {
      return "Document transaction recovery lost promoted-history ownership.";
    }
    for (const removal of history.removals) {
      const current = this.backing.files.get(removal.path) ?? null;
      const mayAlreadyBeRemoved = journal.phase === "committed";
      if (
        current !== removal.observation.entry &&
        !(mayAlreadyBeRemoved && current === null)
      ) {
        return "Document transaction recovery lost retained-history ownership.";
      }
    }
    return null;
  }

  #setEntry(path: string, entry: MemoryEntry | null): void {
    if (entry) this.backing.files.set(path, entry);
    else this.backing.files.delete(path);
  }

  #rollbackCombinedHistoryForQuarantine(
    journal: MemoryHistoryJournal
  ): boolean {
    if (this.backing.historyReceipts.has(journal.provisional.observation.entry)) {
      return false;
    }
    const promoted = this.backing.files.get(journal.promoted.path) ?? null;
    const provisional =
      this.backing.files.get(journal.provisional.path) ?? null;
    if (
      (promoted !== null && promoted !== journal.promoted.observation.entry) ||
      (provisional !== null &&
        provisional !== journal.provisional.observation.entry)
    ) {
      return false;
    }
    for (const file of journal.removals.slice(0, journal.removedCount)) {
      const current = this.backing.files.get(file.path) ?? null;
      if (current !== null && current !== file.observation.entry) return false;
    }

    if (promoted === journal.promoted.observation.entry) {
      this.backing.files.delete(journal.promoted.path);
    }
    for (const file of journal.removals.slice(0, journal.removedCount)) {
      if (!this.backing.files.has(file.path)) {
        this.backing.files.set(file.path, file.observation.entry);
      }
    }
    if (provisional === null) {
      this.backing.files.set(
        journal.provisional.path,
        journal.provisional.observation.entry
      );
    }
    journal.removedCount = 0;
    journal.rollback = true;
    return true;
  }

  #rollForwardHistoryJournal(journal: MemoryHistoryJournal): void {
    this.backing.files.set(
      journal.promoted.path,
      journal.promoted.observation.entry
    );
    if (
      this.backing.files.get(journal.provisional.path) ===
      journal.provisional.observation.entry
    ) {
      this.backing.files.delete(journal.provisional.path);
    }
    for (const file of journal.removals) {
      if (this.backing.files.get(file.path) === file.observation.entry) {
        this.backing.files.delete(file.path);
      }
    }
    this.#recordHistoryReceipt(journal);
    this.#compactHistoryReceipts(folderOf(journal.promoted.path));
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
    this.#recordHistoryReceipt(journal);
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
    MemoryPairOwnership,
    MemoryHistoryObservation
  >;
  vault: MemoryWorkbenchVault;
  backing: MemoryWorkbenchBacking;
  repository: GalleyDocumentRepository<
    MemoryPairObservation,
    MemoryPairOwnership,
    MemoryHistoryObservation
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

function folderOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function isOwnedPairMember(
  current: MemoryEntry | null,
  oldEntry: MemoryEntry | null,
  newEntry: MemoryEntry
): boolean {
  return current === oldEntry || current === newEntry;
}

function sameHistoryFiles(
  left: readonly HistoryFile<MemoryHistoryObservation>[],
  right: readonly HistoryFile<MemoryHistoryObservation>[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) =>
        file.path === right[index]?.path &&
        file.observation.entry === right[index]?.observation.entry
    )
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
