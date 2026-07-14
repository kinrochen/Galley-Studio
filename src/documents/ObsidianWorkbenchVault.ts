import type { Vault } from "obsidian";

import type {
  ArtifactPaths,
  GalleyDocumentVault,
  VaultCreatePairResult,
  VaultPairSnapshot,
  VaultReconcilePairWithHistoryResult,
  VaultReplacePairResult,
  VaultReplacePairWithHistoryResult
} from "./GalleyDocumentRepository";
import {
  GalleySidecarV1Schema,
  sha256Text
} from "./GalleySidecar";
import type {
  HistoryCommitPlan,
  HistoryFile,
  HistoryRetentionResult,
  HistoryVault
} from "./HistoryRepository";
import {
  ObsidianTransactionStore,
  TRANSACTION_ROOT,
  TransactionRecordInvalidError,
  TransactionRecordUnstableError,
  TransactionReceiptInvalidError,
  TransactionWriteConflictError,
  type TransactionBlobRole,
  type TransactionRecord,
  type TransactionReceiptPlan,
  type TransactionScope
} from "./ObsidianTransactionStore";
import {
  ObsidianVaultFileStore,
  canonicalVaultPath,
  type VaultFileObservation,
  type VaultOwnedFile
} from "./ObsidianVaultFileStore";

export interface ObsidianFileEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface ObsidianPairObservation {
  readonly html: ObsidianFileEvidence;
  readonly sidecar: ObsidianFileEvidence;
}

export interface ObsidianPairOwnership extends ObsidianFileEvidence {
  readonly member: "html" | "sidecar";
}

export interface ObsidianHistoryObservation extends ObsidianFileEvidence {}

export type ObsidianWorkbenchCrashPoint =
  | "after-intent"
  | "after-applying"
  | "after-html"
  | "after-sidecar"
  | "after-history-promote"
  | "after-history-removal"
  | "after-commit"
  | "after-receipt"
  | "after-completed"
  | "after-recovery-wal-cleanup"
  | "after-recovery-lock-cleanup"
  | "after-recovery-index-cleanup";

export interface ObsidianWorkbenchCrashContext {
  readonly transactionId: string;
  readonly removalIndex?: number;
}

export interface ObsidianWorkbenchVaultOptions {
  readonly randomUUID?: () => string;
  readonly now?: () => Date;
  readonly crashAt?: ReadonlySet<ObsidianWorkbenchCrashPoint>;
  readonly onCrashPoint?: (
    point: ObsidianWorkbenchCrashPoint,
    context: ObsidianWorkbenchCrashContext
  ) => void | Promise<void>;
}

export class ObsidianWorkbenchSimulatedCrashError extends Error {
  readonly code = "workbench_simulated_crash";

  constructor(readonly point: ObsidianWorkbenchCrashPoint) {
    super(`Simulated Galley workbench crash at ${point}.`);
    this.name = "ObsidianWorkbenchSimulatedCrashError";
  }
}

export class ObsidianWorkbenchHandleUntrustedError extends Error {
  readonly code = "workbench_handle_untrusted";

  constructor() {
    super("Galley workbench handle belongs to another adapter or operation.");
    this.name = "ObsidianWorkbenchHandleUntrustedError";
  }
}

export class ObsidianWorkbenchRecoveryConflictError extends Error {
  readonly code = "transaction_recovery_conflict";

  constructor(readonly transactionId: string) {
    super("Galley workbench recovery is quarantined for this exact scope.");
    this.name = "ObsidianWorkbenchRecoveryConflictError";
  }
}

export class ObsidianWorkbenchAmbiguousError extends Error {
  readonly code = "workbench_mutation_ambiguous";

  constructor(
    readonly transactionId: string,
    readonly operationError?: unknown
  ) {
    super("Galley could not prove the workbench transaction outcome.");
    this.name = "ObsidianWorkbenchAmbiguousError";
  }
}

interface PairObservationData {
  readonly paths: ArtifactPaths;
  readonly html: VaultFileObservation;
  readonly sidecar: VaultFileObservation;
}

interface OwnershipData {
  readonly paths: ArtifactPaths;
  readonly member: "html" | "sidecar";
  readonly file: VaultFileObservation;
}

interface HistoryObservationData {
  readonly file: VaultFileObservation;
  readonly folder: string;
  readonly documentId: string;
  readonly preparationId?: string;
  retentionId?: string;
}

interface ExactHistoryFile {
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
  readonly byteLength: number;
}

interface HistoryPlanData {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly provisional: ExactHistoryFile;
  readonly finalPath: string;
  readonly observed: readonly ExactHistoryFile[];
  readonly removals: readonly ExactHistoryFile[];
  readonly checksum: string;
}

type MetadataOperation =
  | "pair-replace"
  | "pair-create"
  | "pair-history"
  | "history-retention"
  | "history-pending"
  | "pair-cleanup";

interface MetadataData {
  readonly schemaVersion: 1;
  readonly operation: MetadataOperation;
  readonly checksum: string;
}

const HISTORY_ROOT = ".galley/history";
const HISTORY_NAME = /^([0-9]{16})-([0-9a-f-]{36})-([0-9]{8,})\.(html|pending)$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EMPTY_PAIR_SUFFIX = ".history-scope";
const SCOPE_INDEX_ROOT = `${TRANSACTION_ROOT}/scopes`;
const ACTIVE_TRANSACTIONS = new Map<string, Promise<void>>();
const ACTIVE_RELEASES = new Map<string, () => void>();
const DELETION_OWNERSHIP = new WeakMap<
  object,
  Map<string, Map<string, VaultFileObservation>>
>();
const RETENTION_CONTINUATIONS = new WeakMap<
  object,
  Map<string, VaultFileObservation>
>();

interface ScopeIndexData {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly scope: TransactionScope;
  readonly checksum: string;
}

