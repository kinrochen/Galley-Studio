import { GalleySidecarV1Schema } from "./GalleySidecar";

export interface HistoryFile<Observation> {
  path: string;
  html: string;
  observation: Observation;
}

export type HistoryRetentionResult<Observation> =
  | { status: "created"; file: HistoryFile<Observation> }
  | { status: "collision" }
  | { status: "conflict" }
  | { status: "ownership-conflict" }
  | { status: "lost" };

export interface HistoryCommitPlan<Observation> {
  readonly provisional: HistoryFile<Observation>;
  readonly finalPath: string;
  readonly observedFiles: readonly HistoryFile<Observation>[];
  readonly removals: readonly HistoryFile<Observation>[];
}

export interface HistoryVault<Observation> {
  ensureFolder(path: string, signal?: AbortSignal): Promise<void>;
  listFiles(
    folder: string,
    signal?: AbortSignal
  ): Promise<readonly HistoryFile<Observation>[]>;
  createFileExclusive(
    path: string,
    html: string,
    signal?: AbortSignal
  ): Promise<
    | { status: "created"; file: HistoryFile<Observation> }
    | { status: "collision" }
  >;
  /**
   * Durably promotes one provisional file and conditionally removes the
   * observed retention candidates as one recoverable transaction. Repeating
   * the same provisional handle after an interrupted call is idempotent.
   */
  applyRetentionTransaction(
    provisional: HistoryFile<Observation>,
    finalPath: string,
    observedFiles: readonly HistoryFile<Observation>[],
    removals: readonly HistoryFile<Observation>[],
    signal?: AbortSignal
  ): Promise<HistoryRetentionResult<Observation>>;
  /** Registers cleanup durably before removing a provisional file. */
  rollbackPrepared(file: HistoryFile<Observation>): Promise<boolean>;
  acknowledgeRetention(provisional: HistoryFile<Observation>): Promise<void>;
}

export interface HistorySnapshot {
  path: string;
  html: string;
  timestamp: string;
}

export interface HistoryRepositoryOptions {
  randomUUID?: () => string;
}

export class HistoryPruneConflictError extends Error {
  readonly code = "history_prune_conflict";

  constructor() {
    super("A Galley history snapshot changed while it was being pruned.");
    this.name = "HistoryPruneConflictError";
  }
}

const PREPARED = Symbol("PreparedHistorySnapshot");

type PreparationState = "pending" | "committed" | "rolled-back";

interface PreparationData<Observation> {
  readonly repository: symbol;
  readonly folder: string;
  readonly timestampMs: number;
  file: HistoryFile<Observation>;
  state: PreparationState;
}

export interface PreparedHistorySnapshot {
  readonly documentId: string;
  readonly html: string;
  readonly [PREPARED]: PreparationData<unknown>;
}

const HISTORY_ROOT = ".galley/history";
const TIMESTAMP_WIDTH = 16;
const SEQUENCE_WIDTH = 8;
const MAX_RETENTION_RETRIES = 128;

export class HistoryRepository<Observation> {
  readonly #identity = Symbol("HistoryRepository");
  readonly #randomUUID: () => string;
  readonly #queues = new Map<string, Promise<void>>();
  #sequence = 0;

