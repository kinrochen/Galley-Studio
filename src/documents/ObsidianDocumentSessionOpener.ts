import type { Vault } from "obsidian";

import {
  DocumentCommitAmbiguousError,
  GalleyDocumentRepository,
  type ArtifactPaths
} from "./GalleyDocumentRepository";
import { DocumentSession, type SaveReason } from "./DocumentSession";
import {
  GalleyDocumentMissingError,
  GalleyDocumentAmbiguousError,
  GalleyDocumentOpenUnstableError,
  GalleyDocumentQuarantinedError,
  GalleyHistorySnapshotNotFoundError,
  galleyArtifactPaths,
  type DocumentRecoveryInspection,
  type DocumentRecoveryState,
  type DocumentSessionOpener,
  type OpenedGalleyDocumentSession
} from "./DocumentSessionOpener";
import { GalleyDocumentCodec } from "./GalleyDocumentCodec";
import { GalleySidecarV1Schema } from "./GalleySidecar";
import {
  HistoryRepository,
  type HistoryRepositoryOptions,
  type HistorySnapshot
} from "./HistoryRepository";
import {
  ObsidianWorkbenchAmbiguousError,
  ObsidianWorkbenchRecoveryConflictError,
  ObsidianWorkbenchVault,
  type ObsidianHistoryObservation,
  type ObsidianPairObservation,
  type ObsidianPairOwnership,
  type ObsidianWorkbenchVaultOptions
} from "./ObsidianWorkbenchVault";
import {
  TransactionReceiptInvalidError,
  TransactionRecordInvalidError,
  TransactionRecordUnstableError
} from "./ObsidianTransactionStore";
import type { GalleyExportRecordV1 } from "../export/ExportRecord";
import {
  isSingleHtmlPath,
  ObsidianSingleHtmlDocumentSessionOpener
} from "./ObsidianSingleHtmlDocumentSession";

const MAX_OPEN_ATTEMPTS = 8;

type ProductionRepository = GalleyDocumentRepository<
  ObsidianPairObservation,
  ObsidianPairOwnership,
  ObsidianHistoryObservation
>;

type ProductionSession = DocumentSession<
  ObsidianPairObservation,
  ObsidianPairOwnership,
  ObsidianHistoryObservation
>;

export interface ObsidianDocumentSessionOpenerOptions {
  readonly historyLimit?: number;
  readonly historyOptions?: HistoryRepositoryOptions;
  readonly vaultOptions?: ObsidianWorkbenchVaultOptions;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
}

/**
 * Plugin-scoped production composition root. One instance intentionally shares
 * one durable adapter, repository and history repository across every opened
 * document session.
 */
export class ObsidianDocumentSessionOpener implements DocumentSessionOpener {
  readonly #repository: ProductionRepository;
  readonly #history: HistoryRepository<ObsidianHistoryObservation>;
  readonly #sessionOptions: Pick<
    ObsidianDocumentSessionOpenerOptions,
    "now" | "randomUUID"
  >;
  readonly #single: ObsidianSingleHtmlDocumentSessionOpener;