export class ObsidianWorkbenchVault
  implements
    GalleyDocumentVault<
      ObsidianPairObservation,
      ObsidianPairOwnership,
      ObsidianHistoryObservation
    >,
    HistoryVault<ObsidianHistoryObservation>
{
  readonly #files: ObsidianVaultFileStore;
  readonly #transactions: ObsidianTransactionStore;
  readonly #options: ObsidianWorkbenchVaultOptions;
  readonly #pairHandles = new WeakMap<ObsidianPairObservation, PairObservationData>();
  readonly #ownershipHandles = new WeakMap<ObsidianPairOwnership, OwnershipData>();
  readonly #historyHandles = new WeakMap<ObsidianHistoryObservation, HistoryObservationData>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #deletionOwnership: Map<string, Map<string, VaultFileObservation>>;
  readonly #retentionContinuations: Map<string, VaultFileObservation>;

  constructor(vault: Vault, options: ObsidianWorkbenchVaultOptions = {}) {
    this.#files = new ObsidianVaultFileStore(vault);
    let ownership = DELETION_OWNERSHIP.get(this.#files.backingIdentity);
    if (!ownership) {
      ownership = new Map();
      DELETION_OWNERSHIP.set(this.#files.backingIdentity, ownership);
    }
    this.#deletionOwnership = ownership;
    let continuations = RETENTION_CONTINUATIONS.get(this.#files.backingIdentity);
    if (!continuations) {
      continuations = new Map();
      RETENTION_CONTINUATIONS.set(this.#files.backingIdentity, continuations);
    }
    this.#retentionContinuations = continuations;
    this.#options = options;
    this.#transactions = new ObsidianTransactionStore(this.#files, {
      ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
      ...(options.now ? { now: options.now } : {})
    });
  }

  async readPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<VaultPairSnapshot<ObsidianPairObservation> | null> {
    const checked = validPairPaths(paths);
    return this.#serialize(pairQueueKey(checked), async () => {
      throwIfAborted(signal);
      await this.#recoverPairScope(checked, signal);
      const [html, sidecar] = await Promise.all([
        this.#files.readTextStable(checked.html, signal),
        this.#files.readTextStable(checked.sidecar, signal)
      ]);
      if (!html && !sidecar) return null;
      if (!html || !sidecar) {
        throw new ObsidianWorkbenchRecoveryConflictError("unowned-one-sided-pair");
      }
      const observation = this.#pairObservation(checked, html, sidecar);
      return {
        html: html.text,
        sidecarJson: sidecar.text,
        observation
      };
    });
  }

  async readText(path: string, signal?: AbortSignal): Promise<string | null> {
    const checked = canonicalVaultPath(path);
    const pair = pairPathsForMember(checked);
    if (pair) {
      return this.#serialize(pairQueueKey(pair), async () => {
        throwIfAborted(signal);
        await this.#recoverPairScope(pair, signal);
        return (await this.#files.readTextStable(checked, signal))?.text ?? null;
      });
    }
    try {
      const history = historyFolder(folderOf(checked));
      return this.#serialize(historyQueueKey(history.folder), async () => {
        throwIfAborted(signal);
        await this.#recoverHistoryScope(history.folder, signal);
        return (await this.#files.readTextStable(checked, signal))?.text ?? null;
      });
    } catch {
      throwIfAborted(signal);
      await this.#recoverPath(checked, signal);
      return (await this.#files.readTextStable(checked, signal))?.text ?? null;
    }
  }

  samePairObservation(
    left: ObsidianPairObservation,
    right: ObsidianPairObservation
  ): boolean {
    const leftData = this.#pairHandles.get(left);
    const rightData = this.#pairHandles.get(right);
    return (
      leftData !== undefined &&
      rightData !== undefined &&
      sameFile(leftData.html, rightData.html) &&
      sameFile(leftData.sidecar, rightData.sidecar)
    );
  }

  async replacePairTransactional(
    paths: ArtifactPaths,
    expected: ObsidianPairObservation,
    next: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<VaultReplacePairResult<ObsidianPairObservation>> {
    const checked = validPairPaths(paths);
    const expectedData = this.#trustedPair(expected, checked);
    return this.#serialize(pairQueueKey(checked), async () => {
      await this.#recoverPairScope(checked, signal);
      if (!(await this.#pairStillOwned(expectedData, signal))) {
        return { status: "conflict" };
      }
      const record = await this.#preparePair(
        "pair-replace",
        checked,
        expectedData,
        next,
        undefined,
        signal
      );
      try {
        await this.#crashPoint("after-intent", record);
        if (!(await this.#acquireLocks(record, ["pair"], signal))) {
          const cleanup = await this.#transactions.cleanup(record, signal, true);
          if (cleanup.status !== "cleaned") {
            throw new ObsidianWorkbenchAmbiguousError(record.id, cleanup);
          }
          await this.#removeScopeIndexes(record, signal);
          this.#forgetDeletionOwnership(record.id);
          this.#abandonActive(record.id);
          return { status: "conflict" };
        }
        let current = await this.#transactions.transition(record, "applying", signal);
        await this.#crashPoint("after-applying", current);
        const html = await this.#modifyExact(expectedData.html, next.html, current.id, signal);
        await this.#crashPoint("after-html", current);
        const sidecar = await this.#modifyExact(
          expectedData.sidecar,
          next.sidecarJson,
          current.id,
          signal
        );
        await this.#crashPoint("after-sidecar", current);
        current = await this.#transactions.transition(current, "committed", signal);
        await this.#crashPoint("after-commit", current);
        const receiptPlan = await this.#receiptPlan(checked, next, undefined);
        await this.#transactions.writeReceipt(current, receiptPlan, signal);
        await this.#crashPoint("after-receipt", current);
        current = await this.#transactions.transition(current, "completed", signal);
        await this.#crashPoint("after-completed", current);
        const cleanup = await this.#transactions.cleanup(current, signal);
        if (cleanup.status !== "cleaned") {
          throw new ObsidianWorkbenchAmbiguousError(current.id, cleanup);
        }
        await this.#releaseLocks(current, ["pair"], signal);
        await this.#removeScopeIndexes(current, signal);
        this.#forgetDeletionOwnership(current.id);
        this.#abandonActive(current.id);
        return {
          status: "committed",
          observation: this.#pairObservation(checked, html, sidecar)
        };
      } catch (error) {
        this.#abandonActive(record.id);
        if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
        throw new ObsidianWorkbenchAmbiguousError(record.id, error);
      }
    });
  }

  async createPairTransactional(
    paths: ArtifactPaths,
    contents: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<
    VaultCreatePairResult<ObsidianPairObservation, ObsidianPairOwnership>
  > {
    const checked = validPairPaths(paths);
    return this.#serialize(pairQueueKey(checked), async () => {
      await this.#recoverPairScope(checked, signal);
      const [oldHtml, oldSidecar] = await Promise.all([
        this.#files.readTextStable(checked.html, signal),
        this.#files.readTextStable(checked.sidecar, signal)
      ]);
      if (oldHtml || oldSidecar) return { status: "collision" };
      const record = await this.#preparePair(
        "pair-create",
        checked,
        null,
        contents,
        undefined,
        signal
      );
      try {
        await this.#crashPoint("after-intent", record);
        if (!(await this.#acquireLocks(record, ["pair"], signal))) {
          const cleanup = await this.#transactions.cleanup(record, signal, true);
          if (cleanup.status !== "cleaned") {
            throw new ObsidianWorkbenchAmbiguousError(record.id, cleanup);
          }
          await this.#removeScopeIndexes(record, signal);
          this.#forgetDeletionOwnership(record.id);
          this.#abandonActive(record.id);
          return { status: "collision" };
        }
        let current = await this.#transactions.transition(record, "applying", signal);
        await this.#crashPoint("after-applying", current);
        const html = await this.#createExact(checked.html, contents.html, current.id, signal);
        this.#rememberDeletion(current.id, "pair-create:html", html);
        await this.#crashPoint("after-html", current);
        const sidecar = await this.#createExact(
          checked.sidecar,
          contents.sidecarJson,
          current.id,
          signal
        );
        this.#rememberDeletion(current.id, "pair-create:sidecar", sidecar);
        await this.#crashPoint("after-sidecar", current);
        current = await this.#transactions.transition(current, "committed", signal);
        await this.#crashPoint("after-commit", current);
        await this.#transactions.writeReceipt(
          current,
          await this.#receiptPlan(checked, contents, undefined),
          signal
        );
        await this.#crashPoint("after-receipt", current);
        current = await this.#transactions.transition(current, "completed", signal);
        await this.#crashPoint("after-completed", current);
        const cleanup = await this.#transactions.cleanup(current, signal);
        if (cleanup.status !== "cleaned") {
          throw new ObsidianWorkbenchAmbiguousError(current.id, cleanup);
        }
        await this.#releaseLocks(current, ["pair"], signal);
        await this.#removeScopeIndexes(current, signal);
        this.#forgetDeletionOwnership(current.id);
        this.#abandonActive(current.id);
        const observation = this.#pairObservation(checked, html, sidecar);
        return {
          status: "created",
          observation,
          ownership: [
            this.#ownership(checked, "html", html),
            this.#ownership(checked, "sidecar", sidecar)
          ]
        };
      } catch (error) {
        this.#abandonActive(record.id);
        if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
        throw new ObsidianWorkbenchAmbiguousError(record.id, error);
      }
    });
  }

  async cleanupCreatedMembers(
    ownership: readonly [ObsidianPairOwnership, ObsidianPairOwnership]
  ): Promise<void> {
    const data = ownership.map((item) => this.#trustedOwnership(item));
    const paths = data[0]!.paths;
    if (
      data[1]!.paths.html !== paths.html ||
      data[1]!.paths.sidecar !== paths.sidecar ||
      new Set(data.map(({ member }) => member)).size !== 2
    ) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    await this.#serialize(pairQueueKey(paths), async () => {
      await this.#recoverPairScope(paths);
      for (const item of data) {
        const current = await this.#files.readTextStable(item.file.path);
        if (!sameFile(current, item.file)) {
          throw new ObsidianWorkbenchHandleUntrustedError();
        }
      }
      const scope = { pair: paths };
      const metadata = await signedMetadata("pair-cleanup");
      const record = await this.#transactions.prepare({
        kind: "owned-cleanup",
        scope,
        blobs: [
          { role: "pair-html-after", text: data.find(({ member }) => member === "html")!.file.text },
          { role: "pair-sidecar-after", text: data.find(({ member }) => member === "sidecar")!.file.text },
          { role: "metadata", text: serializeCanonical(metadata) }
        ]
      });
      await this.#createScopeIndexes(record);
      this.#beginActive(record.id);
      for (const item of data) {
        this.#rememberDeletion(record.id, `pair-cleanup:${item.member}`, item.file);
      }
      try {
        await this.#crashPoint("after-intent", record);
        if (!(await this.#acquireLocks(record, ["pair"]))) {
          const cleanup = await this.#transactions.cleanup(record, undefined, true);
          if (cleanup.status !== "cleaned") {
            throw new ObsidianWorkbenchAmbiguousError(record.id, cleanup);
          }
          await this.#removeScopeIndexes(record);
          this.#abandonActive(record.id);
          throw new ObsidianWorkbenchHandleUntrustedError();
        }
        let current = await this.#transactions.transition(record, "applying");
        await this.#crashPoint("after-applying", current);
        for (const item of data) {
          await this.#removeExact(item.file, current.id);
          await this.#crashPoint(
            item.member === "html" ? "after-html" : "after-sidecar",
            current
          );
        }
        current = await this.#transactions.transition(current, "committed");
        await this.#crashPoint("after-commit", current);
        current = await this.#transactions.transition(current, "completed");
        await this.#crashPoint("after-completed", current);
        const cleanup = await this.#transactions.cleanup(current);
        if (cleanup.status !== "cleaned") {
          throw new ObsidianWorkbenchAmbiguousError(current.id, cleanup);
        }
        await this.#releaseLocks(current, ["pair"]);
        await this.#removeScopeIndexes(current);
        this.#forgetDeletionOwnership(current.id);
        this.#abandonActive(current.id);
      } catch (error) {
        this.#abandonActive(record.id);
        if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
        throw error;
      }
    });
  }

  async ensureFolder(path: string, signal?: AbortSignal): Promise<void> {
    const { folder } = historyFolder(path);
    await this.#serialize(historyQueueKey(folder), async () => {
      await this.#recoverHistoryScope(folder, signal);
      await this.#files.ensureFolder(folder, signal);
    });
  }

  async listFiles(
    folder: string,
    signal?: AbortSignal
  ): Promise<readonly HistoryFile<ObsidianHistoryObservation>[]> {
    const checked = historyFolder(folder);
    return this.#serialize(historyQueueKey(checked.folder), async () => {
      await this.#recoverHistoryScope(checked.folder, signal);
      const activePending = await this.#activePending(checked.documentId, signal);
      const entries = await this.#files.list(checked.folder, signal);
      const files: HistoryFile<ObsidianHistoryObservation>[] = [];
      for (const entry of entries) {
        if (entry.kind !== "file") continue;
        const parsed = historyName(entry.name);
        if (!parsed) continue;
        const observed = await this.#files.readTextStable(entry.path, signal);
        if (!observed) continue;
        if (parsed.extension === "pending") {
          const preparationId = activePending.get(entry.path);
          if (!preparationId) continue;
          files.push(this.#historyFile(observed, checked, preparationId));
        } else {
          files.push(this.#historyFile(observed, checked));
        }
      }
      return files.sort((left, right) => compareText(left.path, right.path));
    });
  }

  async createFileExclusive(
    path: string,
    html: string,
    signal?: AbortSignal
  ): Promise<
    | { status: "created"; file: HistoryFile<ObsidianHistoryObservation> }
    | { status: "collision" }
  > {
    const checkedPath = canonicalVaultPath(path);
    const checked = historyPath(checkedPath, "pending");
    return this.#serialize(historyQueueKey(checked.folder), async () => {
      await this.#recoverHistoryScope(checked.folder, signal);
      if (await this.#files.readTextStable(checkedPath, signal)) {
        return { status: "collision" };
      }
      const metadata = await signedMetadata("history-pending");
      const record = await this.#transactions.prepare(
        {
          kind: "owned-cleanup",
          scope: historyScope(checked.documentId),
          blobs: [
            { role: "pair-html-after", text: html },
            { role: "metadata", text: serializeCanonical(metadata) },
            {
              role: "ownership-plan",
              text: await signedEnvelope({
                schemaVersion: 1,
                path: checkedPath,
                documentId: checked.documentId,
                sha256: await sha256Text(html),
                byteLength: byteLength(html)
              })
            }
          ]
        },
        signal
      );
      await this.#createScopeIndexes(record, signal);
      try {
        await this.#crashPoint("after-intent", record);
        let current = await this.#transactions.transition(record, "applying", signal);
        await this.#crashPoint("after-applying", current);
        const created = await this.#createExact(checkedPath, html, current.id, signal);
        this.#rememberDeletion(current.id, "history-pending", created);
        await this.#crashPoint("after-history-promote", current);
        current = await this.#transactions.transition(current, "committed", signal);
        await this.#crashPoint("after-commit", current);
        return {
          status: "created",
          file: this.#historyFile(created, checked, current.id)
        };
      } catch (error) {
        this.#abandonActive(record.id);
        if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
        throw new ObsidianWorkbenchAmbiguousError(record.id, error);
      }
    });
  }

  async applyRetentionTransaction(
    provisional: HistoryFile<ObsidianHistoryObservation>,
    finalPath: string,
    observedFiles: readonly HistoryFile<ObsidianHistoryObservation>[],
    removals: readonly HistoryFile<ObsidianHistoryObservation>[],
    signal?: AbortSignal
  ): Promise<HistoryRetentionResult<ObsidianHistoryObservation>> {
    const existingData = this.#trustedHistory(provisional);
    if (existingData.retentionId) {
      try {
        let record = await this.#transactions.open(existingData.retentionId, signal);
        let storedPlan = await parseHistoryPlan(blobText(record, "history-plan"));
        if (record.kind === "history-retention") {
          const requestedPlan = await this.#validatedHistoryPlan(
            provisional,
            finalPath,
            observedFiles,
            removals,
            false
          );
          if (canonicalJson(storedPlan) !== canonicalJson(requestedPlan)) {
            return { status: "lost" };
          }
        }
        await this.#recoverRecord(record, signal);
        record = await this.#transactions.open(existingData.retentionId, signal);
        storedPlan = await parseHistoryPlan(blobText(record, "history-plan"));
        await this.#transactions.verifyReceipt(
          record,
          await this.#receiptPlan(
            record.scope.pair,
            {
              html: blobText(record, "pair-html-after"),
              sidecarJson: blobText(record, "pair-sidecar-after")
            },
            storedPlan
          ),
          signal
        );
        const final = await this.#files.readTextStable(storedPlan.finalPath, signal);
        if (!sameContents(final, storedPlan.provisional)) {
          return { status: "lost" };
        }
        return {
          status: "created",
          file: this.#historyFile(final!, {
            folder: folderOf(storedPlan.finalPath),
            documentId: storedPlan.documentId
          })
        };
      } catch (error) {
        if (
          error instanceof TransactionRecordInvalidError ||
          error instanceof TransactionRecordUnstableError ||
          error instanceof TransactionReceiptInvalidError ||
          error instanceof TransactionWriteConflictError
        ) {
          return { status: "lost" };
        }
        throw error;
      }
    }
    const plan = await this.#validatedHistoryPlan(
      provisional,
      finalPath,
      observedFiles,
      removals,
      false
    );
    return this.#serialize(historyQueueKey(folderOf(finalPath)), async () => {
      await this.#recoverHistoryScope(folderOf(finalPath), signal);
      const fresh = await this.#historyHandlesCurrent(
        provisional,
        finalPath,
        observedFiles,
        signal
      );
      if (fresh === "lost") return { status: "lost" };
      if (fresh === "collision") return { status: "collision" };
      if (fresh === "conflict") return { status: "conflict" };
      const record = await this.#prepareHistoryOnly(plan, signal);
      this.#rememberHistoryDeletions(record.id, provisional, removals);
      try {
        await this.#crashPoint("after-intent", record);
        if (!(await this.#acquireLocks(record, ["history"], signal))) {
          const cleanup = await this.#transactions.cleanup(record, signal, true);
          if (cleanup.status !== "cleaned") {
            throw new ObsidianWorkbenchAmbiguousError(record.id, cleanup);
          }
          await this.#removeScopeIndexes(record, signal);
          this.#forgetDeletionOwnership(record.id);
          this.#abandonActive(record.id);
          return { status: "conflict" };
        }
        let current = await this.#transactions.transition(record, "applying", signal);
        await this.#crashPoint("after-applying", current);
        const promoted = await this.#applyHistoryForward(plan, current, signal);
        current = await this.#transactions.transition(current, "committed", signal);
        existingData.retentionId = current.id;
        await this.#crashPoint("after-commit", current);
        const receiptPlan = await this.#receiptPlan(
          current.scope.pair,
          {
            html: blobText(current, "pair-html-after"),
            sidecarJson: blobText(current, "pair-sidecar-after")
          },
          plan
        );
        await this.#transactions.writeReceipt(current, receiptPlan, signal);
        await this.#crashPoint("after-receipt", current);
        current = await this.#transactions.transition(current, "completed", signal);
        await this.#crashPoint("after-completed", current);
        return {
          status: "created",
          file: this.#historyFile(promoted, {
            folder: folderOf(finalPath),
            documentId: plan.documentId
          })
        };
      } catch (error) {
        this.#abandonActive(record.id);
        if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
        throw new ObsidianWorkbenchAmbiguousError(record.id, error);
      }
    });
  }

  async rollbackPrepared(
    file: HistoryFile<ObsidianHistoryObservation>
  ): Promise<boolean> {
    const data = this.#trustedHistory(file);
    if (!data.preparationId) throw new ObsidianWorkbenchHandleUntrustedError();
    return this.#serialize(historyQueueKey(data.folder), async () => {
      await this.#recoverHistoryScope(data.folder);
      let record: TransactionRecord;
      try {
        record = await this.#transactions.open(data.preparationId!);
      } catch {
        const current = await this.#files.readTextStable(data.file.path);
        return current === null;
      }
      const current = await this.#files.readTextStable(data.file.path);
      if (current && !sameFile(current, data.file)) return false;
      if (current) await this.#removeExact(current, record.id);
      if (record.phase === "committed") {
        record = await this.#transactions.transition(record, "completed");
      }
      const cleanup = await this.#transactions.cleanup(
        record,
        undefined,
        record.phase !== "completed"
      );
      if (cleanup.status === "cleaned") {
        await this.#removeScopeIndexes(record);
        this.#forgetDeletionOwnership(record.id);
      }
      return cleanup.status === "cleaned";
    });
  }

  async acknowledgeRetention(
    provisional: HistoryFile<ObsidianHistoryObservation>
  ): Promise<void> {
    const data = this.#trustedHistory(provisional);
    await this.#serialize(historyQueueKey(data.folder), async () => {
      const transactionIds = [data.retentionId, data.preparationId].filter(
        (id): id is string => id !== undefined
      );
      for (const id of transactionIds) this.#beginActive(id);
      try {
        for (const id of transactionIds) {
          try {
            if (await this.#transactionFolderEmpty(id)) continue;
            let record = await this.#transactions.open(id);
            if (record.phase === "committed") {
              record = await this.#transactions.transition(record, "completed");
            }
            const metadata = await parseMetadata(blobText(record, "metadata"));
            let cleanup:
              | { status: "cleaned"; directory: "retained" }
              | { status: "conflict" }
              | { status: "ambiguous" };
            if (record.phase === "completed") {
              cleanup = await this.#transactions.cleanup(record);
            } else {
              cleanup = await this.#transactions.cleanup(record, undefined, true);
            }
            if (cleanup.status === "cleaned") {
              await this.#releaseLocks(record, lockKinds(metadata.operation));
              await this.#removeScopeIndexes(record);
              this.#forgetDeletionOwnership(record.id);
              this.#forgetRetentionContinuation(record.id);
            }
          } catch {
            // Recovery retains exact durable proof for a later scoped entry.
          }
        }
      } finally {
        for (const id of transactionIds) this.#abandonActive(id);
      }
      await this.#recoverHistoryScope(data.folder);
    });
  }

  async replacePairWithHistoryTransactional(
    paths: ArtifactPaths,
    expected: ObsidianPairObservation,
    next: { html: string; sidecarJson: string },
    history: HistoryCommitPlan<ObsidianHistoryObservation>,
    signal?: AbortSignal
  ): Promise<VaultReplacePairWithHistoryResult<ObsidianPairObservation>> {
    const checked = validPairPaths(paths);
    const expectedData = this.#trustedPair(expected, checked);
    const plan = await this.#validatedHistoryPlan(
      history.provisional,
      history.finalPath,
      history.observedFiles,
      history.removals,
      false
    );
    return this.#serializeMany(
      [pairQueueKey(checked), historyQueueKey(folderOf(plan.finalPath))],
      async () => {
        await this.#recoverPairScope(checked, signal);
        await this.#recoverHistoryScope(folderOf(plan.finalPath), signal);
        if (!(await this.#pairStillOwned(expectedData, signal))) {
          return { status: "conflict" };
        }
        if (
          (await this.#historyHandlesCurrent(
            history.provisional,
            history.finalPath,
            history.observedFiles,
            signal
          )) !== "current"
        ) {
          return { status: "history-conflict" };
        }
        const record = await this.#preparePair(
          "pair-history",
          checked,
          expectedData,
          next,
          plan,
          signal
        );
        this.#rememberHistoryDeletions(record.id, history.provisional, history.removals);
        try {
          await this.#crashPoint("after-intent", record);
          if (!(await this.#acquireLocks(record, ["pair", "history"], signal))) {
            const cleanup = await this.#transactions.cleanup(record, signal, true);
            if (cleanup.status !== "cleaned") {
              throw new ObsidianWorkbenchAmbiguousError(record.id, cleanup);
            }
            await this.#removeScopeIndexes(record, signal);
            this.#forgetDeletionOwnership(record.id);
            this.#abandonActive(record.id);
            return { status: "history-conflict" };
          }
          let current = await this.#transactions.transition(record, "applying", signal);
          await this.#crashPoint("after-applying", current);
          const html = await this.#modifyExact(expectedData.html, next.html, current.id, signal);
          await this.#crashPoint("after-html", current);
          const sidecar = await this.#modifyExact(
            expectedData.sidecar,
            next.sidecarJson,
            current.id,
            signal
          );
          await this.#crashPoint("after-sidecar", current);
          await this.#applyHistoryForward(plan, current, signal);
          current = await this.#transactions.transition(current, "committed", signal);
          const continuation = this.#trustedHistory(history.provisional);
          continuation.retentionId = current.id;
          this.#rememberRetentionContinuation(current.id, continuation.file);
          await this.#crashPoint("after-commit", current);
          await this.#transactions.writeReceipt(
            current,
            await this.#receiptPlan(checked, next, plan),
            signal
          );
          await this.#crashPoint("after-receipt", current);
          current = await this.#transactions.transition(current, "completed", signal);
          await this.#crashPoint("after-completed", current);
          this.#abandonActive(current.id);
          return {
            status: "committed",
            observation: this.#pairObservation(checked, html, sidecar)
          };
        } catch (error) {
          this.#abandonActive(record.id);
          if (error instanceof ObsidianWorkbenchSimulatedCrashError) throw error;
          throw new ObsidianWorkbenchAmbiguousError(record.id, error);
        }
      }
    );
  }

  async reconcilePairWithHistoryTransaction(
    paths: ArtifactPaths,
    expected: ObsidianPairObservation,
    next: { html: string; sidecarJson: string },
    history: HistoryCommitPlan<ObsidianHistoryObservation>
  ): Promise<VaultReconcilePairWithHistoryResult<ObsidianPairObservation>> {
    const checked = validPairPaths(paths);
    const expectedData = this.#trustedPair(expected, checked);
    const plan = await this.#validatedHistoryPlan(
      history.provisional,
      history.finalPath,
      history.observedFiles,
      history.removals,
      false
    );
    try {
      await this.#recoverPairScope(checked);
      await this.#recoverHistoryScope(folderOf(plan.finalPath));
    } catch (error) {
      if (error instanceof ObsidianWorkbenchRecoveryConflictError) {
        return { status: "unknown" };
      }
      throw error;
    }
    const receiptPlan = await this.#receiptPlan(checked, next, plan);
    const records = await this.#recordsForPair(checked);
    for (const record of records) {
      if (record.kind !== "pair-history") continue;
      if (!(await recordMatches(record, next, plan))) continue;
      try {
        await this.#transactions.verifyReceipt(record, receiptPlan);
        const pair = await this.#readPairRaw(checked);
        if (
          pair &&
          pair.html.text === next.html &&
          pair.sidecar.text === next.sidecarJson &&
          (await this.#historyIsForward(plan))
        ) {
          const continuation = this.#trustedHistory(history.provisional);
          continuation.retentionId = record.id;
          this.#rememberRetentionContinuation(record.id, continuation.file);
          return {
            status: "committed",
            observation: this.#pairObservation(checked, pair.html, pair.sidecar)
          };
        }
        return { status: "unknown" };
      } catch (error) {
        if (
          error instanceof TransactionReceiptInvalidError ||
          error instanceof TransactionRecordInvalidError ||
          error instanceof TransactionRecordUnstableError ||
          error instanceof TransactionWriteConflictError
        ) {
          return { status: "unknown" };
        }
        throw error;
      }
    }
    const current = await this.#readPairRaw(checked);
    if (
      current &&
      sameFile(current.html, expectedData.html) &&
      sameFile(current.sidecar, expectedData.sidecar) &&
      (await this.#historyIsPrecommit(plan))
    ) {
      return { status: "precommit" };
    }
    if (current && !(await this.#pairBytes(current, next))) {
      return { status: "conflict" };
    }
    return { status: "unknown" };
  }

  async #preparePair(
    operation: "pair-replace" | "pair-create" | "pair-history",
    paths: ArtifactPaths,
    expected: PairObservationData | null,
    next: { html: string; sidecarJson: string },
    history: HistoryPlanData | undefined,
    signal?: AbortSignal
  ): Promise<TransactionRecord> {
    const metadata = await signedMetadata(operation);
    const blobs: { role: TransactionBlobRole; text: string }[] = [
      { role: "pair-html-after", text: next.html },
      { role: "pair-sidecar-after", text: next.sidecarJson },
      { role: "metadata", text: serializeCanonical(metadata) }
    ];
    if (expected) {
      blobs.push(
        { role: "pair-html-before", text: expected.html.text },
        { role: "pair-sidecar-before", text: expected.sidecar.text }
      );
    }
    if (history) {
      blobs.push({ role: "history-plan", text: serializeCanonical(history) });
    }
    const record = await this.#transactions.prepare(
      {
        kind: operation,
        scope: {
          pair: paths,
          ...(history ? { historyDocumentId: history.documentId } : {})
        },
        blobs
      },
      signal
    );
    await this.#createScopeIndexes(record, signal);
    this.#beginActive(record.id);
    return record;
  }

  async #prepareHistoryOnly(
    plan: HistoryPlanData,
    signal?: AbortSignal
  ): Promise<TransactionRecord> {
    const scope = historyScope(plan.documentId);
    const metadata = await signedMetadata("history-retention");
    const record = await this.#transactions.prepare(
      {
        kind: "history-retention",
        scope,
        blobs: [
          { role: "pair-html-after", text: "history-retention" },
          { role: "pair-sidecar-after", text: "history-retention" },
          { role: "history-plan", text: serializeCanonical(plan) },
          { role: "metadata", text: serializeCanonical(metadata) }
        ]
      },
      signal
    );
    await this.#createScopeIndexes(record, signal);
    this.#beginActive(record.id);
    return record;
  }

  async #createScopeIndexes(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    const text = await signedScopeIndex(record.id, record.scope);
    const created: VaultFileObservation[] = [];
    try {
      for (const folder of await scopeIndexFolders(record.scope)) {
        await this.#files.ensureFolder(folder, signal);
        const result = await this.#files.createExclusive(
          `${folder}/${record.id}.json`,
          text,
          signal
        );
        if (result.status !== "created") {
          throw new ObsidianWorkbenchAmbiguousError(record.id, result);
        }
        created.push(result.file);
      }
    } catch (error) {
      for (const file of created.reverse()) {
        await this.#files.removeOwned(file).catch(() => undefined);
      }
      throw error;
    }
  }

  async #removeScopeIndexes(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    await this.#removeScopeIndexesFor(record.scope, record.id, signal);
  }

  async #removeScopeIndexesFor(
    scope: TransactionScope,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<void> {
    for (const folder of (await scopeIndexFolders(scope)).reverse()) {
      const path = `${folder}/${transactionId}.json`;
      const current = await this.#files.readTextStable(path, signal);
      if (!current) continue;
      await parseScopeIndex(current.text, transactionId, scope);
      await this.#removeExact(current, transactionId, signal);
    }
  }

  async #indexedRecords(
    folder: string,
    expected: (scope: TransactionScope) => boolean,
    signal?: AbortSignal
  ): Promise<TransactionRecord[]> {
    const entries = await this.#files.list(folder, signal);
    const records: TransactionRecord[] = [];
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) {
        throw new ObsidianWorkbenchRecoveryConflictError("scope-index-invalid");
      }
      const id = entry.name.slice(0, -".json".length);
      const owned = await this.#files.readTextStable(entry.path, signal);
      if (!owned) continue;
      let index: ScopeIndexData;
      try {
        index = await parseScopeIndex(owned.text, id);
      } catch {
        throw new ObsidianWorkbenchRecoveryConflictError(id);
      }
      if (!expected(index.scope)) {
        throw new ObsidianWorkbenchRecoveryConflictError(id);
      }
      const active = ACTIVE_TRANSACTIONS.get(id);
      if (active) await active;
      const currentIndex = await this.#files.readTextStable(entry.path, signal);
      if (!currentIndex) continue;
      if (!sameExact(currentIndex, owned)) {
        throw new ObsidianWorkbenchRecoveryConflictError(id);
      }
      if (await this.#transactionFolderEmpty(id, signal)) {
        await this.#releaseScopeLocks(index.scope, id, signal);
        await this.#removeScopeIndexesFor(index.scope, id, signal);
        continue;
      }
      try {
        records.push(await this.#transactions.open(id, signal));
      } catch {
        if (await this.#transactionFolderEmpty(id, signal)) {
          const remaining = await this.#files.readTextStable(entry.path, signal);
          if (remaining && sameExact(remaining, owned)) {
            await this.#releaseScopeLocks(index.scope, id, signal);
            await this.#removeScopeIndexesFor(index.scope, id, signal);
          } else if (remaining) {
            throw new ObsidianWorkbenchRecoveryConflictError(id);
          }
          continue;
        }
        throw new ObsidianWorkbenchRecoveryConflictError(id);
      }
    }
    return records;
  }

  async #recoverPairScope(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<void> {
    for (const record of await this.#recordsForPair(paths, signal)) {
      await this.#recoverRecord(record, signal);
    }
  }

  async #recoverHistoryScope(
    folder: string,
    signal?: AbortSignal
  ): Promise<void> {
    const { documentId } = historyFolder(folder);
    const indexFolder = await historyIndexFolder(documentId);
    const indexed = await this.#indexedRecords(
      indexFolder,
      (scope) => scope.historyDocumentId === documentId,
      signal
    );
    const all = await this.#transactions.listAll(signal);
    const records = mergeRecords(
      indexed,
      all.filter(({ scope }) => scope.historyDocumentId === documentId)
    );
    for (const record of records) {
      await this.#recoverRecord(record, signal);
    }
  }

  async #recoverPath(path: string, signal?: AbortSignal): Promise<void> {
    for (const record of await this.#transactions.listAll(signal)) {
      if (
        record.scope.pair.html === path ||
        record.scope.pair.sidecar === path ||
        (record.scope.historyDocumentId !== undefined &&
          path.startsWith(`${HISTORY_ROOT}/${record.scope.historyDocumentId}/`))
      ) {
        await this.#recoverRecord(record, signal);
      }
    }
  }

  async #recordsForPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<TransactionRecord[]> {
    const indexed = await this.#indexedRecords(
      await pairIndexFolder(paths),
      (scope) =>
        scope.pair.html === paths.html && scope.pair.sidecar === paths.sidecar,
      signal
    );
    const all = (await this.#transactions.listAll(signal)).filter(
      ({ scope }) =>
        scope.pair.html === paths.html && scope.pair.sidecar === paths.sidecar
    );
    return mergeRecords(indexed, all);
  }

  async #recoverRecord(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    const initialMetadata = await parseMetadata(blobText(record, "metadata"));
    if (
      initialMetadata.operation === "history-pending" &&
      (record.phase === "committed" || record.phase === "completed")
    ) {
      return;
    }
    const active = ACTIVE_TRANSACTIONS.get(record.id);
    if (active) {
      await active;
      if (await this.#transactionFolderEmpty(record.id, signal)) return;
    }
    try {
      record = await this.#transactions.open(record.id, signal);
    } catch {
      const cleaning = ACTIVE_TRANSACTIONS.get(record.id);
      if (cleaning) await cleaning;
      if (await this.#transactionFolderEmpty(record.id, signal)) {
        await this.#releaseScopeLocks(record.scope, record.id, signal);
        await this.#removeScopeIndexes(record, signal);
        return;
      }
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    try {
      if (await this.#transactions.readTargetQuarantine(record, signal)) {
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
    } catch (error) {
      if (error instanceof ObsidianWorkbenchRecoveryConflictError) throw error;
      if (error instanceof TransactionRecordInvalidError) {
        if (await this.#transactionFolderEmpty(record.id, signal)) return;
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
      throw error;
    }
    const metadata = await parseMetadata(blobText(record, "metadata"));
    if (metadata.operation === "history-pending") {
      if (record.phase === "prepared" || record.phase === "applying") {
        await this.#recoverPendingPreparation(record, signal);
      }
      return;
    }
    if (metadata.operation === "pair-cleanup") {
      await this.#recoverPairCleanup(record, signal);
      return;
    }

    const history = hasBlob(record, "history-plan")
      ? await parseHistoryPlan(blobText(record, "history-plan"))
      : undefined;
    const pairPlan = pairPlanFromRecord(record);
    let rollForward = record.phase === "committed" || record.phase === "completed";
    if (
      !rollForward &&
      metadata.operation === "pair-create" &&
      record.phase === "applying"
    ) {
      const complete = await this.#readPairRaw(record.scope.pair);
      if (
        complete?.html.text === pairPlan.afterHtml &&
        complete.sidecar.text === pairPlan.afterSidecar
      ) {
        record = await this.#transactions.transition(record, "committed", signal);
        rollForward = true;
      }
    }
    const evidence = await this.#preflightRecovery(pairPlan, history, rollForward, signal);
    if (evidence) {
      await this.#transactions.quarantineTargetDrift(record, evidence, signal);
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }

    if (
      rollForward &&
      record.kind === "pair-history" &&
      !this.#hasRetentionContinuation(record.id)
    ) {
      if (metadata.operation !== "pair-history" || !history) {
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
      const forwardDrift = await this.#orphanCombinedForwardDrift(
        pairPlan,
        history,
        signal
      );
      if (forwardDrift) {
        await this.#transactions.quarantineTargetDrift(record, forwardDrift, signal);
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
      const receiptPlan = await this.#receiptPlan(
        record.scope.pair,
        { html: pairPlan.afterHtml, sidecarJson: pairPlan.afterSidecar },
        history
      );
      try {
        if (record.phase === "committed") {
          await this.#transactions.writeReceipt(record, receiptPlan, signal);
          record = await this.#transactions.transition(record, "completed", signal);
        }
        await this.#transactions.verifyReceipt(record, receiptPlan, signal);
      } catch (error) {
        if (
          error instanceof TransactionReceiptInvalidError ||
          error instanceof TransactionRecordInvalidError ||
          error instanceof TransactionRecordUnstableError ||
          error instanceof TransactionWriteConflictError
        ) {
          throw new ObsidianWorkbenchRecoveryConflictError(record.id);
        }
        throw error;
      }
      await this.#compactConsumedPending(history, signal);
      await this.#compactOrphanCombined(record, signal);
      return;
    }

    if (rollForward) {
      if (metadata.operation !== "history-retention") {
        await this.#recoverPairState(pairPlan, true, record, signal);
      }
      if (history) await this.#recoverHistoryState(history, true, record, signal);
      const receiptPlan = await this.#receiptPlan(
        record.scope.pair,
        { html: pairPlan.afterHtml, sidecarJson: pairPlan.afterSidecar },
        history
      );
      if (record.phase === "committed") {
        await this.#transactions.writeReceipt(record, receiptPlan, signal);
        record = await this.#transactions.transition(record, "completed", signal);
      } else {
        try {
          await this.#transactions.verifyReceipt(record, receiptPlan, signal);
        } catch (error) {
          if (error instanceof TransactionReceiptInvalidError) {
            if (await this.#transactionFolderEmpty(record.id, signal)) return;
            throw new ObsidianWorkbenchRecoveryConflictError(record.id);
          }
          throw error;
        }
      }
      if (
        (record.kind === "pair-history" &&
          this.#hasRetentionContinuation(record.id)) ||
        (record.kind === "history-retention" && this.#hasDeletionOwnership(record.id))
      ) {
        return;
      }
      const cleanup = await this.#transactions.cleanup(record, signal);
      if (cleanup.status !== "cleaned") {
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
      await this.#releaseLocks(record, lockKinds(metadata.operation), signal);
      await this.#removeScopeIndexes(record, signal);
      this.#forgetDeletionOwnership(record.id);
      return;
    }

    if (metadata.operation !== "history-retention") {
      await this.#recoverPairState(pairPlan, false, record, signal);
    }
    if (history) await this.#recoverHistoryState(history, false, record, signal);
    const cleanup = await this.#transactions.cleanup(record, signal, true);
    if (cleanup.status !== "cleaned") {
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    await this.#releaseLocks(record, lockKinds(metadata.operation), signal);
    await this.#removeScopeIndexes(record, signal);
    this.#forgetDeletionOwnership(record.id);
  }

  async #preflightRecovery(
    pair: ReturnType<typeof pairPlanFromRecord>,
    history: HistoryPlanData | undefined,
    rollForward: boolean,
    signal?: AbortSignal
  ): Promise<readonly {
    path: string;
    state: "absent" | "present" | "unreadable";
    sha256?: string;
    byteLength?: number;
  }[] | null> {
    const expected = new Map<string, readonly string[]>();
    expected.set(
      pair.paths.html,
      pair.beforeHtml === null
        ? [await sha256Text(pair.afterHtml)]
        : [await sha256Text(pair.beforeHtml), await sha256Text(pair.afterHtml)]
    );
    expected.set(
      pair.paths.sidecar,
      pair.beforeSidecar === null
        ? [await sha256Text(pair.afterSidecar)]
        : [await sha256Text(pair.beforeSidecar), await sha256Text(pair.afterSidecar)]
    );
    if (history) {
      expected.set(history.provisional.path, [history.provisional.sha256]);
      expected.set(history.finalPath, [history.provisional.sha256]);
      for (const item of history.removals) expected.set(item.path, [item.sha256]);
    }
    const bad: {
      path: string;
      state: "absent" | "present" | "unreadable";
      sha256?: string;
      byteLength?: number;
    }[] = [];
    for (const [path, hashes] of [...expected].sort(([left], [right]) => compareText(left, right))) {
      let current: VaultFileObservation | null;
      try {
        current = await this.#files.readTextStable(path, signal);
      } catch {
        bad.push({ path, state: "unreadable" });
        continue;
      }
      const absenceAllowed =
        (path === pair.paths.html && pair.beforeHtml === null) ||
        (path === pair.paths.sidecar && pair.beforeSidecar === null) ||
        history !== undefined;
      if (!current) {
        if (!absenceAllowed) bad.push({ path, state: "absent" });
        continue;
      }
      if (!hashes.includes(current.sha256)) {
        bad.push({
          path,
          state: "present",
          sha256: current.sha256,
          byteLength: current.byteLength
        });
      }
    }
    void rollForward;
    return bad.length > 0 ? bad : null;
  }

  async #orphanCombinedForwardDrift(
    pair: ReturnType<typeof pairPlanFromRecord>,
    history: HistoryPlanData,
    signal?: AbortSignal
  ): Promise<readonly {
    path: string;
    state: "absent" | "present" | "unreadable";
    sha256?: string;
    byteLength?: number;
  }[] | null> {
    const required = new Map<
      string,
      { text: string; sha256: string; byteLength: number }
    >([
      [
        pair.paths.html,
        {
          text: pair.afterHtml,
          sha256: await sha256Text(pair.afterHtml),
          byteLength: byteLength(pair.afterHtml)
        }
      ],
      [
        pair.paths.sidecar,
        {
          text: pair.afterSidecar,
          sha256: await sha256Text(pair.afterSidecar),
          byteLength: byteLength(pair.afterSidecar)
        }
      ],
      [
        history.finalPath,
        {
          text: history.provisional.text,
          sha256: history.provisional.sha256,
          byteLength: history.provisional.byteLength
        }
      ]
    ]);
    const removed = new Set(history.removals.map(({ path }) => path));
    for (const item of history.observed) {
      if (item.path === history.provisional.path || removed.has(item.path)) continue;
      required.set(item.path, {
        text: item.text,
        sha256: item.sha256,
        byteLength: item.byteLength
      });
    }
    const absent = new Set([
      history.provisional.path,
      ...history.removals.map(({ path }) => path)
    ]);
    const bad: {
      path: string;
      state: "absent" | "present" | "unreadable";
      sha256?: string;
      byteLength?: number;
    }[] = [];
    for (const [path, expected] of [...required].sort(([left], [right]) =>
      compareText(left, right)
    )) {
      let current: VaultFileObservation | null;
      try {
        current = await this.#files.readTextStable(path, signal);
      } catch {
        bad.push({ path, state: "unreadable" });
        continue;
      }
      if (!current) {
        bad.push({ path, state: "absent" });
        continue;
      }
      if (
        current.text !== expected.text ||
        current.sha256 !== expected.sha256 ||
        current.byteLength !== expected.byteLength
      ) {
        bad.push({
          path,
          state: "present",
          sha256: current.sha256,
          byteLength: current.byteLength
        });
      }
    }
    for (const path of [...absent].sort(compareText)) {
      let current: VaultFileObservation | null;
      try {
        current = await this.#files.readTextStable(path, signal);
      } catch {
        bad.push({ path, state: "unreadable" });
        continue;
      }
      if (current) {
        bad.push({
          path,
          state: "present",
          sha256: current.sha256,
          byteLength: current.byteLength
        });
      }
    }
    return bad.length > 0 ? bad : null;
  }

  async #compactOrphanCombined(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    const cleanup = await this.#transactions.cleanup(record, signal);
    if (cleanup.status !== "cleaned") {
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    await this.#crashPoint("after-recovery-wal-cleanup", record);
    await this.#releaseLocks(record, ["pair", "history"], signal);
    await this.#crashPoint("after-recovery-lock-cleanup", record);
    await this.#removeScopeIndexes(record, signal);
    await this.#crashPoint("after-recovery-index-cleanup", record);
    this.#forgetDeletionOwnership(record.id);
    this.#forgetRetentionContinuation(record.id);
  }

  async #compactConsumedPending(
    history: HistoryPlanData,
    signal?: AbortSignal
  ): Promise<void> {
    if (await this.#files.readTextStable(history.provisional.path, signal)) {
      throw new ObsidianWorkbenchRecoveryConflictError("combined-pending-present");
    }
    const matches: TransactionRecord[] = [];
    for (const candidate of await this.#transactions.listAll(signal)) {
      if (
        candidate.kind !== "owned-cleanup" ||
        candidate.scope.historyDocumentId !== history.documentId
      ) {
        continue;
      }
      const metadata = await parseMetadata(blobText(candidate, "metadata"));
      if (metadata.operation !== "history-pending") continue;
      const plan = await parseOwnershipPlan(blobText(candidate, "ownership-plan"));
      if (plan.path !== history.provisional.path) continue;
      if (
        plan.sha256 !== history.provisional.sha256 ||
        plan.byteLength !== history.provisional.byteLength ||
        (candidate.phase !== "committed" && candidate.phase !== "completed")
      ) {
        throw new ObsidianWorkbenchRecoveryConflictError(candidate.id);
      }
      matches.push(candidate);
    }
    if (matches.length > 1) {
      throw new ObsidianWorkbenchRecoveryConflictError(matches[0]!.id);
    }
    for (const pending of matches) {
      const cleanup = await this.#transactions.cleanup(pending, signal, true);
      if (cleanup.status !== "cleaned") {
        throw new ObsidianWorkbenchRecoveryConflictError(pending.id);
      }
      await this.#removeScopeIndexes(pending, signal);
      this.#forgetDeletionOwnership(pending.id);
    }
  }

  async #transactionFolderEmpty(
    transactionId: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      return (
        await this.#files.list(`${TRANSACTION_ROOT}/${transactionId}`, signal)
      ).length === 0;
    } catch {
      return false;
    }
  }

  async #recoverPairState(
    plan: ReturnType<typeof pairPlanFromRecord>,
    forward: boolean,
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    for (const [member, path, text] of [
      ["html", plan.paths.html, forward ? plan.afterHtml : plan.beforeHtml],
      ["sidecar", plan.paths.sidecar, forward ? plan.afterSidecar : plan.beforeSidecar]
    ] as const) {
      if (text === null) {
        await this.#removePathProven(record, path, `pair-create:${member}`, signal);
      } else {
        await this.#restorePath(path, text, record.id, signal);
      }
    }
  }

  async #recoverHistoryState(
    plan: HistoryPlanData,
    forward: boolean,
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    if (forward) {
      await this.#restorePath(
        plan.finalPath,
        plan.provisional.text,
        record.id,
        signal
      );
      await this.#removePathProven(
        record,
        plan.provisional.path,
        "history:provisional",
        signal
      );
      for (const item of plan.removals) {
        await this.#removePathProven(
          record,
          item.path,
          historyRemovalRole(item.path),
          signal
        );
      }
      return;
    }
    await this.#removePathProven(record, plan.finalPath, "history:final", signal);
    for (const item of plan.removals) {
      await this.#restorePath(item.path, item.text, record.id, signal);
    }
    await this.#restorePath(
      plan.provisional.path,
      plan.provisional.text,
      record.id,
      signal
    );
  }

  async #removePathProven(
    record: TransactionRecord,
    path: string,
    role: string,
    signal?: AbortSignal
  ): Promise<void> {
    const current = await this.#files.readTextStable(path, signal);
    if (current) await this.#removeProvenOwned(record, role, current, signal);
  }

  async #recoverPendingPreparation(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    const plan = await parseOwnershipPlan(blobText(record, "ownership-plan"));
    const current = await this.#files.readTextStable(plan.path, signal);
    if (current && current.sha256 !== plan.sha256) {
      await this.#transactions.quarantineTargetDrift(
        record,
        [{ path: plan.path, state: "present", sha256: current.sha256, byteLength: current.byteLength }],
        signal
      );
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    if (current) {
      await this.#removeProvenOwned(record, "history-pending", current, signal);
    }
    const cleanup = await this.#transactions.cleanup(record, signal, true);
    if (cleanup.status !== "cleaned") {
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    await this.#removeScopeIndexes(record, signal);
    this.#forgetDeletionOwnership(record.id);
  }

  async #recoverPairCleanup(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<void> {
    for (const [path, blobRole, ownershipRole] of [
      [record.scope.pair.html, "pair-html-after", "pair-cleanup:html"],
      [record.scope.pair.sidecar, "pair-sidecar-after", "pair-cleanup:sidecar"]
    ] as const) {
      const current = await this.#files.readTextStable(path, signal);
      if (current && current.text === blobText(record, blobRole)) {
        await this.#removeProvenOwned(record, ownershipRole, current, signal);
      }
    }
    if (record.phase === "prepared") {
      record = await this.#transactions.transition(record, "applying", signal);
    }
    if (record.phase === "applying") {
      record = await this.#transactions.transition(record, "committed", signal);
    }
    if (record.phase === "committed") {
      record = await this.#transactions.transition(record, "completed", signal);
    }
    const cleanup = await this.#transactions.cleanup(record, signal);
    if (cleanup.status !== "cleaned") {
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    await this.#releaseLocks(record, ["pair"], signal);
    await this.#removeScopeIndexes(record, signal);
    this.#forgetDeletionOwnership(record.id);
  }

  async #activePending(
    documentId: string,
    signal?: AbortSignal
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const record of await this.#transactions.listAll(signal)) {
      if (
        record.kind !== "owned-cleanup" ||
        record.scope.historyDocumentId !== documentId ||
        record.phase !== "committed"
      ) {
        continue;
      }
      try {
        if ((await parseMetadata(blobText(record, "metadata"))).operation !== "history-pending") {
          continue;
        }
        const plan = await parseOwnershipPlan(blobText(record, "ownership-plan"));
        const current = await this.#files.readTextStable(plan.path, signal);
        const original = this.#deletionOwnership.get(record.id)?.get("history-pending");
        if (
          original &&
          current &&
          sameFile(current, original) &&
          current.sha256 === plan.sha256 &&
          current.byteLength === plan.byteLength
        ) {
          result.set(plan.path, record.id);
        }
      } catch {
        // Strict record opening/quarantine owns malformed WAL classification.
      }
    }
    return result;
  }

  async #knownPendingPaths(
    documentId: string,
    signal?: AbortSignal
  ): Promise<Set<string>> {
    const result = new Set<string>();
    for (const record of await this.#transactions.listAll(signal)) {
      if (
        record.kind !== "owned-cleanup" ||
        record.scope.historyDocumentId !== documentId ||
        record.phase !== "committed"
      ) {
        continue;
      }
      try {
        if ((await parseMetadata(blobText(record, "metadata"))).operation !== "history-pending") {
          continue;
        }
        const plan = await parseOwnershipPlan(blobText(record, "ownership-plan"));
        const current = await this.#files.readTextStable(plan.path, signal);
        if (
          current &&
          current.sha256 === plan.sha256 &&
          current.byteLength === plan.byteLength
        ) {
          result.add(plan.path);
        }
      } catch {
        // Strict record opening/quarantine owns malformed WAL classification.
      }
    }
    return result;
  }

  async #validatedHistoryPlan(
    provisional: HistoryFile<ObsidianHistoryObservation>,
    finalPath: string,
    observedFiles: readonly HistoryFile<ObsidianHistoryObservation>[],
    removals: readonly HistoryFile<ObsidianHistoryObservation>[],
    requireCurrentHandles = true
  ): Promise<HistoryPlanData> {
    const provisionalData = this.#trustedHistory(provisional);
    if (!provisionalData.preparationId) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    const final = historyPath(canonicalVaultPath(finalPath), "html");
    if (final.documentId !== provisionalData.documentId) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    const observed = observedFiles.map((file) => {
      const data = this.#trustedHistory(file);
      if (data.documentId !== final.documentId || data.folder !== final.folder) {
        throw new ObsidianWorkbenchHandleUntrustedError();
      }
      return exactHistory(data.file);
    });
    if (
      new Set(observed.map(({ path }) => path)).size !== observed.length ||
      !observed.some(({ path }) => path === provisional.path)
    ) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    const observedMap = new Map(observedFiles.map((file) => [file.path, file]));
    const removalData = removals.map((file) => {
      if (observedMap.get(file.path) !== file || file.path.endsWith(".pending")) {
        throw new ObsidianWorkbenchHandleUntrustedError();
      }
      return exactHistory(this.#trustedHistory(file).file);
    });
    if (new Set(removalData.map(({ path }) => path)).size !== removalData.length) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    if (requireCurrentHandles) {
      for (const file of [provisional, ...observedFiles]) {
        const data = this.#trustedHistory(file);
        const current = await this.#files.readTextStable(data.file.path);
        if (!sameFile(current, data.file)) {
          throw new ObsidianWorkbenchHandleUntrustedError();
        }
      }
    }
    return signHistoryPlan({
      schemaVersion: 1,
      documentId: final.documentId,
      provisional: exactHistory(provisionalData.file),
      finalPath: final.path,
      observed: observed.sort((left, right) => compareText(left.path, right.path)),
      removals: removalData.sort((left, right) => compareText(left.path, right.path))
    });
  }

  async #historyPlanCurrent(
    plan: HistoryPlanData,
    signal?: AbortSignal
  ): Promise<"current" | "lost" | "collision" | "conflict"> {
    const currentProvisional = await this.#files.readTextStable(plan.provisional.path, signal);
    if (!currentProvisional) return "lost";
    if (!sameExact(currentProvisional, plan.provisional)) return "lost";
    if (await this.#files.readTextStable(plan.finalPath, signal)) return "collision";
    const entries = await this.#files.list(folderOf(plan.finalPath), signal);
    if (entries.some(({ kind }) => kind !== "file")) return "conflict";
    const visible = new Map<string, VaultFileObservation>();
    for (const entry of entries) {
      const observed = await this.#files.readTextStable(entry.path, signal);
      if (observed) visible.set(entry.path, observed);
    }
    if (
      visible.size !== plan.observed.length ||
      plan.observed.some((item) => !sameExact(visible.get(item.path) ?? null, item))
    ) {
      return "conflict";
    }
    return "current";
  }

  async #historyHandlesCurrent(
    provisional: HistoryFile<ObsidianHistoryObservation>,
    finalPath: string,
    observedFiles: readonly HistoryFile<ObsidianHistoryObservation>[],
    signal?: AbortSignal
  ): Promise<"current" | "lost" | "collision" | "conflict"> {
    const provisionalData = this.#trustedHistory(provisional);
    const currentProvisional = await this.#files.readTextStable(
      provisionalData.file.path,
      signal
    );
    if (!sameFile(currentProvisional, provisionalData.file)) return "lost";
    if (await this.#files.readTextStable(finalPath, signal)) return "collision";
    const entries = await this.#files.list(provisionalData.folder, signal);
    const knownPending = await this.#knownPendingPaths(provisionalData.documentId, signal);
    const relevantEntries = entries.filter(
      ({ path }) =>
        observedFiles.some((file) => file.path === path) ||
        !knownPending.has(path)
    );
    if (
      relevantEntries.length !== observedFiles.length ||
      relevantEntries.some(({ kind }) => kind !== "file")
    ) {
      return "conflict";
    }
    for (const file of observedFiles) {
      const data = this.#trustedHistory(file);
      if (!sameFile(await this.#files.readTextStable(data.file.path, signal), data.file)) {
        return "conflict";
      }
    }
    return "current";
  }

  async #applyHistoryForward(
    plan: HistoryPlanData,
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<VaultFileObservation> {
    const promoted = await this.#createExact(
      plan.finalPath,
      plan.provisional.text,
      record.id,
      signal
    );
    this.#rememberDeletion(record.id, "history:final", promoted);
    const provisional = await this.#files.readTextStable(plan.provisional.path, signal);
    if (!provisional || !sameExact(provisional, plan.provisional)) {
      throw new ObsidianWorkbenchAmbiguousError(record.id);
    }
    await this.#removeProvenOwned(record, "history:provisional", provisional, signal);
    await this.#crashPoint("after-history-promote", record);
    for (let index = 0; index < plan.removals.length; index += 1) {
      const item = plan.removals[index]!;
      const current = await this.#files.readTextStable(item.path, signal);
      if (!current || !sameExact(current, item)) {
        throw new ObsidianWorkbenchAmbiguousError(record.id);
      }
      await this.#removeProvenOwned(record, historyRemovalRole(item.path), current, signal);
      await this.#crashPoint("after-history-removal", record, index);
    }
    return promoted;
  }

  async #historyIsForward(plan: HistoryPlanData): Promise<boolean> {
    const final = await this.#files.readTextStable(plan.finalPath);
    if (!sameContents(final, plan.provisional)) return false;
    if (await this.#files.readTextStable(plan.provisional.path)) return false;
    for (const item of plan.removals) {
      if (await this.#files.readTextStable(item.path)) return false;
    }
    return true;
  }

  async #historyIsPrecommit(plan: HistoryPlanData): Promise<boolean> {
    if (!sameExact(await this.#files.readTextStable(plan.provisional.path), plan.provisional)) {
      return false;
    }
    if (await this.#files.readTextStable(plan.finalPath)) return false;
    for (const item of plan.removals) {
      if (!sameExact(await this.#files.readTextStable(item.path), item)) return false;
    }
    return true;
  }

  async #receiptPlan(
    paths: ArtifactPaths,
    pair: { html: string; sidecarJson: string },
    history: HistoryPlanData | undefined
  ): Promise<TransactionReceiptPlan> {
    return {
      pair: {
        htmlPath: paths.html,
        sidecarPath: paths.sidecar,
        htmlHash: await sha256Text(pair.html),
        sidecarHash: await sha256Text(pair.sidecarJson)
      },
      historyHashes: history ? await historyReceiptHashes(history) : []
    };
  }

  async #readPairRaw(paths: ArtifactPaths): Promise<{
    html: VaultFileObservation;
    sidecar: VaultFileObservation;
  } | null> {
    const [html, sidecar] = await Promise.all([
      this.#files.readTextStable(paths.html),
      this.#files.readTextStable(paths.sidecar)
    ]);
    return html && sidecar ? { html, sidecar } : null;
  }

  async #pairBytes(
    pair: { html: VaultFileObservation; sidecar: VaultFileObservation },
    expected: { html: string; sidecarJson: string }
  ): Promise<boolean> {
    return pair.html.text === expected.html && pair.sidecar.text === expected.sidecarJson;
  }

  async #pairStillOwned(
    expected: PairObservationData,
    signal?: AbortSignal
  ): Promise<boolean> {
    const pair = await this.#readPairRaw(expected.paths);
    throwIfAborted(signal);
    return (
      pair !== null &&
      sameFile(pair.html, expected.html) &&
      sameFile(pair.sidecar, expected.sidecar)
    );
  }

  async #modifyExact(
    owned: VaultOwnedFile,
    text: string,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<VaultFileObservation> {
    const result = await this.#files.modifyOwned(owned, text, signal);
    if (result.status !== "modified") {
      throw new ObsidianWorkbenchAmbiguousError(transactionId, result);
    }
    return result.file;
  }

  async #createExact(
    path: string,
    text: string,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<VaultFileObservation> {
    const result = await this.#files.createExclusive(path, text, signal);
    if (result.status !== "created") {
      throw new ObsidianWorkbenchAmbiguousError(transactionId, result);
    }
    return result.file;
  }

  async #removeExact(
    owned: VaultOwnedFile,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const result = await this.#files.removeOwned(owned, signal);
    if (result.status !== "removed") {
      throw new ObsidianWorkbenchAmbiguousError(transactionId, result);
    }
  }

  #rememberDeletion(
    transactionId: string,
    role: string,
    file: VaultFileObservation
  ): void {
    let transaction = this.#deletionOwnership.get(transactionId);
    if (!transaction) {
      transaction = new Map();
      this.#deletionOwnership.set(transactionId, transaction);
    }
    transaction.set(role, file);
  }

  #rememberHistoryDeletions(
    transactionId: string,
    provisional: HistoryFile<ObsidianHistoryObservation>,
    removals: readonly HistoryFile<ObsidianHistoryObservation>[]
  ): void {
    this.#rememberDeletion(
      transactionId,
      "history:provisional",
      this.#trustedHistory(provisional).file
    );
    for (const removal of removals) {
      const file = this.#trustedHistory(removal).file;
      this.#rememberDeletion(transactionId, historyRemovalRole(file.path), file);
    }
  }

  #hasDeletionOwnership(transactionId: string): boolean {
    return this.#deletionOwnership.has(transactionId);
  }

  #forgetDeletionOwnership(transactionId: string): void {
    this.#deletionOwnership.delete(transactionId);
  }

  #rememberRetentionContinuation(
    transactionId: string,
    provisional: VaultFileObservation
  ): void {
    this.#retentionContinuations.set(transactionId, provisional);
  }

  #hasRetentionContinuation(transactionId: string): boolean {
    return this.#retentionContinuations.has(transactionId);
  }

  #forgetRetentionContinuation(transactionId: string): void {
    this.#retentionContinuations.delete(transactionId);
  }

  async #removeProvenOwned(
    record: TransactionRecord,
    role: string,
    current: VaultFileObservation,
    signal?: AbortSignal
  ): Promise<void> {
    const original = this.#deletionOwnership.get(record.id)?.get(role);
    if (!original || !sameFile(current, original)) {
      await this.#transactions.quarantineTargetDrift(
        record,
        [
          {
            path: current.path,
            state: "present",
            sha256: current.sha256,
            byteLength: current.byteLength
          }
        ],
        signal
      );
      throw new ObsidianWorkbenchRecoveryConflictError(record.id);
    }
    await this.#removeExact(original, record.id, signal);
  }

  async #restorePath(
    path: string,
    text: string | null,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const current = await this.#files.readTextStable(path, signal);
    if (text === null) {
      if (current) await this.#removeExact(current, transactionId, signal);
      return;
    }
    if (!current) {
      await this.#createExact(path, text, transactionId, signal);
      return;
    }
    if (current.text !== text) {
      await this.#modifyExact(current, text, transactionId, signal);
    }
  }

  async #acquireLocks(
    record: TransactionRecord,
    kinds: readonly ("pair" | "history")[],
    signal?: AbortSignal
  ): Promise<boolean> {
    const folder = `${TRANSACTION_ROOT}/locks`;
    await this.#files.ensureFolder(folder, signal);
    const acquired: VaultFileObservation[] = [];
    for (const kind of [...kinds].sort(compareText)) {
      const path = await lockPath(record, kind);
      const result = await this.#files.createExclusive(path, record.id, signal);
      if (result.status === "created") {
        acquired.push(result.file);
        continue;
      }
      for (const owned of acquired.reverse()) {
        await this.#files.removeOwned(owned).catch(() => undefined);
      }
      if (result.status === "collision") return false;
      throw new ObsidianWorkbenchAmbiguousError(record.id, result);
    }
    this.#beginActive(record.id);
    return true;
  }

  #beginActive(transactionId: string): void {
    if (ACTIVE_TRANSACTIONS.has(transactionId)) return;
    let release!: () => void;
    ACTIVE_TRANSACTIONS.set(
      transactionId,
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    ACTIVE_RELEASES.set(transactionId, release);
  }

  async #releaseLocks(
    record: TransactionRecord,
    kinds: readonly ("pair" | "history")[],
    signal?: AbortSignal
  ): Promise<void> {
    for (const kind of [...kinds].sort(compareText).reverse()) {
      const path = await lockPath(record, kind);
      const current = await this.#files.readTextStable(path, signal);
      if (!current) continue;
      if (current.text !== record.id) {
        throw new ObsidianWorkbenchRecoveryConflictError(record.id);
      }
      await this.#removeExact(current, record.id, signal);
    }
  }

  async #releaseScopeLocks(
    scope: TransactionScope,
    transactionId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const kinds: ("pair" | "history")[] = ["pair"];
    if (scope.historyDocumentId !== undefined) kinds.unshift("history");
    for (const kind of kinds) {
      const path = await lockPathForScope(scope, kind);
      const current = await this.#files.readTextStable(path, signal);
      if (!current) continue;
      if (current.text !== transactionId) {
        throw new ObsidianWorkbenchRecoveryConflictError(transactionId);
      }
      await this.#removeExact(current, transactionId, signal);
    }
  }

  #abandonActive(transactionId: string): void {
    ACTIVE_RELEASES.get(transactionId)?.();
    ACTIVE_RELEASES.delete(transactionId);
    ACTIVE_TRANSACTIONS.delete(transactionId);
  }

  #pairObservation(
    paths: ArtifactPaths,
    html: VaultFileObservation,
    sidecar: VaultFileObservation
  ): ObsidianPairObservation {
    const value = Object.freeze({
      html: publicEvidence(html),
      sidecar: publicEvidence(sidecar)
    });
    this.#pairHandles.set(value, { paths, html, sidecar });
    return value;
  }

  #ownership(
    paths: ArtifactPaths,
    member: "html" | "sidecar",
    file: VaultFileObservation
  ): ObsidianPairOwnership {
    const value = Object.freeze({ ...publicEvidence(file), member });
    this.#ownershipHandles.set(value, { paths, member, file });
    return value;
  }

  #historyFile(
    file: VaultFileObservation,
    scope: { folder: string; documentId: string },
    preparationId?: string
  ): HistoryFile<ObsidianHistoryObservation> {
    const observation = Object.freeze(publicEvidence(file));
    this.#historyHandles.set(observation, {
      file,
      folder: scope.folder,
      documentId: scope.documentId,
      ...(preparationId ? { preparationId } : {})
    });
    return Object.freeze({ path: file.path, html: file.text, observation });
  }

  #trustedPair(
    observation: ObsidianPairObservation,
    paths: ArtifactPaths
  ): PairObservationData {
    const data = this.#pairHandles.get(observation);
    if (
      !data ||
      data.paths.html !== paths.html ||
      data.paths.sidecar !== paths.sidecar
    ) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    return data;
  }

  #trustedOwnership(ownership: ObsidianPairOwnership): OwnershipData {
    const data = this.#ownershipHandles.get(ownership);
    if (!data) throw new ObsidianWorkbenchHandleUntrustedError();
    return data;
  }

  #trustedHistory(
    file: HistoryFile<ObsidianHistoryObservation>
  ): HistoryObservationData {
    const data = this.#historyHandles.get(file.observation);
    if (
      !data ||
      file.path !== data.file.path ||
      file.html !== data.file.text
    ) {
      throw new ObsidianWorkbenchHandleUntrustedError();
    }
    return data;
  }

  async #crashPoint(
    point: ObsidianWorkbenchCrashPoint,
    record: TransactionRecord,
    removalIndex?: number
  ): Promise<void> {
    await this.#options.onCrashPoint?.(point, {
      transactionId: record.id,
      ...(removalIndex === undefined ? {} : { removalIndex })
    });
    if (this.#options.crashAt?.has(point)) {
      throw new ObsidianWorkbenchSimulatedCrashError(point);
    }
  }

  async #serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
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

  async #serializeMany<T>(
    keys: readonly string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const ordered = [...new Set(keys)].sort(compareText);
    const enter = (index: number): Promise<T> =>
      index === ordered.length
        ? operation()
        : this.#serialize(ordered[index]!, () => enter(index + 1));
    return enter(0);
  }
}

