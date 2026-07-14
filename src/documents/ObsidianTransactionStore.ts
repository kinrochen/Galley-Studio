import { sha256Text } from "./GalleySidecar";
import {
  canonicalVaultPath,
  type ObsidianVaultFileStore,
  type VaultOwnedFile,
  type VaultOwnedFolder
} from "./ObsidianVaultFileStore";

export const TRANSACTION_ROOT = ".galley/transactions";
export const TRANSACTION_KINDS = [
  "pair-replace",
  "pair-create",
  "history-retention",
  "pair-history",
  "owned-cleanup"
] as const;
export const TRANSACTION_PHASES = [
  "prepared",
  "applying",
  "committed",
  "completed"
] as const;
export const TRANSACTION_BLOB_ROLES = [
  "pair-html-before",
  "pair-html-after",
  "pair-sidecar-before",
  "pair-sidecar-after",
  "history-plan",
  "ownership-plan",
  "metadata"
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type TransactionPhase = (typeof TRANSACTION_PHASES)[number];
export type TransactionBlobRole = (typeof TRANSACTION_BLOB_ROLES)[number];

export interface TransactionScope {
  readonly pair: { readonly html: string; readonly sidecar: string };
  readonly historyDocumentId?: string;
}

export interface TransactionBlobInput {
  readonly role: TransactionBlobRole;
  readonly text: string;
}

export interface PrepareTransactionInput {
  readonly kind: TransactionKind;
  readonly scope: TransactionScope;
  readonly blobs: readonly TransactionBlobInput[];
}

export interface StoredTransactionBlob {
  readonly role: TransactionBlobRole;
  readonly filename: string;
  readonly path: string;
  readonly text: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface TransactionRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: TransactionKind;
  readonly phase: TransactionPhase;
  readonly scope: TransactionScope;
  readonly blobs: readonly StoredTransactionBlob[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly checksum: string;
}

export interface TransactionReceiptPlan {
  readonly pair: {
    readonly htmlPath: string;
    readonly sidecarPath: string;
    readonly htmlHash: string;
    readonly sidecarHash: string;
  };
  readonly historyHashes: readonly string[];
}

export interface VerifiedTransactionReceipt extends TransactionReceiptPlan {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly manifestChecksum: string;
  readonly aggregateDigest: string;
  readonly checksum: string;
}

export interface ObsidianTransactionStoreOptions {
  readonly randomUUID?: () => string;
  readonly now?: () => Date;
  readonly maxPrepareAttempts?: number;
  readonly maxSnapshotAttempts?: number;
}

export class TransactionRecordInvalidError extends Error {
  readonly code = "transaction_record_invalid";

  constructor() {
    super("Galley transaction storage contains an invalid or drifted record.");
    this.name = "TransactionRecordInvalidError";
  }
}

export class TransactionRecordUnstableError extends Error {
  readonly code = "transaction_record_unstable";

  constructor() {
    super("Galley could not obtain one stable aggregate transaction record.");
    this.name = "TransactionRecordUnstableError";
  }
}

export class TransactionPhaseInvalidError extends Error {
  readonly code = "transaction_phase_invalid";

  constructor() {
    super("Galley transaction phase transition is not in the forward graph.");
    this.name = "TransactionPhaseInvalidError";
  }
}

export class TransactionWriteConflictError extends Error {
  readonly code = "transaction_write_conflict";

  constructor() {
    super("Galley transaction metadata changed before its conditional update.");
    this.name = "TransactionWriteConflictError";
  }
}

export class TransactionWriteAmbiguousError extends Error {
  readonly code = "transaction_write_ambiguous";

  constructor(
    readonly transactionId: string,
    readonly outcome: "applied" | "unknown",
    readonly operationError: unknown
  ) {
    super("Galley could not prove the transaction metadata mutation outcome.");
    this.name = "TransactionWriteAmbiguousError";
  }
}

export class TransactionHandleUntrustedError extends Error {
  readonly code = "transaction_handle_untrusted";

  constructor() {
    super("Galley transaction handle does not belong to this store instance.");
    this.name = "TransactionHandleUntrustedError";
  }
}

export class TransactionReceiptInvalidError extends Error {
  readonly code = "transaction_receipt_invalid";

  constructor() {
    super("Galley transaction receipt is invalid or does not match the exact plan.");
    this.name = "TransactionReceiptInvalidError";
  }
}

interface ManifestBlob {
  role: TransactionBlobRole;
  filename: string;
  byteLength: number;
  sha256: string;
}

interface TransactionManifest {
  schemaVersion: 1;
  transactionId: string;
  kind: TransactionKind;
  phase: TransactionPhase;
  scope: TransactionScope;
  blobs: ManifestBlob[];
  createdAt: string;
  updatedAt: string;
  checksum: string;
}

interface ReceiptData extends TransactionReceiptPlan {
  schemaVersion: 1;
  transactionId: string;
  manifestChecksum: string;
  aggregateDigest: string;
  checksum: string;
}

interface OwnedStoredTransactionBlob extends StoredTransactionBlob {
  readonly ownership: VaultOwnedFile;
}

interface OpenedTransaction {
  readonly record: TransactionRecord;
  readonly blobs: readonly OwnedStoredTransactionBlob[];
  readonly manifestOwnership: VaultOwnedFile;
  readonly aggregateDigest: string;
}

interface TrustedTransactionHandle {
  readonly id: string;
  readonly aggregate: AggregateSnapshot;
}

interface AggregateSnapshot {
  readonly digest: string;
  readonly manifestOwnership: VaultOwnedFile;
  readonly blobOwnerships: readonly VaultOwnedFile[];
}

const BLOB_FILENAMES: Readonly<Record<TransactionBlobRole, string>> = {
  "pair-html-before": "blob-pair-html-before.txt",
  "pair-html-after": "blob-pair-html-after.txt",
  "pair-sidecar-before": "blob-pair-sidecar-before.txt",
  "pair-sidecar-after": "blob-pair-sidecar-after.txt",
  "history-plan": "blob-history-plan.json",
  "ownership-plan": "blob-ownership-plan.json",
  metadata: "blob-metadata.json"
};
const MANIFEST_NAME = "manifest.json";
const RECEIPT_NAME = "receipt.json";
const QUARANTINE_NAME = "quarantine.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BLOB_BYTES = 32 * 1024 * 1024;
const MAX_SCOPE_PATH = 1024;
const DEFAULT_SNAPSHOT_ATTEMPTS = 4;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NEXT_PHASE: Readonly<Partial<Record<TransactionPhase, TransactionPhase>>> = {
  prepared: "applying",
  applying: "committed",
  committed: "completed"
};

export class ObsidianTransactionStore {
  readonly #randomUUID: () => string;
  readonly #now: () => Date;
  readonly #maxPrepareAttempts: number;
  readonly #maxSnapshotAttempts: number;
  readonly #handles = new WeakMap<TransactionRecord, TrustedTransactionHandle>();

  constructor(
    private readonly files: ObsidianVaultFileStore,
    options: ObsidianTransactionStoreOptions = {}
  ) {
    this.#randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
    this.#maxPrepareAttempts = options.maxPrepareAttempts ?? 128;
    this.#maxSnapshotAttempts = options.maxSnapshotAttempts ?? DEFAULT_SNAPSHOT_ATTEMPTS;
    if (
      !Number.isSafeInteger(this.#maxPrepareAttempts) ||
      this.#maxPrepareAttempts < 1 ||
      this.#maxPrepareAttempts > 1024
    ) {
      throw new Error("Galley transaction prepare attempts are invalid.");
    }
    if (
      !Number.isSafeInteger(this.#maxSnapshotAttempts) ||
      this.#maxSnapshotAttempts < 1 ||
      this.#maxSnapshotAttempts > 32
    ) {
      throw new Error("Galley transaction snapshot attempts are invalid.");
    }
  }

  async prepare(
    input: PrepareTransactionInput,
    signal?: AbortSignal
  ): Promise<TransactionRecord> {
    const kind = validKind(input.kind);
    const scope = validScope(input.scope);
    const blobs = validBlobInputs(input.blobs);
    throwIfAborted(signal);
    await this.files.ensureFolder(TRANSACTION_ROOT, signal);

    for (let attempt = 0; attempt < this.#maxPrepareAttempts; attempt += 1) {
      throwIfAborted(signal);
      const id = canonicalUuid(this.#randomUUID());
      const folderPath = transactionFolder(id);
      const folderResult = await this.files.createFolderExclusive(folderPath, signal);
      if (folderResult.status === "collision") continue;
      if (folderResult.status === "ambiguous") {
        throw new TransactionWriteAmbiguousError(
          id,
          folderResult.outcome === "applied" ? "applied" : "unknown",
          folderResult
        );
      }

      const ownedBlobs: OwnedStoredTransactionBlob[] = [];
      let manifest: TransactionManifest;
      try {
        for (const blob of blobs) {
          throwIfAborted(signal);
          const filename = BLOB_FILENAMES[blob.role];
          const path = `${folderPath}/${filename}`;
          const result = await this.files.createExclusive(path, blob.text, signal);
          if (result.status !== "created") {
            if (result.status === "ambiguous") {
              throw new TransactionWriteAmbiguousError(
                id,
                result.outcome === "applied" ? "applied" : "unknown",
                result
              );
            }
            throw new TransactionWriteConflictError();
          }
          ownedBlobs.push({
            role: blob.role,
            filename,
            path,
            text: blob.text,
            byteLength: result.file.byteLength,
            sha256: result.file.sha256,
            ownership: result.file
          });
        }

        const timestamp = validTimestamp(this.#now());
        const unsigned = {
          schemaVersion: 1 as const,
          transactionId: id,
          kind,
          phase: "prepared" as const,
          scope,
          blobs: ownedBlobs.map(({ role, filename, byteLength, sha256 }) => ({
            role,
            filename,
            byteLength,
            sha256
          })),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        manifest = await signed(unsigned);
      } catch (error) {
        await this.#cleanupIncomplete(ownedBlobs, folderResult.folder);
        throw error;
      }

      const manifestPath = `${folderPath}/${MANIFEST_NAME}`;
      let manifestResult;
      try {
        manifestResult = await this.files.createExclusive(
          manifestPath,
          serializeCanonical(manifest),
          signal
        );
      } catch (error) {
        const current = await this.#observeAfterPossibleManifest(manifestPath);
        if (current === null) {
          await this.#cleanupIncomplete(ownedBlobs, folderResult.folder);
          throw error;
        }
        throw new TransactionWriteAmbiguousError(id, "unknown", error);
      }
      if (manifestResult.status === "collision") {
        throw new TransactionWriteAmbiguousError(
          id,
          "unknown",
          new TransactionWriteConflictError()
        );
      }
      if (manifestResult.status === "ambiguous") {
        throw new TransactionWriteAmbiguousError(
          id,
          manifestResult.outcome === "applied" ? "applied" : "unknown",
          manifestResult
        );
      }
      if (signal?.aborted) {
        throw new TransactionWriteAmbiguousError(
          id,
          "applied",
          new DOMException("Aborted", "AbortError")
        );
      }
      try {
        const opened = await this.#openStrict(id);
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (
          !sameOwned(opened.manifestOwnership, manifestResult.file) ||
          !sameOwnedList(
            opened.blobs.map(({ ownership }) => ownership),
            ownedBlobs.map(({ ownership }) => ownership)
          )
        ) {
          throw new TransactionRecordInvalidError();
        }
        return this.#brand(opened);
      } catch (error) {
        throw new TransactionWriteAmbiguousError(id, "applied", error);
      }
    }
    throw new Error("Galley could not allocate a unique transaction folder.");
  }

  async open(id: string, signal?: AbortSignal): Promise<TransactionRecord> {
    const canonicalId = requireCanonicalUuid(id);
    try {
      return this.#brand(await this.#openStrict(canonicalId, signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      await this.#quarantineBestEffort(canonicalId, "record-invalid");
      if (
        error instanceof TransactionRecordInvalidError ||
        error instanceof TransactionRecordUnstableError
      ) {
        throw error;
      }
      throw new TransactionRecordInvalidError();
    }
  }

  async list(
    scope: TransactionScope,
    signal?: AbortSignal
  ): Promise<TransactionRecord[]> {
    const expected = validScope(scope);
    throwIfAborted(signal);
    const entries = await this.files.list(TRANSACTION_ROOT, signal);
    const records: TransactionRecord[] = [];
    for (const entry of entries) {
      if (entry.kind !== "folder" || !UUID.test(entry.name)) continue;
      try {
        // Completed cleanup leaves an intentionally inert empty UUID folder
        // because Obsidian has no identity-conditional directory delete.
        if ((await this.files.list(entry.path, signal)).length === 0) continue;
        const record = await this.open(entry.name, signal);
        if (sameScope(record.scope, expected)) records.push(record);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
      }
    }
    return records.sort((left, right) => compareText(left.id, right.id));
  }

  async transition(
    record: TransactionRecord,
    next: TransactionPhase,
    signal?: AbortSignal
  ): Promise<TransactionRecord> {
    const current = await this.#currentFor(record, signal);
    if (NEXT_PHASE[current.record.phase] !== next || !isPhase(next)) {
      throw new TransactionPhaseInvalidError();
    }
    const manifest = await signed({
      schemaVersion: 1 as const,
      transactionId: current.record.id,
      kind: current.record.kind,
      phase: next,
      scope: current.record.scope,
      blobs: current.record.blobs.map(({ role, filename, byteLength, sha256 }) => ({
        role,
        filename,
        byteLength,
        sha256
      })),
      createdAt: current.record.createdAt,
      updatedAt: validTimestamp(this.#now())
    });
    const result = await this.files.modifyOwned(
      current.manifestOwnership,
      serializeCanonical(manifest),
      signal
    );
    if (result.status === "conflict") throw new TransactionWriteConflictError();
    if (result.status === "ambiguous") {
      throw new TransactionWriteAmbiguousError(
        current.record.id,
        result.outcome === "applied" ? "applied" : "unknown",
        result
      );
    }
    if (signal?.aborted) {
      throw new TransactionWriteAmbiguousError(
        current.record.id,
        "applied",
        new DOMException("Aborted", "AbortError")
      );
    }
    try {
      const reopened = await this.#openStrict(current.record.id);
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (
        reopened.record.phase !== next ||
        !sameOwned(reopened.manifestOwnership, result.file) ||
        !sameOwnedList(
          reopened.blobs.map(({ ownership }) => ownership),
          current.blobs.map(({ ownership }) => ownership)
        )
      ) {
        throw new TransactionRecordInvalidError();
      }
      return this.#brand(reopened);
    } catch (error) {
      throw new TransactionWriteAmbiguousError(
        current.record.id,
        "applied",
        error
      );
    }
  }

  async writeReceipt(
    record: TransactionRecord,
    plan: TransactionReceiptPlan,
    signal?: AbortSignal
  ): Promise<VerifiedTransactionReceipt> {
    const current = await this.#currentFor(record, signal);
    const checked = validReceiptPlan(plan);
    if (
      checked.pair.htmlPath !== current.record.scope.pair.html ||
      checked.pair.sidecarPath !== current.record.scope.pair.sidecar
    ) {
      throw new TransactionReceiptInvalidError();
    }
    const receipt = await signed({
      schemaVersion: 1 as const,
      transactionId: current.record.id,
      manifestChecksum: current.record.checksum,
      aggregateDigest: current.aggregateDigest,
      pair: checked.pair,
      historyHashes: [...checked.historyHashes]
    });
    const beforeCreate = await this.#currentFor(record, signal);
    if (!sameAggregate(current, beforeCreate)) {
      throw new TransactionWriteConflictError();
    }
    const path = `${transactionFolder(current.record.id)}/${RECEIPT_NAME}`;
    const result = await this.files.createExclusive(path, serializeCanonical(receipt), signal);
    if (result.status === "ambiguous") {
      throw new TransactionWriteAmbiguousError(
        current.record.id,
        result.outcome === "applied" ? "applied" : "unknown",
        result
      );
    }
    if (result.status === "collision") return await this.verifyReceipt(record, checked, signal);
    if (signal?.aborted) {
      throw new TransactionWriteAmbiguousError(
        current.record.id,
        "applied",
        new DOMException("Aborted", "AbortError")
      );
    }
    try {
      const receiptOwned = await this.files.readTextStable(path, signal);
      const afterCreate = await this.#currentFor(record, signal);
      if (
        !sameAggregate(current, afterCreate) ||
        !sameOwned(receiptOwned, result.file)
      ) {
        throw new TransactionWriteConflictError();
      }
      return freezeReceipt(receipt);
    } catch (error) {
      throw new TransactionWriteAmbiguousError(current.record.id, "applied", error);
    }
  }

  async verifyReceipt(
    record: TransactionRecord,
    expected: TransactionReceiptPlan,
    signal?: AbortSignal
  ): Promise<VerifiedTransactionReceipt> {
    const current = await this.#currentFor(record, signal);
    try {
      const plan = validReceiptPlan(expected);
      if (
        plan.pair.htmlPath !== current.record.scope.pair.html ||
        plan.pair.sidecarPath !== current.record.scope.pair.sidecar
      ) {
        throw new TransactionReceiptInvalidError();
      }
      const path = `${transactionFolder(current.record.id)}/${RECEIPT_NAME}`;
      const firstOwned = await this.files.readTextStable(path, signal);
      if (!firstOwned || firstOwned.byteLength > MAX_MANIFEST_BYTES) {
        throw new TransactionReceiptInvalidError();
      }
      const parsed = await parseReceipt(firstOwned.text, current, plan);
      const closing = await this.#currentFor(record, signal);
      if (!sameAggregate(current, closing)) {
        throw new TransactionReceiptInvalidError();
      }
      const secondOwned = await this.files.readTextStable(path, signal);
      if (!sameOwned(secondOwned, firstOwned)) {
        throw new TransactionReceiptInvalidError();
      }
      const finalAggregate = await this.#currentFor(record, signal);
      if (!sameAggregate(current, finalAggregate)) {
        throw new TransactionReceiptInvalidError();
      }
      return freezeReceipt(parsed);
    } catch (error) {
      await this.#quarantineBestEffort(current.record.id, "receipt-invalid");
      if (error instanceof TransactionReceiptInvalidError) throw error;
      throw new TransactionReceiptInvalidError();
    }
  }

  async cleanup(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<
    | { status: "cleaned"; directory: "retained" }
    | { status: "conflict" }
    | { status: "ambiguous" }
  > {
    let currentRecord: OpenedTransaction;
    try {
      currentRecord = await this.#currentFor(record, signal);
    } catch (error) {
      if (
        error instanceof TransactionRecordInvalidError ||
        error instanceof TransactionRecordUnstableError ||
        error instanceof TransactionWriteConflictError
      ) {
        return { status: "conflict" };
      }
      throw error;
    }
    if (currentRecord.record.phase !== "completed") {
      throw new TransactionPhaseInvalidError();
    }
    const known: VaultOwnedFile[] = [
      currentRecord.manifestOwnership,
      ...currentRecord.blobs.map(({ ownership }) => ownership)
    ];
    for (const owned of known) {
      const current = await this.files.readTextStable(owned.path, signal);
      if (!sameOwned(current, owned)) return { status: "conflict" };
    }
    const folderPath = transactionFolder(currentRecord.record.id);
    const allowed = new Set([
      MANIFEST_NAME,
      RECEIPT_NAME,
      QUARANTINE_NAME,
      ...currentRecord.record.blobs.map(({ role }) => BLOB_FILENAMES[role])
    ]);
    const entries = await this.files.list(folderPath, signal);
    if (entries.some(({ name, kind }) => kind !== "file" || !allowed.has(name))) {
      return { status: "conflict" };
    }
    const optional: VaultOwnedFile[] = [];
    for (const name of [RECEIPT_NAME, QUARANTINE_NAME]) {
      const owned = await this.files.readTextStable(`${folderPath}/${name}`, signal);
      if (owned) optional.push(owned);
    }
    try {
      const beforeDelete = await this.#currentFor(record, signal);
      if (!sameAggregate(currentRecord, beforeDelete)) return { status: "conflict" };
    } catch (error) {
      if (
        error instanceof TransactionRecordInvalidError ||
        error instanceof TransactionRecordUnstableError ||
        error instanceof TransactionWriteConflictError
      ) {
        return { status: "conflict" };
      }
      throw error;
    }
    let mutated = false;
    for (const owned of [
      ...currentRecord.blobs.map(({ ownership }) => ownership),
      ...optional,
      currentRecord.manifestOwnership
    ]) {
      let result;
      try {
        result = await this.files.removeOwned(owned, signal);
      } catch (error) {
        if (mutated) return { status: "ambiguous" };
        throw error;
      }
      if (result.status === "conflict") return { status: "conflict" };
      if (result.status === "ambiguous") return { status: "ambiguous" };
      mutated = true;
    }
    return { status: "cleaned", directory: "retained" };
  }

  async #openStrict(id: string, signal?: AbortSignal): Promise<OpenedTransaction> {
    let sawCompleteVector = false;
    let sawAggregateDrift = false;
    let lastInvalid: TransactionRecordInvalidError | undefined;
    for (let attempt = 0; attempt < this.#maxSnapshotAttempts; attempt += 1) {
      let opening: OpenedTransaction;
      try {
        opening = await this.#readVectorOnce(id, signal);
        sawCompleteVector = true;
      } catch (error) {
        if (error instanceof TransactionRecordInvalidError) {
          lastInvalid = error;
          if (sawCompleteVector) sawAggregateDrift = true;
          continue;
        }
        if (isVaultReadUnstable(error)) {
          sawAggregateDrift = true;
          continue;
        }
        throw error;
      }

      let closing: OpenedTransaction;
      try {
        closing = await this.#readClosingVector(id, opening, signal);
      } catch (error) {
        if (error instanceof TransactionRecordInvalidError) {
          lastInvalid = error;
          sawAggregateDrift = true;
          continue;
        }
        if (isVaultReadUnstable(error)) {
          sawAggregateDrift = true;
          continue;
        }
        throw error;
      }
      if (sameAggregate(opening, closing)) return closing;
      sawAggregateDrift = true;
    }
    if (sawAggregateDrift) throw new TransactionRecordUnstableError();
    throw lastInvalid ?? new TransactionRecordInvalidError();
  }

  async #readVectorOnce(
    id: string,
    signal?: AbortSignal
  ): Promise<OpenedTransaction> {
    const folderPath = transactionFolder(id);
    const manifestOwned = await this.files.readTextStable(
      `${folderPath}/${MANIFEST_NAME}`,
      signal
    );
    if (!manifestOwned || manifestOwned.byteLength > MAX_MANIFEST_BYTES) {
      throw new TransactionRecordInvalidError();
    }
    const manifest = await parseManifest(manifestOwned.text, id);
    const storedBlobs: OwnedStoredTransactionBlob[] = [];
    for (const blob of manifest.blobs) {
      const path = `${folderPath}/${BLOB_FILENAMES[blob.role]}`;
      const owned = await this.files.readTextStable(path, signal);
      if (
        !owned ||
        owned.byteLength !== blob.byteLength ||
        owned.sha256 !== blob.sha256
      ) {
        throw new TransactionRecordInvalidError();
      }
      storedBlobs.push({
        ...blob,
        path,
        text: owned.text,
        ownership: owned
      });
    }
    const rootEntries = await this.files.list(TRANSACTION_ROOT, signal);
    const hasFolder = rootEntries.some(
      ({ path, kind }) => path === folderPath && kind === "folder"
    );
    if (!hasFolder) throw new TransactionRecordInvalidError();
    const record: TransactionRecord = {
      schemaVersion: 1,
      id,
      kind: manifest.kind,
      phase: manifest.phase,
      scope: manifest.scope,
      blobs: storedBlobs.map(({ ownership: _ownership, ...blob }) => blob),
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      checksum: manifest.checksum
    };
    const aggregateDigest = await transactionAggregateDigest(
      manifestOwned,
      storedBlobs.map(({ ownership }) => ownership)
    );
    return {
      record,
      blobs: storedBlobs,
      manifestOwnership: manifestOwned,
      aggregateDigest
    };
  }

  async #readClosingVector(
    id: string,
    opening: OpenedTransaction,
    signal?: AbortSignal
  ): Promise<OpenedTransaction> {
    const folderPath = transactionFolder(id);
    const reversed: OwnedStoredTransactionBlob[] = [];
    for (const blob of [...opening.record.blobs].reverse()) {
      const path = `${folderPath}/${BLOB_FILENAMES[blob.role]}`;
      const owned = await this.files.readTextStable(path, signal);
      if (
        !owned ||
        owned.byteLength !== blob.byteLength ||
        owned.sha256 !== blob.sha256
      ) {
        throw new TransactionRecordInvalidError();
      }
      reversed.push({ ...blob, path, text: owned.text, ownership: owned });
    }
    const storedBlobs = reversed.reverse();
    const rootEntries = await this.files.list(TRANSACTION_ROOT, signal);
    if (
      !rootEntries.some(
        ({ path, kind }) => path === folderPath && kind === "folder"
      )
    ) {
      throw new TransactionRecordInvalidError();
    }
    // Manifest is deliberately the final durable member read. This closes
    // both an earlier-blob/later-blob window and scope/metadata drift during
    // the blob pass.
    const manifestOwned = await this.files.readTextStable(
      `${folderPath}/${MANIFEST_NAME}`,
      signal
    );
    if (!manifestOwned || manifestOwned.byteLength > MAX_MANIFEST_BYTES) {
      throw new TransactionRecordInvalidError();
    }
    const manifest = await parseManifest(manifestOwned.text, id);
    if (
      canonicalJson(manifest.blobs) !==
      canonicalJson(
        opening.record.blobs.map(({ role, filename, byteLength, sha256 }) => ({
          role,
          filename,
          byteLength,
          sha256
        }))
      )
    ) {
      throw new TransactionRecordInvalidError();
    }
    const record: TransactionRecord = {
      schemaVersion: 1,
      id,
      kind: manifest.kind,
      phase: manifest.phase,
      scope: manifest.scope,
      blobs: storedBlobs.map(({ ownership: _ownership, ...blob }) => blob),
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      checksum: manifest.checksum
    };
    const aggregateDigest = await transactionAggregateDigest(
      manifestOwned,
      storedBlobs.map(({ ownership }) => ownership)
    );
    return {
      record,
      blobs: storedBlobs,
      manifestOwnership: manifestOwned,
      aggregateDigest
    };
  }

  async #currentFor(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<OpenedTransaction> {
    const handle = this.#handles.get(record);
    if (!handle) throw new TransactionHandleUntrustedError();
    throwIfAborted(signal);
    const current = await this.#openStrict(handle.id, signal);
    if (!sameAggregateSnapshot(snapshotOf(current), handle.aggregate)) {
      throw new TransactionWriteConflictError();
    }
    return current;
  }

  #brand(opened: OpenedTransaction): TransactionRecord {
    const record = freezeRecord(opened.record);
    this.#handles.set(record, {
      id: record.id,
      aggregate: snapshotOf(opened)
    });
    return record;
  }

  async #quarantineBestEffort(id: string, reason: string): Promise<void> {
    const folder = transactionFolder(id);
    const entries = await this.files.list(TRANSACTION_ROOT).catch(() => []);
    if (!entries.some(({ path, kind }) => path === folder && kind === "folder")) return;
    const unsigned = {
      schemaVersion: 1 as const,
      transactionId: id,
      reason,
      quarantinedAt: validTimestamp(this.#now())
    };
    const metadata = await signed(unsigned);
    await this.files
      .createExclusive(`${folder}/${QUARANTINE_NAME}`, serializeCanonical(metadata))
      .catch(() => undefined);
  }

  async #cleanupIncomplete(
    blobs: readonly OwnedStoredTransactionBlob[],
    folder: VaultOwnedFolder
  ): Promise<void> {
    for (const blob of [...blobs].reverse()) {
      await this.files.removeOwned(blob.ownership).catch(() => undefined);
    }
    await this.files.removeEmptyFolderOwned(folder).catch(() => undefined);
  }

  async #observeAfterPossibleManifest(
    path: string
  ): Promise<VaultOwnedFile | null | undefined> {
    try {
      return await this.files.readTextStable(path);
    } catch {
      return undefined;
    }
  }
}

