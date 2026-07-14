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
  readonly ownership: VaultOwnedFile;
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
  readonly manifestOwnership: VaultOwnedFile;
  readonly folderOwnership: VaultOwnedFolder;
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
  readonly checksum: string;
  readonly ownership: VaultOwnedFile;
}

export interface ObsidianTransactionStoreOptions {
  readonly randomUUID?: () => string;
  readonly now?: () => Date;
  readonly maxPrepareAttempts?: number;
}

export class TransactionRecordInvalidError extends Error {
  readonly code = "transaction_record_invalid";

  constructor() {
    super("Galley transaction storage contains an invalid or drifted record.");
    this.name = "TransactionRecordInvalidError";
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

  constructor(readonly operation: unknown) {
    super("Galley could not prove the transaction metadata mutation outcome.");
    this.name = "TransactionWriteAmbiguousError";
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
  checksum: string;
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

  constructor(
    private readonly files: ObsidianVaultFileStore,
    options: ObsidianTransactionStoreOptions = {}
  ) {
    this.#randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
    this.#maxPrepareAttempts = options.maxPrepareAttempts ?? 128;
    if (
      !Number.isSafeInteger(this.#maxPrepareAttempts) ||
      this.#maxPrepareAttempts < 1 ||
      this.#maxPrepareAttempts > 1024
    ) {
      throw new Error("Galley transaction prepare attempts are invalid.");
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
        throw new TransactionWriteAmbiguousError(folderResult);
      }

      const ownedBlobs: StoredTransactionBlob[] = [];
      try {
        for (const blob of blobs) {
          throwIfAborted(signal);
          const filename = BLOB_FILENAMES[blob.role];
          const path = `${folderPath}/${filename}`;
          const result = await this.files.createExclusive(path, blob.text, signal);
          if (result.status !== "created") {
            if (result.status === "ambiguous") {
              throw new TransactionWriteAmbiguousError(result);
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
        const manifest = await signed(unsigned);
        const result = await this.files.createExclusive(
          `${folderPath}/${MANIFEST_NAME}`,
          serializeCanonical(manifest),
          signal
        );
        if (result.status !== "created") {
          if (result.status === "ambiguous") {
            throw new TransactionWriteAmbiguousError(result);
          }
          throw new TransactionWriteConflictError();
        }
        return await this.open(id, signal);
      } catch (error) {
        await this.#cleanupIncomplete(ownedBlobs, folderResult.folder);
        throw error;
      }
    }
    throw new Error("Galley could not allocate a unique transaction folder.");
  }

  async open(id: string, signal?: AbortSignal): Promise<TransactionRecord> {
    const canonicalId = requireCanonicalUuid(id);
    try {
      return await this.#openStrict(canonicalId, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      await this.#quarantineBestEffort(canonicalId, "record-invalid");
      if (error instanceof TransactionRecordInvalidError) throw error;
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
    if (NEXT_PHASE[record.phase] !== next || !isPhase(next)) {
      throw new TransactionPhaseInvalidError();
    }
    throwIfAborted(signal);
    const current = await this.#openStrict(requireCanonicalUuid(record.id), signal);
    if (!sameOwned(current.manifestOwnership, record.manifestOwnership)) {
      throw new TransactionWriteConflictError();
    }
    const manifest = await signed({
      schemaVersion: 1 as const,
      transactionId: current.id,
      kind: current.kind,
      phase: next,
      scope: current.scope,
      blobs: current.blobs.map(({ role, filename, byteLength, sha256 }) => ({
        role,
        filename,
        byteLength,
        sha256
      })),
      createdAt: current.createdAt,
      updatedAt: validTimestamp(this.#now())
    });
    const result = await this.files.modifyOwned(
      record.manifestOwnership,
      serializeCanonical(manifest),
      signal
    );
    if (result.status === "conflict") throw new TransactionWriteConflictError();
    if (result.status === "ambiguous") {
      await this.#quarantineBestEffort(record.id, "write-ambiguous");
      throw new TransactionWriteAmbiguousError(result);
    }
    return await this.open(record.id, signal);
  }

  async writeReceipt(
    record: TransactionRecord,
    plan: TransactionReceiptPlan,
    signal?: AbortSignal
  ): Promise<VerifiedTransactionReceipt> {
    const current = await this.#openStrict(requireCanonicalUuid(record.id), signal);
    if (!sameOwned(current.manifestOwnership, record.manifestOwnership)) {
      throw new TransactionWriteConflictError();
    }
    const checked = validReceiptPlan(plan);
    if (
      checked.pair.htmlPath !== record.scope.pair.html ||
      checked.pair.sidecarPath !== record.scope.pair.sidecar
    ) {
      throw new TransactionReceiptInvalidError();
    }
    const receipt = await signed({
      schemaVersion: 1 as const,
      transactionId: record.id,
      pair: checked.pair,
      historyHashes: [...checked.historyHashes]
    });
    const path = `${transactionFolder(record.id)}/${RECEIPT_NAME}`;
    const result = await this.files.createExclusive(path, serializeCanonical(receipt), signal);
    if (result.status === "ambiguous") throw new TransactionWriteAmbiguousError(result);
    if (result.status === "collision") return await this.verifyReceipt(record, checked, signal);
    return { ...receipt, ownership: result.file };
  }

  async verifyReceipt(
    record: TransactionRecord,
    expected: TransactionReceiptPlan,
    signal?: AbortSignal
  ): Promise<VerifiedTransactionReceipt> {
    try {
      const plan = validReceiptPlan(expected);
      if (
        plan.pair.htmlPath !== record.scope.pair.html ||
        plan.pair.sidecarPath !== record.scope.pair.sidecar
      ) {
        throw new TransactionReceiptInvalidError();
      }
      const path = `${transactionFolder(requireCanonicalUuid(record.id))}/${RECEIPT_NAME}`;
      const owned = await this.files.readTextStable(path, signal);
      if (!owned || owned.byteLength > MAX_MANIFEST_BYTES) {
        throw new TransactionReceiptInvalidError();
      }
      const value = parseObject(owned.text);
      exactKeys(value, [
        "schemaVersion",
        "transactionId",
        "pair",
        "historyHashes",
        "checksum"
      ]);
      if (value.schemaVersion !== 1 || value.transactionId !== record.id) {
        throw new TransactionReceiptInvalidError();
      }
      const parsedPlan = validReceiptPlan({
        pair: value.pair as TransactionReceiptPlan["pair"],
        historyHashes: value.historyHashes as string[]
      });
      const checksum = stringValue(value.checksum);
      const unsigned = {
        schemaVersion: 1 as const,
        transactionId: record.id,
        pair: parsedPlan.pair,
        historyHashes: [...parsedPlan.historyHashes]
      };
      if (
        !SHA256.test(checksum) ||
        checksum !== (await sha256Text(canonicalJson(unsigned))) ||
        canonicalJson(parsedPlan) !== canonicalJson(plan)
      ) {
        throw new TransactionReceiptInvalidError();
      }
      return { ...unsigned, checksum, ownership: owned };
    } catch (error) {
      await this.#quarantineBestEffort(record.id, "receipt-invalid");
      if (error instanceof TransactionReceiptInvalidError) throw error;
      throw new TransactionReceiptInvalidError();
    }
  }

  async cleanup(
    record: TransactionRecord,
    signal?: AbortSignal
  ): Promise<{ status: "cleaned" | "conflict" | "ambiguous" }> {
    if (record.phase !== "completed") throw new TransactionPhaseInvalidError();
    throwIfAborted(signal);
    const known: VaultOwnedFile[] = [
      record.manifestOwnership,
      ...record.blobs.map(({ ownership }) => ownership)
    ];
    for (const owned of known) {
      const current = await this.files.readTextStable(owned.path, signal);
      if (!sameOwned(current, owned)) return { status: "conflict" };
    }
    const folderPath = transactionFolder(record.id);
    const allowed = new Set([
      MANIFEST_NAME,
      RECEIPT_NAME,
      QUARANTINE_NAME,
      ...record.blobs.map(({ role }) => BLOB_FILENAMES[role])
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
    for (const owned of [...record.blobs.map(({ ownership }) => ownership), ...optional, record.manifestOwnership]) {
      const result = await this.files.removeOwned(owned, signal);
      if (result.status === "conflict") return { status: "conflict" };
      if (result.status === "ambiguous") return { status: "ambiguous" };
    }
    const folder = await this.files.removeEmptyFolderOwned(record.folderOwnership, signal);
    return folder.status === "removed"
      ? { status: "cleaned" }
      : folder.status === "conflict"
        ? { status: "conflict" }
        : { status: "ambiguous" };
  }

  async #openStrict(id: string, signal?: AbortSignal): Promise<TransactionRecord> {
    const folderPath = transactionFolder(id);
    const manifestOwned = await this.files.readTextStable(
      `${folderPath}/${MANIFEST_NAME}`,
      signal
    );
    if (!manifestOwned || manifestOwned.byteLength > MAX_MANIFEST_BYTES) {
      throw new TransactionRecordInvalidError();
    }
    const manifest = await parseManifest(manifestOwned.text, id);
    const storedBlobs: StoredTransactionBlob[] = [];
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
    const folderEntry = rootEntries.find(
      ({ path, kind }) => path === folderPath && kind === "folder"
    );
    if (!folderEntry) throw new TransactionRecordInvalidError();
    return {
      schemaVersion: 1,
      id,
      kind: manifest.kind,
      phase: manifest.phase,
      scope: manifest.scope,
      blobs: storedBlobs,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      checksum: manifest.checksum,
      manifestOwnership: manifestOwned,
      folderOwnership: {
        path: folderPath,
        identity: folderEntry.identity as VaultOwnedFolder["identity"]
      }
    };
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
    blobs: readonly StoredTransactionBlob[],
    folder: VaultOwnedFolder
  ): Promise<void> {
    for (const blob of [...blobs].reverse()) {
      await this.files.removeOwned(blob.ownership).catch(() => undefined);
    }
    await this.files.removeEmptyFolderOwned(folder).catch(() => undefined);
  }
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
  return { ...unsigned, checksum };
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
    left.byteLength === right.byteLength
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