function validPairPaths(paths: ArtifactPaths): ArtifactPaths {
  const html = canonicalVaultPath(paths.html);
  const sidecar = canonicalVaultPath(paths.sidecar);
  if (
    !html.endsWith(".galley.html") ||
    !sidecar.endsWith(".galley.json") ||
    html.slice(0, -".galley.html".length) !==
      sidecar.slice(0, -".galley.json".length)
  ) {
    throw new Error("Galley workbench paths must identify one canonical pair.");
  }
  return { html, sidecar };
}

function pairPathsForMember(path: string): ArtifactPaths | null {
  if (path.endsWith(".galley.html")) {
    const stem = path.slice(0, -".galley.html".length);
    return validPairPaths({ html: path, sidecar: `${stem}.galley.json` });
  }
  if (path.endsWith(".galley.json")) {
    const stem = path.slice(0, -".galley.json".length);
    return validPairPaths({ html: `${stem}.galley.html`, sidecar: path });
  }
  return null;
}

function historyFolder(path: string): { folder: string; documentId: string } {
  const folder = canonicalVaultPath(path);
  const prefix = `${HISTORY_ROOT}/`;
  if (!folder.startsWith(prefix) || folder.slice(prefix.length).includes("/")) {
    throw new Error("Galley history folder is outside the canonical history root.");
  }
  const documentId = canonicalDocumentId(folder.slice(prefix.length));
  return { folder: `${HISTORY_ROOT}/${documentId}`, documentId };
}