function freezeRecord(record: TransactionRecord): TransactionRecord {
  const pair = Object.freeze({ ...record.scope.pair });
  const scope = Object.freeze({
    pair,
    ...(record.scope.historyDocumentId === undefined
      ? {}
      : { historyDocumentId: record.scope.historyDocumentId })
  });
  const blobs = Object.freeze(
    record.blobs.map((blob) => Object.freeze({ ...blob }))
  );
  return Object.freeze({ ...record, scope, blobs });
}

function freezeReceipt(
  receipt: Omit<VerifiedTransactionReceipt, never>
): VerifiedTransactionReceipt {
  const pair = Object.freeze({ ...receipt.pair });
  const historyHashes = Object.freeze([...receipt.historyHashes]);
  return Object.freeze({ ...receipt, pair, historyHashes });
}

async function parseManifest(text: string, expectedId: string): Promise<TransactionManifest> {
  const value = parseObject(text);
  exactKeys(value, [
    "schemaVersion",
    "transactionId",
    "kind",
    "phase",
    "scope",
    "blobs",
    "createdAt",
    "updatedAt",
    "checksum"
  ]);
  if (value.schemaVersion !== 1 || value.transactionId !== expectedId) {
    throw new TransactionRecordInvalidError();
  }
  const kind = validKind(value.kind);
  const phase = validPhase(value.phase);
  const scope = validScope(value.scope as TransactionScope);
  if (!Array.isArray(value.blobs) || value.blobs.length > TRANSACTION_BLOB_ROLES.length) {
    throw new TransactionRecordInvalidError();
  }
  const blobs: ManifestBlob[] = value.blobs.map((item) => {
    const blob = objectValue(item);
    exactKeys(blob, ["role", "filename", "byteLength", "sha256"]);
    const role = validRole(blob.role);
    const filename = stringValue(blob.filename);
    const byteLength = numberValue(blob.byteLength);
    const sha256 = stringValue(blob.sha256);
    if (
      filename !== BLOB_FILENAMES[role] ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > MAX_BLOB_BYTES ||
      !SHA256.test(sha256)
    ) {
      throw new TransactionRecordInvalidError();
    }
    return { role, filename, byteLength, sha256 };
  });
  if (
    new Set(blobs.map(({ role }) => role)).size !== blobs.length ||
    new Set(blobs.map(({ filename }) => filename)).size !== blobs.length ||
    blobs.some(
      (blob, index) =>
        index > 0 && compareText(blobs[index - 1]!.role, blob.role) >= 0
    ) ||
    blobs.reduce((sum, blob) => sum + blob.byteLength, 0) > MAX_TOTAL_BLOB_BYTES
  ) {
    throw new TransactionRecordInvalidError();
  }
  const createdAt = validIsoString(value.createdAt);
  const updatedAt = validIsoString(value.updatedAt);
  const checksum = stringValue(value.checksum);
  const unsigned = {
    schemaVersion: 1 as const,
    transactionId: expectedId,
    kind,
    phase,
    scope,
    blobs,
    createdAt,
    updatedAt
  };
  if (!SHA256.test(checksum) || checksum !== (await sha256Text(canonicalJson(unsigned)))) {
    throw new TransactionRecordInvalidError();
  }
  const manifest = { ...unsigned, checksum };
  if (text !== serializeCanonical(manifest)) throw new TransactionRecordInvalidError();
  return manifest;
}

