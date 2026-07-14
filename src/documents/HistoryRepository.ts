export interface HistoryFile<Observation> {
  path: string;
  html: string;
  observation: Observation;
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
  removeObserved(
    file: HistoryFile<Observation>,
    signal?: AbortSignal
  ): Promise<boolean>;
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

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PATTERN = DOCUMENT_ID_PATTERN;
const HISTORY_ROOT = ".galley/history";
const TIMESTAMP_WIDTH = 16;
const SEQUENCE_WIDTH = 8;

export class HistoryRepository<Observation> {
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
      options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  }

  async store(
    documentId: string,
    html: string,
    timestamp: Date,
    signal?: AbortSignal
  ): Promise<HistorySnapshot> {
    const folder = historyFolder(documentId);
    const milliseconds = timestamp.getTime();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error("Galley history timestamp must be a valid non-negative date.");
    }
    throwIfAborted(signal);

    return this.#serialize(documentId, async () => {
      throwIfAborted(signal);
      await this.vault.ensureFolder(folder, signal);
      throwIfAborted(signal);

      let created: HistoryFile<Observation>;
      while (true) {
        const uniqueId = this.#randomUUID();
        if (!UUID_PATTERN.test(uniqueId)) {
          throw new Error("Galley history UUID must be a lowercase UUID.");
        }
        this.#sequence += 1;
        const path = `${folder}/${snapshotFileName(
          milliseconds,
          uniqueId,
          this.#sequence
        )}`;
        const result = await this.vault.createFileExclusive(path, html, signal);
        if (result.status === "created") {
          created = result.file;
          break;
        }
        throwIfAborted(signal);
      }

      await this.#prune(folder, signal);
      const parsed = parseSnapshotFile(folder, created);
      if (!parsed) {
        throw new Error("Created Galley history snapshot has an invalid path.");
      }
      return parsed;
    });
  }

  async list(
    documentId: string,
    signal?: AbortSignal
  ): Promise<HistorySnapshot[]> {
    const folder = historyFolder(documentId);
    throwIfAborted(signal);
    const files = await this.vault.listFiles(folder, signal);
    throwIfAborted(signal);
    return parsedFiles(folder, files).map(({ snapshot }) => snapshot);
  }

  async #prune(folder: string, signal?: AbortSignal): Promise<void> {
    const files = parsedFiles(
      folder,
      await this.vault.listFiles(folder, signal)
    );
    const removeCount = Math.max(0, files.length - this.limit);
    for (let index = 0; index < removeCount; index += 1) {
      throwIfAborted(signal);
      const candidate = files[index];
      if (!candidate) continue;
      if (!(await this.vault.removeObserved(candidate.file, signal))) {
        throw new HistoryPruneConflictError();
      }
    }
  }

  async #serialize<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(documentId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#queues.set(documentId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#queues.get(documentId) === current) {
        this.#queues.delete(documentId);
      }
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

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
  if (!match?.[1] || !match[2] || !UUID_PATTERN.test(match[2])) return null;
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

function snapshotFileName(
  timestampMs: number,
  uniqueId: string,
  sequence: number
): string {
  return `${String(timestampMs).padStart(TIMESTAMP_WIDTH, "0")}-${uniqueId}-${String(
    sequence
  ).padStart(SEQUENCE_WIDTH, "0")}.html`;
}

function historyFolder(documentId: string): string {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new Error("Galley history document ID must be a lowercase UUID.");
  }
  return `${HISTORY_ROOT}/${documentId}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