function historyPath(
  path: string,
  extension: "html" | "pending"
): { path: string; folder: string; documentId: string } {
  const checked = canonicalVaultPath(path);
  const folder = folderOf(checked);
  const scope = historyFolder(folder);
  const parsed = historyName(baseName(checked));
  if (!parsed || parsed.extension !== extension) {
    throw new Error("Galley history filename is invalid.");
  }
  return { path: checked, ...scope };
}

function historyName(name: string): { extension: "html" | "pending" } | null {
  const match = HISTORY_NAME.exec(name);
  if (!match || (match[4] !== "html" && match[4] !== "pending")) return null;
  try {
    canonicalDocumentId(match[2]!);
  } catch {
    return null;
  }
  return { extension: match[4] };
}

function canonicalDocumentId(value: string): string {
  const canonical = value.toLowerCase();
  if (!UUID.test(canonical)) {
    throw new Error("Galley history document ID must be a canonical UUID.");
  }
  try {
    GalleySidecarV1Schema.shape.documentId.parse(canonical);
  } catch {
    throw new Error("Galley history document ID must be sidecar-valid.");
  }
  return canonical;
}

function historyScope(documentId: string): TransactionScope {
  const stem = `${HISTORY_ROOT}/${documentId}/${EMPTY_PAIR_SUFFIX}`;
  return {
    pair: {
      html: `${stem}.galley.html`,
      sidecar: `${stem}.galley.json`
    },
    historyDocumentId: documentId
  };
}