async function parseReceipt(
  text: string,
  transaction: OpenedTransaction,
  expected: TransactionReceiptPlan
): Promise<ReceiptData> {
  const value = parseObject(text);
  exactKeys(value, [
    "schemaVersion",
    "transactionId",
    "manifestChecksum",
    "aggregateDigest",
    "pair",
    "historyHashes",
    "checksum"
  ]);
  if (value.schemaVersion !== 1 || value.transactionId !== transaction.record.id) {
    throw new TransactionReceiptInvalidError();
  }
  const plan = validReceiptPlan({
    pair: value.pair as TransactionReceiptPlan["pair"],
    historyHashes: value.historyHashes as string[]
  });
  const manifestChecksum = stringValue(value.manifestChecksum);
  const aggregateDigest = stringValue(value.aggregateDigest);
  const checksum = stringValue(value.checksum);
  const unsigned = {
    schemaVersion: 1 as const,
    transactionId: transaction.record.id,
    manifestChecksum,
    aggregateDigest,
    pair: plan.pair,
    historyHashes: [...plan.historyHashes]
  };
  const receipt = { ...unsigned, checksum };
  if (
    !SHA256.test(manifestChecksum) ||
    !SHA256.test(aggregateDigest) ||
    !SHA256.test(checksum) ||
    manifestChecksum !== transaction.record.checksum ||
    aggregateDigest !== transaction.aggregateDigest ||
    checksum !== (await sha256Text(canonicalJson(unsigned))) ||
    canonicalJson(plan) !== canonicalJson(expected) ||
    text !== serializeCanonical(receipt)
  ) {
    throw new TransactionReceiptInvalidError();
  }
  return receipt;
}