  constructor(vault: Vault, options: ObsidianDocumentSessionOpenerOptions = {}) {
    this.#single = new ObsidianSingleHtmlDocumentSessionOpener(vault);
    const adapter = new ObsidianWorkbenchVault(vault, options.vaultOptions);
    this.#repository = new GalleyDocumentRepository(adapter);
    this.#history = new HistoryRepository(
      adapter,
      options.historyLimit ?? 20,
      options.historyOptions
    );
    this.#sessionOptions = {
      ...(options.now ? { now: options.now } : {}),
      ...(options.randomUUID ? { randomUUID: options.randomUUID } : {})
    };
  }

  async open(
    htmlPath: string,
    signal?: AbortSignal
  ): Promise<OpenedGalleyDocumentSession> {
    if (isSingleHtmlPath(htmlPath)) return this.#single.open(htmlPath, signal);
    const paths = galleyArtifactPaths(htmlPath);
    try {
      for (let attempt = 0; attempt < MAX_OPEN_ATTEMPTS; attempt += 1) {
        throwIfAborted(signal);
        const before = await this.#repository.readPair(paths, signal);
        if (!before) throw new GalleyDocumentMissingError(paths);
        const sidecar = parseSidecar(before.sidecarJson);
        const session = await DocumentSession.open(
          {
            repository: this.#repository,
            history: this.#history,
            htmlPath: paths.html,
            sidecarPath: paths.sidecar,
            ...this.#sessionOptions
          },
          signal
        );
        const after = await this.#repository.readPair(paths, signal);
        if (
          after &&
          before.sidecarJson === after.sidecarJson &&
          this.#repository.sameObservation(
            before.observation,
            after.observation
          ) &&
          session.state().htmlHash === before.htmlHash
        ) {
          return new ObsidianOpenedDocumentSession(
            session,
            this.#history,
            this.#repository,
            sidecar.documentId
          );
        }
      }
      throw new GalleyDocumentOpenUnstableError(paths);
    } catch (error) {
      const recovery = recoveryStateFromError(error);
      if (recovery?.status === "quarantined") {
        throw new GalleyDocumentQuarantinedError(paths, recovery, error);
      }
      if (recovery?.status === "ambiguous") {
        throw new GalleyDocumentAmbiguousError(paths, recovery, error);
      }
      throw error;
    }
  }

  async inspectRecovery(
    htmlPath: string,
    signal?: AbortSignal
  ): Promise<DocumentRecoveryInspection> {
    if (isSingleHtmlPath(htmlPath)) {
      return this.#single.inspectRecovery(htmlPath, signal);
    }
    const paths = galleyArtifactPaths(htmlPath);
    try {
      const pair = await this.#repository.readPair(paths, signal);
      return {
        paths,
        pair: pair ? "present" : "missing",
        recovery: { status: "ready" }
      };
    } catch (error) {
      const recovery = recoveryStateFromError(error);
      if (recovery) return { paths, pair: "unknown", recovery };
      throw error;
    }
  }
}

class ObsidianOpenedDocumentSession implements OpenedGalleyDocumentSession {
  #recovery: DocumentRecoveryState = { status: "ready" };
  readonly #session: ProductionSession;
  readonly #historyRepository: HistoryRepository<ObsidianHistoryObservation>;
  readonly #repository: ProductionRepository;
  #id: string;

  constructor(
    session: ProductionSession,
    historyRepository: HistoryRepository<ObsidianHistoryObservation>,
    repository: ProductionRepository,
    id: string
  ) {
    this.#session = session;
    this.#historyRepository = historyRepository;
    this.#repository = repository;
    this.#id = id;
  }

  state() {
    return this.#session.state();
  }

  paths(): ArtifactPaths {
    return this.#session.paths();
  }

  documentId(): string {
    return this.#id;
  }

  html(): string {
    return this.#session.html();
  }

  bodyHtml(): string {
    return this.#session.bodyHtml();
  }

  exportPaths(): readonly string[] {
    return this.#session.exportPaths();
  }

  updateBody(bodyHtml: string): void {
    this.#session.updateBody(bodyHtml);
  }