function pairQueueKey(paths: ArtifactPaths): string {
  return `pair:${paths.html}\n${paths.sidecar}`;
}

function historyQueueKey(folder: string): string {
  return `history:${folder}`;
}

function historyRemovalRole(path: string): string {
  return `history:removal:${path}`;
}

function lockKinds(
  operation: MetadataOperation
): readonly ("pair" | "history")[] {
  if (operation === "pair-history") return ["pair", "history"];
  if (operation === "history-retention") return ["history"];
  if (
    operation === "pair-replace" ||
    operation === "pair-create" ||
    operation === "pair-cleanup"
  ) {
    return ["pair"];
  }
  return [];
}

async function lockPath(
  record: TransactionRecord,
  kind: "pair" | "history"
): Promise<string> {
  return lockPathForScope(record.scope, kind);
}

async function lockPathForScope(
  scope: TransactionScope,
  kind: "pair" | "history"
): Promise<string> {
  const key =
    kind === "pair"
      ? canonicalJson({ kind, pair: scope.pair })
      : canonicalJson({ kind, documentId: scope.historyDocumentId });
  return `${TRANSACTION_ROOT}/locks/${await sha256Text(key)}.lock`;
}

async function pairIndexFolder(paths: ArtifactPaths): Promise<string> {
  return `${SCOPE_INDEX_ROOT}/pair-${await sha256Text(
    canonicalJson({ html: paths.html, sidecar: paths.sidecar })
  )}`;
}