  constructor(
    private readonly vault: HistoryVault<Observation>,
    private readonly limit = 20,
    options: HistoryRepositoryOptions = {}
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Galley history limit must be a positive integer.");
    }
    this.#randomUUID =
      options.randomUUID ?? (() => window.crypto.randomUUID());
  }

  async prepare(
    documentId: string,
    html: string,
    timestamp: Date,
    signal?: AbortSignal
  ): Promise<PreparedHistorySnapshot> {
    const canonicalId = canonicalDocumentId(documentId);
    const folder = `${HISTORY_ROOT}/${canonicalId}`;
    const timestampMs = validTimestamp(timestamp);
    throwIfAborted(signal);
    await this.vault.ensureFolder(folder, signal);

    while (true) {
      throwIfAborted(signal);
      const path = `${folder}/${this.#newSnapshotStem(timestampMs)}.pending`;
      const result = await this.vault.createFileExclusive(path, html, signal);
      if (result.status === "collision") continue;
      const data: PreparationData<Observation> = {
        repository: this.#identity,
        folder,
        timestampMs,
        file: result.file,
        state: "pending"
      };
      return {
        documentId: canonicalId,
        html,
        [PREPARED]: data
      };
    }
  }

  async commit(
    prepared: PreparedHistorySnapshot,
    signal?: AbortSignal
  ): Promise<HistorySnapshot> {
    const data = this.#preparationData(prepared);
    if (data.state === "committed") {
      const snapshot = parseSnapshotFile(data.folder, data.file);
      if (!snapshot) throw new Error("Committed Galley history path is invalid.");
      return snapshot;
    }
    if (data.state !== "pending") {
      throw new Error("Galley history preparation is no longer active.");
    }

    try {
      return await this.#serialize(data.folder, async () => {
        for (let attempt = 0; attempt < MAX_RETENTION_RETRIES; attempt += 1) {
          const plan = await this.plan(prepared, signal);
          const result = await this.vault.applyRetentionTransaction(
            plan.provisional,
            plan.finalPath,
            plan.observedFiles,
            plan.removals,
            signal
          );
          if (result.status === "collision" || result.status === "conflict") {
            continue;
          }
          if (result.status === "ownership-conflict") {
            throw new HistoryPruneConflictError();
          }
          if (result.status === "lost") throw new HistoryPruneConflictError();

          data.file = result.file;
          data.state = "committed";
          await this.#acknowledge(plan.provisional);
          const snapshot = parseSnapshotFile(data.folder, data.file);
          if (!snapshot) {
            throw new Error("Committed Galley history path is invalid.");
          }
          return snapshot;
        }
        throw new Error("Galley history retention did not converge.");
      });
    } catch (error) {
      try {
        await this.rollback(prepared);
      } catch {
        // rollbackPrepared registered its own durable recovery before throwing.
      }
      throw error;
    }
  }

  async rollback(prepared: PreparedHistorySnapshot): Promise<void> {
    const data = this.#preparationData(prepared);
    if (data.state === "committed" || data.state === "rolled-back") return;
    if (await this.vault.rollbackPrepared(data.file)) {
      data.state = "rolled-back";
    }
  }

  async plan(
    prepared: PreparedHistorySnapshot,
    signal?: AbortSignal
  ): Promise<HistoryCommitPlan<Observation>> {
    const data = this.#preparationData(prepared);
    if (data.state !== "pending") {
      throw new Error("Galley history preparation is no longer active.");
    }
    throwIfAborted(signal);
    const finalPath = `${data.folder}/${this.#newSnapshotStem(
      data.timestampMs
    )}.html`;
    const observedFiles = await this.vault.listFiles(data.folder, signal);
    const files = parsedFiles(data.folder, observedFiles);
    const removeCount = Math.max(0, files.length + 1 - this.limit);
    return {
      provisional: data.file,
      finalPath,
      observedFiles,
      removals: files.slice(0, removeCount).map(({ file }) => file)
    };
  }

  async store(
    documentId: string,
    html: string,
    timestamp: Date,
    signal?: AbortSignal
  ): Promise<HistorySnapshot> {
    const prepared = await this.prepare(documentId, html, timestamp, signal);
    try {
      return await this.commit(prepared, signal);
    } catch (error) {
      try {
        await this.rollback(prepared);
      } catch {
        // rollbackPrepared registered its own durable recovery before throwing.
      }
      throw error;
    }
  }

  async list(
    documentId: string,
    signal?: AbortSignal
  ): Promise<HistorySnapshot[]> {
    const folder = `${HISTORY_ROOT}/${canonicalDocumentId(documentId)}`;
    throwIfAborted(signal);
    const files = await this.vault.listFiles(folder, signal);
    throwIfAborted(signal);
    return parsedFiles(folder, files).map(({ snapshot }) => snapshot);
  }

  #newSnapshotStem(timestampMs: number): string {
    const uniqueId = canonicalDocumentId(this.#randomUUID());
    this.#sequence += 1;
    return `${String(timestampMs).padStart(TIMESTAMP_WIDTH, "0")}-${uniqueId}-${String(
      this.#sequence
    ).padStart(SEQUENCE_WIDTH, "0")}`;
  }

  #preparationData(
    prepared: PreparedHistorySnapshot
  ): PreparationData<Observation> {
    const data = prepared[PREPARED] as PreparationData<Observation>;
    if (data.repository !== this.#identity) {
      throw new Error("Galley history preparation belongs to another repository.");
    }
    return data;
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

  async #acknowledge(provisional: HistoryFile<Observation>): Promise<void> {
    try {
      await this.vault.acknowledgeRetention(provisional);
    } catch {
      // Receipts are compacted against visible history on later adapter entry.
    }
  }
}

interface ParsedHistoryFile<Observation> {
  file: HistoryFile<Observation>;
  timestampMs: number;
  snapshot: HistorySnapshot;
}

function parsedFiles<Observation>(
  folder: string,
  files: readonly HistoryFile<Observation>[]
): ParsedHistoryFile<Observation>[] {
  return files
    .map((file) => parseHistoryFile(folder, file))
    .filter((value): value is ParsedHistoryFile<Observation> => value !== null)
    .sort(
      (left, right) =>
        left.timestampMs - right.timestampMs ||
        comparePaths(left.snapshot.path, right.snapshot.path)
    );
}

function parseSnapshotFile<Observation>(
  folder: string,
  file: HistoryFile<Observation>
): HistorySnapshot | null {
  return parseHistoryFile(folder, file)?.snapshot ?? null;
}

function parseHistoryFile<Observation>(
  folder: string,
  file: HistoryFile<Observation>
): ParsedHistoryFile<Observation> | null {
  const prefix = `${folder}/`;
  if (!file.path.startsWith(prefix)) return null;
  const name = file.path.slice(prefix.length);
  if (name.includes("/")) return null;
  const match = new RegExp(
    `^([0-9]{${TIMESTAMP_WIDTH}})-([0-9a-f-]{36})-([0-9]{${SEQUENCE_WIDTH},})\\.html$`
  ).exec(name);
  if (!match?.[1] || !match[2]) return null;
  try {
    canonicalDocumentId(match[2]);
  } catch {
    return null;
  }
  const timestampMs = Number(match[1]);
  if (!Number.isSafeInteger(timestampMs)) return null;
  const timestamp = new Date(timestampMs);
  if (Number.isNaN(timestamp.getTime())) return null;
  return {
    file,
    timestampMs,
    snapshot: {
      path: file.path,
      html: file.html,
      timestamp: timestamp.toISOString()
    }
  };
}

function canonicalDocumentId(documentId: string): string {
  try {
    return GalleySidecarV1Schema.shape.documentId.parse(documentId).toLowerCase();
  } catch {
    throw new Error("Galley history document ID must be a sidecar-valid UUID.");
  }
}

function validTimestamp(timestamp: Date): number {
  const milliseconds = timestamp.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Galley history timestamp must be a valid non-negative date.");
  }
  return milliseconds;
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