function validScope(scope: TransactionScope): TransactionScope {
  const value = objectValue(scope);
  const allowed = ["pair", ...(value.historyDocumentId === undefined ? [] : ["historyDocumentId"] )];
  exactKeys(value, allowed);
  const pair = objectValue(value.pair);
  exactKeys(pair, ["html", "sidecar"]);
  const html = canonicalVaultPath(stringValue(pair.html));
  const sidecar = canonicalVaultPath(stringValue(pair.sidecar));
  if (html.length > MAX_SCOPE_PATH || sidecar.length > MAX_SCOPE_PATH || html === sidecar) {
    throw new TransactionRecordInvalidError();
  }
  const historyDocumentId = value.historyDocumentId;
  return {
    pair: { html, sidecar },
    ...(historyDocumentId === undefined
      ? {}
      : { historyDocumentId: canonicalUuid(stringValue(historyDocumentId)) })
  };
}

function validBlobInputs(inputs: readonly TransactionBlobInput[]): TransactionBlobInput[] {
  if (!Array.isArray(inputs) || inputs.length > TRANSACTION_BLOB_ROLES.length) {
    throw new TransactionRecordInvalidError();
  }
  const seen = new Set<TransactionBlobRole>();
  let total = 0;
  const checked = inputs.map((input) => {
    const value = objectValue(input);
    exactKeys(value, ["role", "text"]);
    const role = validRole(value.role);
    const text = stringValue(value.text);
    const bytes = new TextEncoder().encode(text).byteLength;
    if (seen.has(role) || bytes > MAX_BLOB_BYTES) throw new TransactionRecordInvalidError();
    seen.add(role);
    total += bytes;
    return { role, text };
  });
  if (total > MAX_TOTAL_BLOB_BYTES) throw new TransactionRecordInvalidError();
  return checked.sort((left, right) => compareText(left.role, right.role));
}