async function historyIndexFolder(documentId: string): Promise<string> {
  return `${SCOPE_INDEX_ROOT}/history-${await sha256Text(documentId)}`;
}

async function scopeIndexFolders(scope: TransactionScope): Promise<string[]> {
  const result = [await pairIndexFolder(scope.pair)];
  if (scope.historyDocumentId !== undefined) {
    result.push(await historyIndexFolder(scope.historyDocumentId));
  }
  return result.sort(compareText);
}

async function signedScopeIndex(
  transactionId: string,
  scope: TransactionScope
): Promise<string> {
  const unsigned = { schemaVersion: 1 as const, transactionId, scope };
  return serializeCanonical({
    ...unsigned,
    checksum: await sha256Text(canonicalJson(unsigned))
  });
}

async function parseScopeIndex(
  text: string,
  expectedId: string,
  expectedScope?: TransactionScope
): Promise<ScopeIndexData> {
  const value = parseObject(text);
  exactKeys(value, ["schemaVersion", "transactionId", "scope", "checksum"]);
  if (value.schemaVersion !== 1 || value.transactionId !== expectedId) {
    throw new TransactionRecordInvalidError();
  }
  const scopeValue = objectValue(value.scope);
  exactKeys(scopeValue, [
    "pair",
    ...(scopeValue.historyDocumentId === undefined ? [] : ["historyDocumentId"])
  ]);
  const pair = objectValue(scopeValue.pair);
  exactKeys(pair, ["html", "sidecar"]);
  const scope: TransactionScope = {
    pair: validPairPaths({
      html: stringValue(pair.html),
      sidecar: stringValue(pair.sidecar)
    }),
    ...(scopeValue.historyDocumentId === undefined
      ? {}
      : {
          historyDocumentId: canonicalDocumentId(
            stringValue(scopeValue.historyDocumentId)
          )
        })
  };
  if (expectedScope && canonicalJson(scope) !== canonicalJson(expectedScope)) {
    throw new TransactionRecordInvalidError();
  }
  const checksum = stringValue(value.checksum);
  const unsigned = { schemaVersion: 1 as const, transactionId: expectedId, scope };
  const result = { ...unsigned, checksum };
  if (
    !SHA256.test(checksum) ||
    checksum !== (await sha256Text(canonicalJson(unsigned))) ||
    text !== serializeCanonical(result)
  ) {
    throw new TransactionRecordInvalidError();
  }
  return result;
}