  async save(reason: SaveReason, signal?: AbortSignal): Promise<void> {
    const provesReady = this.#session.state().dirty;
    await this.#run(async () => {
      await this.#session.save(reason, signal);
      if (reason === "overwrite") await this.#syncDocumentId(signal);
    }, provesReady);
  }

  async reload(signal?: AbortSignal): Promise<void> {
    await this.#run(() => this.#reloadStable(signal), true);
  }

  async saveCopy(signal?: AbortSignal): Promise<ArtifactPaths> {
    return this.#run(() => this.#session.saveCopy(signal));
  }

  async history(signal?: AbortSignal): Promise<readonly HistorySnapshot[]> {
    return this.#run(() => this.#historyRepository.list(this.#id, signal));
  }

  async restoreHistory(path: string, signal?: AbortSignal): Promise<void> {
    const snapshots = await this.history(signal);
    const snapshot = snapshots.find((candidate) => candidate.path === path);
    if (!snapshot) throw new GalleyHistorySnapshotNotFoundError(path);
    const restored = GalleyDocumentCodec.parse(snapshot.html);
    this.#session.updateBody(restored.bodyHtml);
  }

  async recordExport(
    record: GalleyExportRecordV1,
    signal?: AbortSignal
  ): Promise<void> {
    await this.#run(() => this.#session.recordExport(record, signal), true);
  }

  recoveryState(): DocumentRecoveryState {
    return { ...this.#recovery };
  }

  async #run<T>(operation: () => Promise<T>, provesReady = false): Promise<T> {
    try {
      const result = await operation();
      if (provesReady) this.#recovery = { status: "ready" };
      return result;
    } catch (error) {
      let recovery = recoveryStateFromError(error);
      if (recovery?.status === "ambiguous") {
        try {
          await this.#repository.readPair(this.#session.paths());
        } catch (probeError) {
          recovery = recoveryStateFromError(probeError) ?? recovery;
        }
      }
      if (recovery) this.#recovery = recovery;
      throw error;
    }
  }

  async #reloadStable(signal?: AbortSignal): Promise<void> {
    const paths = this.#session.paths();
    for (let attempt = 0; attempt < MAX_OPEN_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      const before = await this.#repository.readPair(paths, signal);
      if (!before) throw new GalleyDocumentMissingError(paths);
      const sidecar = parseSidecar(before.sidecarJson);
      await this.#session.reload(signal);
      const after = await this.#repository.readPair(paths, signal);
      if (
        after &&
        before.sidecarJson === after.sidecarJson &&
        this.#repository.sameObservation(before.observation, after.observation) &&
        this.#session.state().htmlHash === before.htmlHash
      ) {
        this.#id = sidecar.documentId;
        return;
      }
    }
    throw new GalleyDocumentOpenUnstableError(paths);
  }

  async #syncDocumentId(signal?: AbortSignal): Promise<void> {
    const paths = this.#session.paths();
    const pair = await this.#repository.readPair(paths, signal);
    if (!pair) throw new GalleyDocumentMissingError(paths);
    const sidecar = parseSidecar(pair.sidecarJson);
    if (
      pair.htmlHash !== this.#session.state().htmlHash ||
      sidecar.htmlHash !== pair.htmlHash
    ) {
      throw new GalleyDocumentOpenUnstableError(paths);
    }
    this.#id = sidecar.documentId;
  }
}

function parseSidecar(sidecarJson: string) {
  return GalleySidecarV1Schema.parse(JSON.parse(sidecarJson) as unknown);
}

function recoveryStateFromError(
  error: unknown,
  seen = new Set<unknown>()
): DocumentRecoveryState | null {
  if (seen.has(error)) return null;
  seen.add(error);

  if (error instanceof ObsidianWorkbenchRecoveryConflictError) {
    return { status: "quarantined", transactionId: error.transactionId };
  }
  if (
    error instanceof TransactionRecordInvalidError ||
    error instanceof TransactionRecordUnstableError ||
    error instanceof TransactionReceiptInvalidError
  ) {
    return { status: "quarantined", transactionId: null };
  }
  if (error instanceof ObsidianWorkbenchAmbiguousError) {
    const nested = recoveryStateFromError(error.operationError, seen);
    return (
      nested ?? {
        status: "ambiguous",
        transactionId: error.transactionId
      }
    );
  }
  if (error instanceof DocumentCommitAmbiguousError) {
    const reconciled = recoveryStateFromError(error.reconciliationError, seen);
    if (reconciled) return reconciled;
    const operation = recoveryStateFromError(error.operationError, seen);
    return operation ?? { status: "ambiguous", transactionId: null };
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