function validReceiptPlan(plan: TransactionReceiptPlan): TransactionReceiptPlan {
  const value = objectValue(plan);
  exactKeys(value, ["pair", "historyHashes"]);
  const pair = objectValue(value.pair);
  exactKeys(pair, ["htmlPath", "sidecarPath", "htmlHash", "sidecarHash"]);
  const htmlPath = canonicalVaultPath(stringValue(pair.htmlPath));
  const sidecarPath = canonicalVaultPath(stringValue(pair.sidecarPath));
  const htmlHash = stringValue(pair.htmlHash);
  const sidecarHash = stringValue(pair.sidecarHash);
  if (!SHA256.test(htmlHash) || !SHA256.test(sidecarHash)) {
    throw new TransactionReceiptInvalidError();
  }
  if (!Array.isArray(value.historyHashes) || value.historyHashes.length > 256) {
    throw new TransactionReceiptInvalidError();
  }
  const historyHashes = value.historyHashes.map(stringValue);
  if (historyHashes.some((hash) => !SHA256.test(hash))) {
    throw new TransactionReceiptInvalidError();
  }
  return {
    pair: { htmlPath, sidecarPath, htmlHash, sidecarHash },
    historyHashes
  };
}

async function signed<T extends Record<string, unknown>>(
  value: T
): Promise<T & { checksum: string }> {
  return { ...value, checksum: await sha256Text(canonicalJson(value)) };
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
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TransactionRecordInvalidError();
  }
}