function mergeRecords(
  left: readonly TransactionRecord[],
  right: readonly TransactionRecord[]
): TransactionRecord[] {
  const byId = new Map<string, TransactionRecord>();
  for (const record of [...left, ...right]) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => compareText(a.id, b.id));
}

function publicEvidence(file: VaultFileObservation): ObsidianFileEvidence {
  return Object.freeze({
    path: file.path,
    sha256: file.sha256,
    byteLength: file.byteLength
  });
}

function exactHistory(file: VaultFileObservation): ExactHistoryFile {
  return {
    path: file.path,
    text: file.text,
    sha256: file.sha256,
    byteLength: file.byteLength
  };
}

function sameFile(
  left: VaultFileObservation | null,
  right: VaultFileObservation
): boolean {
  return (
    left !== null &&
    left.path === right.path &&
    left.identity === right.identity &&
    left.text === right.text &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

function sameExact(
  left: VaultFileObservation | null,
  right: ExactHistoryFile
): boolean {
  return (
    left !== null &&
    left.path === right.path &&
    left.text === right.text &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

function sameContents(
  left: VaultFileObservation | null,
  right: ExactHistoryFile
): boolean {
  return (
    left !== null &&
    left.text === right.text &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function blobText(record: TransactionRecord, role: TransactionBlobRole): string {
  const matches = record.blobs.filter((blob) => blob.role === role);
  if (matches.length !== 1) throw new TransactionRecordInvalidError();
  return matches[0]!.text;
}

function hasBlob(record: TransactionRecord, role: TransactionBlobRole): boolean {
  return record.blobs.some((blob) => blob.role === role);
}

function pairPlanFromRecord(record: TransactionRecord): {
  paths: ArtifactPaths;
  beforeHtml: string | null;
  beforeSidecar: string | null;
  afterHtml: string;
  afterSidecar: string;
} {
  return {
    paths: validPairPaths(record.scope.pair),
    beforeHtml: hasBlob(record, "pair-html-before")
      ? blobText(record, "pair-html-before")
      : null,
    beforeSidecar: hasBlob(record, "pair-sidecar-before")
      ? blobText(record, "pair-sidecar-before")
      : null,
    afterHtml: blobText(record, "pair-html-after"),
    afterSidecar: blobText(record, "pair-sidecar-after")
  };
}

async function recordMatches(
  record: TransactionRecord,
  next: { html: string; sidecarJson: string },
  history: HistoryPlanData
): Promise<boolean> {
  try {
    return (
      blobText(record, "pair-html-after") === next.html &&
      blobText(record, "pair-sidecar-after") === next.sidecarJson &&
      serializeCanonical(await parseHistoryPlan(blobText(record, "history-plan"))) ===
        serializeCanonical(history)
    );
  } catch {
    return false;
  }
}

async function signedMetadata(operation: MetadataOperation): Promise<MetadataData> {
  const unsigned = { schemaVersion: 1 as const, operation };
  return { ...unsigned, checksum: await sha256Text(canonicalJson(unsigned)) };
}

async function parseMetadata(text: string): Promise<MetadataData> {
  const value = parseObject(text);
  exactKeys(value, ["schemaVersion", "operation", "checksum"]);
  const operation = value.operation;
  if (
    value.schemaVersion !== 1 ||
    typeof operation !== "string" ||
    ![
      "pair-replace",
      "pair-create",
      "pair-history",
      "history-retention",
      "history-pending",
      "pair-cleanup"
    ].includes(operation)
  ) {
    throw new TransactionRecordInvalidError();
  }
  const checksum = stringValue(value.checksum);
  const unsigned = {
    schemaVersion: 1 as const,
    operation: operation as MetadataOperation
  };
  const result = { ...unsigned, checksum };
  if (
    !SHA256.test(checksum) ||
    checksum !== (await sha256Text(canonicalJson(unsigned))) ||
    text !== serializeCanonical(result)
  ) {
    throw new TransactionRecordInvalidError();
  }
  return result;
}

async function signHistoryPlan(
  unsigned: Omit<HistoryPlanData, "checksum">
): Promise<HistoryPlanData> {
  return {
    ...unsigned,
    checksum: await sha256Text(canonicalJson(unsigned))
  };
}

async function parseHistoryPlan(text: string): Promise<HistoryPlanData> {
  const value = parseObject(text);
  exactKeys(value, [
    "schemaVersion",
    "documentId",
    "provisional",
    "finalPath",
    "observed",
    "removals",
    "checksum"
  ]);
  if (value.schemaVersion !== 1) throw new TransactionRecordInvalidError();
  const documentId = canonicalDocumentId(stringValue(value.documentId));
  const provisional = exactHistoryValue(value.provisional, documentId, "pending");
  const finalPath = historyPath(
    canonicalVaultPath(stringValue(value.finalPath)),
    "html"
  ).path;
  if (historyFolder(folderOf(finalPath)).documentId !== documentId) {
    throw new TransactionRecordInvalidError();
  }
  const observed = exactHistoryArray(value.observed, documentId);
  const removals = exactHistoryArray(value.removals, documentId);
  if (
    !observed.some(({ path }) => path === provisional.path) ||
    removals.some(({ path }) => path.endsWith(".pending")) ||
    removals.some(({ path }) => !observed.some((item) => item.path === path))
  ) {
    throw new TransactionRecordInvalidError();
  }
  const checksum = stringValue(value.checksum);
  const unsigned = {
    schemaVersion: 1 as const,
    documentId,
    provisional,
    finalPath,
    observed,
    removals
  };
  const result = { ...unsigned, checksum };
  if (
    !SHA256.test(checksum) ||
    checksum !== (await sha256Text(canonicalJson(unsigned))) ||
    text !== serializeCanonical(result)
  ) {
    throw new TransactionRecordInvalidError();
  }
  return result;
}

function exactHistoryArray(value: unknown, documentId: string): ExactHistoryFile[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TransactionRecordInvalidError();
  }
  const result = value.map((item) => exactHistoryValue(item, documentId));
  if (
    new Set(result.map(({ path }) => path)).size !== result.length ||
    result.some(
      (item, index) => index > 0 && compareText(result[index - 1]!.path, item.path) >= 0
    )
  ) {
    throw new TransactionRecordInvalidError();
  }
  return result;
}

function exactHistoryValue(
  value: unknown,
  documentId: string,
  extension?: "html" | "pending"
): ExactHistoryFile {
  const object = objectValue(value);
  exactKeys(object, ["path", "text", "sha256", "byteLength"]);
  const path = canonicalVaultPath(stringValue(object.path));
  const parsed = historyPath(
    path,
    extension ?? (path.endsWith(".pending") ? "pending" : "html")
  );
  const text = stringValue(object.text);
  const sha256 = stringValue(object.sha256);
  const length = numberValue(object.byteLength);
  if (
    parsed.documentId !== documentId ||
    !SHA256.test(sha256) ||
    !Number.isSafeInteger(length) ||
    length !== byteLength(text)
  ) {
    throw new TransactionRecordInvalidError();
  }
  return { path, text, sha256, byteLength: length };
}

async function parseOwnershipPlan(text: string): Promise<{
  path: string;
  documentId: string;
  sha256: string;
  byteLength: number;
}> {
  const value = parseObject(text);
  exactKeys(value, [
    "schemaVersion",
    "path",
    "documentId",
    "sha256",
    "byteLength",
    "checksum"
  ]);
  if (value.schemaVersion !== 1) throw new TransactionRecordInvalidError();
  const documentId = canonicalDocumentId(stringValue(value.documentId));
  const path = historyPath(canonicalVaultPath(stringValue(value.path)), "pending").path;
  const sha256 = stringValue(value.sha256);
  const length = numberValue(value.byteLength);
  const checksum = stringValue(value.checksum);
  const unsigned = {
    schemaVersion: 1,
    path,
    documentId,
    sha256,
    byteLength: length
  };
  if (
    !SHA256.test(sha256) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !SHA256.test(checksum) ||
    checksum !== (await sha256Text(canonicalJson(unsigned))) ||
    text !== serializeCanonical({ ...unsigned, checksum })
  ) {
    throw new TransactionRecordInvalidError();
  }
  return { path, documentId, sha256, byteLength: length };
}

async function signedEnvelope(
  unsigned: Record<string, unknown>
): Promise<string> {
  return serializeCanonical({
    ...unsigned,
    checksum: await sha256Text(canonicalJson(unsigned))
  });
}

async function historyReceiptHashes(plan: HistoryPlanData): Promise<string[]> {
  const descriptors: Record<string, unknown>[] = [
    {
      role: "provisional",
      path: plan.provisional.path,
      sha256: plan.provisional.sha256,
      byteLength: plan.provisional.byteLength
    },
    {
      role: "final",
      path: plan.finalPath,
      sha256: plan.provisional.sha256,
      byteLength: plan.provisional.byteLength
    },
    ...plan.observed.map((item) => ({
      role: "observed",
      path: item.path,
      sha256: item.sha256,
      byteLength: item.byteLength
    })),
    ...plan.removals.map((item) => ({
      role: "removal",
      path: item.path,
      sha256: item.sha256,
      byteLength: item.byteLength
    }))
  ];
  const hashes: string[] = [];
  for (const descriptor of descriptors) {
    hashes.push(await sha256Text(canonicalJson(descriptor)));
  }
  return hashes;
}

function serializeCanonical(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TransactionRecordInvalidError();
  return serialized;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(text) as unknown);
  } catch {
    throw new TransactionRecordInvalidError();
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TransactionRecordInvalidError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TransactionRecordInvalidError();
  }
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new TransactionRecordInvalidError();
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new TransactionRecordInvalidError();
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