function validKind(value: unknown): TransactionKind {
  if (typeof value !== "string" || !TRANSACTION_KINDS.includes(value as TransactionKind)) {
    throw new TransactionRecordInvalidError();
  }
  return value as TransactionKind;
}

function validPhase(value: unknown): TransactionPhase {
  if (typeof value !== "string" || !isPhase(value)) {
    throw new TransactionRecordInvalidError();
  }
  return value;
}

function isPhase(value: string): value is TransactionPhase {
  return TRANSACTION_PHASES.includes(value as TransactionPhase);
}

function validRole(value: unknown): TransactionBlobRole {
  if (
    typeof value !== "string" ||
    !TRANSACTION_BLOB_ROLES.includes(value as TransactionBlobRole)
  ) {
    throw new TransactionRecordInvalidError();
  }
  return value as TransactionBlobRole;
}

function canonicalUuid(value: string): string {
  const canonical = value.toLowerCase();
  if (!UUID.test(canonical)) throw new TransactionRecordInvalidError();
  return canonical;
}

function requireCanonicalUuid(value: string): string {
  if (!UUID.test(value)) throw new TransactionRecordInvalidError();
  return value;
}

function transactionFolder(id: string): string {
  return `${TRANSACTION_ROOT}/${requireCanonicalUuid(id)}`;
}

function validTimestamp(date: Date): string {
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new TransactionRecordInvalidError();
  return date.toISOString();
}

function validIsoString(value: unknown): string {
  const text = stringValue(value);
  if (text.length > 64 || new Date(text).toISOString() !== text) {
    throw new TransactionRecordInvalidError();
  }
  return text;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new TransactionRecordInvalidError();
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new TransactionRecordInvalidError();
  return value;
}

function sameScope(left: TransactionScope, right: TransactionScope): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sameOwned(
  left: VaultOwnedFile | null,
  right: VaultOwnedFile
): boolean {
  return (
    left !== null &&
    left.path === right.path &&
    left.identity === right.identity &&
    left.text === right.text &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.stat.ctime === right.stat.ctime &&
    left.stat.mtime === right.stat.mtime &&
    left.stat.size === right.stat.size
  );
}

function sameOwnedList(
  left: readonly VaultOwnedFile[],
  right: readonly VaultOwnedFile[]
): boolean {
  return (
    left.length === right.length &&
    left.every((owned, index) => sameOwned(owned, right[index]!))
  );
}

function snapshotOf(opened: OpenedTransaction): AggregateSnapshot {
  return {
    digest: opened.aggregateDigest,
    manifestOwnership: opened.manifestOwnership,
    blobOwnerships: opened.blobs.map(({ ownership }) => ownership)
  };
}

function sameAggregate(
  left: OpenedTransaction,
  right: OpenedTransaction
): boolean {
  return sameAggregateSnapshot(snapshotOf(left), snapshotOf(right));
}

function sameAggregateSnapshot(
  left: AggregateSnapshot,
  right: AggregateSnapshot
): boolean {
  return (
    left.digest === right.digest &&
    sameOwned(left.manifestOwnership, right.manifestOwnership) &&
    sameOwnedList(left.blobOwnerships, right.blobOwnerships)
  );
}

async function transactionAggregateDigest(
  manifest: VaultOwnedFile,
  blobs: readonly VaultOwnedFile[]
): Promise<string> {
  return sha256Text(
    canonicalJson({
      schemaVersion: 1,
      manifest: aggregateEvidence(manifest),
      blobs: blobs.map(aggregateEvidence)
    })
  );
}

function aggregateEvidence(owned: VaultOwnedFile): Record<string, unknown> {
  return {
    path: owned.path,
    sha256: owned.sha256,
    byteLength: owned.byteLength,
    stat: {
      ctime: owned.stat.ctime,
      mtime: owned.stat.mtime,
      size: owned.stat.size
    }
  };
}

function isVaultReadUnstable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "vault_file_read_unstable"
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
