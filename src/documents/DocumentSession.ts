import {
  DocumentCommitAmbiguousError,
  DocumentCommitVerificationError,
  DocumentPostCommitError,
  DocumentSavePostCommitError,
  type ArtifactPaths,
  type DocumentObservation,
  type DocumentPairSnapshot,
  type GalleyDocumentRepository
} from "./GalleyDocumentRepository";
import {
  GalleyDocumentCodec,
  type GalleyDocument
} from "./GalleyDocumentCodec";
import {
  GalleySidecarV1Schema,
  sha256Text,
  type GalleySidecarV1
} from "./GalleySidecar";
import { sanitizeAuthoringDocument } from "../security/AuthoringSanitizer";
import type {
  HistoryCommitPlan,
  PreparedHistorySnapshot
} from "./HistoryRepository";

export interface DocumentSessionState {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  htmlHash: string;
  sourceChanged: boolean;
  lastSavedAt: string | null;
}

export type SaveReason = "auto" | "explicit" | "overwrite";

export interface DocumentHistory<HistoryObservation = unknown> {
  prepare(
    documentId: string,
    html: string,
    timestamp: Date,
    signal?: AbortSignal
  ): Promise<PreparedHistorySnapshot>;
  commit(
    prepared: PreparedHistorySnapshot,
    signal?: AbortSignal
  ): Promise<unknown>;
  rollback(prepared: PreparedHistorySnapshot): Promise<void>;
  plan(
    prepared: PreparedHistorySnapshot,
    signal?: AbortSignal
  ): Promise<HistoryCommitPlan<HistoryObservation>>;
}

export interface DocumentSessionDependencies<
  Observation,
  Ownership,
  HistoryObservation = unknown
> {
  repository: GalleyDocumentRepository<
    Observation,
    Ownership,
    HistoryObservation
  >;
  history: DocumentHistory<HistoryObservation>;
  htmlPath: string;
  sidecarPath: string;
  now?: () => Date;
  randomUUID?: () => string;
}

export class DocumentConflictError extends Error {
  readonly code = "document_conflict";

  constructor() {
    super("The Galley document changed outside this editing session.");
    this.name = "DocumentConflictError";
  }
}

export class DocumentSaveInProgressError extends Error {
  readonly code = "document_save_in_progress";

  constructor() {
    super("A Galley document save is already in progress.");
    this.name = "DocumentSaveInProgressError";
  }
}

interface LoadedDocument<Observation> {
  snapshot: DocumentPairSnapshot<Observation>;
  sidecar: GalleySidecarV1;
  document: GalleyDocument;
  sourceChanged: boolean;
}

export class DocumentSession<
  Observation,
  Ownership,
  HistoryObservation = unknown
> {
  readonly #repository: GalleyDocumentRepository<
    Observation,
    Ownership,
    HistoryObservation
  >;
  readonly #history: DocumentHistory<HistoryObservation>;
  readonly #paths: ArtifactPaths;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;

  #observation: DocumentObservation<Observation>;
  #sidecar: GalleySidecarV1;
  #savedHtml: string;
  #savedDocument: GalleyDocument;
  #currentHtml: string;
  #currentDocument: GalleyDocument;
  #revision = 0;
  #dirty = false;
  #saving = false;
  #conflict = false;
  #htmlHash: string;
  #sourceChanged: boolean;
  #lastSavedAt: string | null = null;

  private constructor(
    dependencies: DocumentSessionDependencies<
      Observation,
      Ownership,
      HistoryObservation
    >,
    loaded: LoadedDocument<Observation>
  ) {
    this.#repository = dependencies.repository;
    this.#history = dependencies.history;
    this.#paths = {
      html: dependencies.htmlPath,
      sidecar: dependencies.sidecarPath
    };
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomUUID =
      dependencies.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.#observation = loaded.snapshot.observation;
    this.#sidecar = loaded.sidecar;
    this.#savedHtml = loaded.snapshot.html;
    this.#savedDocument = loaded.document;
    this.#currentHtml = loaded.snapshot.html;
    this.#currentDocument = loaded.document;
    this.#htmlHash = loaded.snapshot.htmlHash;
    this.#sourceChanged = loaded.sourceChanged;
  }

  static async open<Observation, Ownership, HistoryObservation = unknown>(
    dependencies: DocumentSessionDependencies<
      Observation,
      Ownership,
      HistoryObservation
    >,
    signal?: AbortSignal
  ): Promise<DocumentSession<Observation, Ownership, HistoryObservation>> {
    const paths = {
      html: dependencies.htmlPath,
      sidecar: dependencies.sidecarPath
    };
    const loaded = await loadDocument(dependencies.repository, paths, signal);
    return new DocumentSession(dependencies, loaded);
  }

  state(): DocumentSessionState {
    return {
      dirty: this.#dirty,
      saving: this.#saving,
      conflict: this.#conflict,
      htmlHash: this.#htmlHash,
      sourceChanged: this.#sourceChanged,
      lastSavedAt: this.#lastSavedAt
    };
  }

  paths(): ArtifactPaths {
    return { ...this.#paths };
  }

  html(): string {
    return this.#currentHtml;
  }

  bodyHtml(): string {
    return this.#currentDocument.bodyHtml;
  }

  updateBody(bodyHtml: string): void {
    const serialized = GalleyDocumentCodec.serialize({
      ...this.#currentDocument,
      bodyHtml
    });
    const sanitizedHtml = sanitizeAuthoringDocument(serialized).html;
    const sanitizedDocument = GalleyDocumentCodec.parse(sanitizedHtml);
    assertSameShell(this.#currentDocument, sanitizedDocument);

    if (sanitizedDocument.bodyHtml === this.#currentDocument.bodyHtml) return;

    this.#revision += 1;
    if (sanitizedDocument.bodyHtml === this.#savedDocument.bodyHtml) {
      this.#currentHtml = this.#savedHtml;
      this.#currentDocument = this.#savedDocument;
    } else {
      this.#currentHtml = sanitizedHtml;
      this.#currentDocument = sanitizedDocument;
    }
    this.#dirty = this.#currentHtml !== this.#savedHtml;
  }

  async save(reason: SaveReason, signal?: AbortSignal): Promise<void> {
    if (this.#saving) throw new DocumentSaveInProgressError();
    throwIfAborted(signal);
    if (!this.#dirty) return;
    this.#saving = true;

    try {
      const targetHtml = sanitizeAuthoringDocument(this.#currentHtml).html;
      const targetDocument = GalleyDocumentCodec.parse(targetHtml);
      assertSameShell(this.#currentDocument, targetDocument);
      const targetHash = await sha256Text(targetHtml);
      throwIfAborted(signal);

      const current = await this.#readBeforeSave(reason, signal);
      const changed = !this.#repository.sameObservation(
        this.#observation,
        current.observation
      );
      if (changed && reason !== "overwrite") {
        this.#conflict = true;
        throw new DocumentConflictError();
      }

      // Overwrite adopts the latest valid sidecar as the identity/provenance
      // owner. Normal saves retain the sidecar validated when the session loaded.
      const baseSidecar =
        reason === "overwrite"
          ? parseSidecar(current.sidecarJson)
          : this.#sidecar;
      const nextSidecar = GalleySidecarV1Schema.parse({
        ...baseSidecar,
        htmlHash: targetHash
      });
      const sidecarJson = serializeSidecar(nextSidecar);
      const savedAt = this.#now();
      const nextSourceChanged = await sourceChanged(
        this.#repository,
        nextSidecar,
        signal
      );
      const preparedHistory = await this.#history.prepare(
        nextSidecar.documentId,
        current.html,
        savedAt,
        signal
      );

      let result;
      try {
        throwIfAborted(signal);
        for (let attempt = 0; attempt < 128; attempt += 1) {
          const historyPlan = await this.#history.plan(preparedHistory, signal);
          result = await this.#repository.replacePairWithHistory(
            this.#paths,
            current.observation,
            { html: targetHtml, sidecarJson },
            historyPlan,
            signal
          );
          if (result.status !== "history-conflict") break;
        }
        if (!result || result.status === "history-conflict") {
          throw new Error("Galley save transaction did not converge.");
        }
      } catch (error) {
        if (error instanceof DocumentCommitAmbiguousError) {
          this.#dirty = true;
          this.#conflict = true;
          throw error;
        }
        if (error instanceof DocumentSavePostCommitError) {
          await this.#finishPostCommitFailure(
            error,
            preparedHistory,
            targetHtml,
            targetDocument,
            nextSidecar,
            nextSourceChanged,
            savedAt
          );
          throw postCommitCause(error);
        }
        if (error instanceof DocumentPostCommitError) {
          this.#dirty = true;
          this.#conflict = true;
          throw error;
        }
        await this.#history.rollback(preparedHistory);
        throw error;
      }
      if (result.status === "conflict") {
        await this.#history.rollback(preparedHistory);
        this.#conflict = true;
        throw new DocumentConflictError();
      }
      verifyCommittedSnapshot(result.snapshot, nextSidecar);
      try {
        await this.#history.commit(preparedHistory);
      } catch (error) {
        this.#applyCommitted(
          result.snapshot,
          targetHtml,
          targetDocument,
          nextSidecar,
          nextSourceChanged,
          savedAt
        );
        this.#conflict = true;
        this.#dirty = true;
        throw error;
      }
      this.#applyCommitted(
        result.snapshot,
        targetHtml,
        targetDocument,
        nextSidecar,
        nextSourceChanged,
        savedAt
      );
      this.#conflict = false;
    } finally {
      this.#saving = false;
    }
  }

  async reload(signal?: AbortSignal): Promise<void> {
    if (this.#saving) throw new DocumentSaveInProgressError();
    const loaded = await loadDocument(this.#repository, this.#paths, signal);

    this.#observation = loaded.snapshot.observation;
    this.#sidecar = loaded.sidecar;
    this.#savedHtml = loaded.snapshot.html;
    this.#savedDocument = loaded.document;
    this.#currentHtml = loaded.snapshot.html;
    this.#currentDocument = loaded.document;
    this.#htmlHash = loaded.snapshot.htmlHash;
    this.#sourceChanged = loaded.sourceChanged;
    this.#revision += 1;
    this.#dirty = false;
    this.#conflict = false;
  }

  async saveCopy(signal?: AbortSignal): Promise<ArtifactPaths> {
    if (this.#saving) throw new DocumentSaveInProgressError();
    throwIfAborted(signal);
    this.#saving = true;

    try {
      const copyHtml = sanitizeAuthoringDocument(this.#currentHtml).html;
      const copyDocument = GalleyDocumentCodec.parse(copyHtml);
      assertSameShell(this.#currentDocument, copyDocument);
      const htmlHash = await sha256Text(copyHtml);
      throwIfAborted(signal);
      const copyDocumentId = this.#randomUUID();
      if (
        canonicalDocumentId(copyDocumentId) ===
        canonicalDocumentId(this.#sidecar.documentId)
      ) {
        throw new Error("A Galley copy requires a new document ID.");
      }
      const sidecar = GalleySidecarV1Schema.parse({
        ...this.#sidecar,
        documentId: copyDocumentId,
        htmlHash
      });
      const created = await this.#repository.createNumberedCopy(
        this.#paths,
        { html: copyHtml, sidecarJson: serializeSidecar(sidecar) },
        signal
      );
      verifyCommittedSnapshot(created.snapshot, sidecar);
      return created.paths;
    } finally {
      this.#saving = false;
    }
  }

  async #readBeforeSave(
    reason: SaveReason,
    signal?: AbortSignal
  ): Promise<DocumentPairSnapshot<Observation>> {
    try {
      const current = await this.#repository.readPair(this.#paths, signal);
      if (!current) throw new DocumentConflictError();
      return current;
    } catch (error) {
      if (reason !== "overwrite" && !isAbortError(error)) {
        this.#conflict = true;
        if (error instanceof DocumentConflictError) throw error;
        throw new DocumentConflictError();
      }
      throw error;
    }
  }

  async #finishPostCommitFailure(
    error: DocumentSavePostCommitError<Observation>,
    preparedHistory: PreparedHistorySnapshot,
    targetHtml: string,
    targetDocument: GalleyDocument,
    nextSidecar: GalleySidecarV1,
    nextSourceChanged: boolean,
    savedAt: Date
  ): Promise<void> {
    let historyFinalizationFailed = false;
    let historyFinalizationError: unknown;
    try {
      await this.#history.commit(preparedHistory);
    } catch (error) {
      historyFinalizationFailed = true;
      historyFinalizationError = error;
    }
    let snapshot = error.snapshot;
    if (!snapshot) {
      try {
        const observed = await this.#repository.readPair(this.#paths);
        if (observed) {
          verifyCommittedSnapshot(observed, nextSidecar);
          if (
            observed.html === targetHtml &&
            observed.sidecarJson === serializeSidecar(nextSidecar)
          ) {
            snapshot = observed;
          }
        }
      } catch {
        // The operation remains ambiguous and is marked conflicted/dirty below.
      }
    }
    if (snapshot) {
      this.#applyCommitted(
        snapshot,
        targetHtml,
        targetDocument,
        nextSidecar,
        nextSourceChanged,
        savedAt
      );
    } else {
      this.#dirty = true;
    }
    // Any exceptional post-commit path remains explicitly actionable even if a
    // reconciliation read found the intended bytes.
    this.#dirty = true;
    this.#conflict = true;
    if (historyFinalizationFailed) throw historyFinalizationError;
  }

  #applyCommitted(
    snapshot: DocumentPairSnapshot<Observation>,
    targetHtml: string,
    targetDocument: GalleyDocument,
    nextSidecar: GalleySidecarV1,
    nextSourceChanged: boolean,
    savedAt: Date
  ): void {
    this.#observation = snapshot.observation;
    this.#sidecar = nextSidecar;
    this.#savedHtml = targetHtml;
    this.#savedDocument = targetDocument;
    this.#htmlHash = snapshot.htmlHash;
    this.#sourceChanged = nextSourceChanged;
    this.#lastSavedAt = validClockIso(savedAt);
    this.#dirty = this.#currentHtml !== targetHtml;
  }
}

async function loadDocument<Observation, Ownership, HistoryObservation>(
  repository: GalleyDocumentRepository<
    Observation,
    Ownership,
    HistoryObservation
  >,
  paths: ArtifactPaths,
  signal?: AbortSignal
): Promise<LoadedDocument<Observation>> {
  throwIfAborted(signal);
  const snapshot = await repository.readPair(paths, signal);
  if (!snapshot) throw new Error("Galley document pair does not exist.");
  const sidecar = parseSidecar(snapshot.sidecarJson);
  if (sidecar.htmlHash !== snapshot.htmlHash) {
    throw new Error("Galley sidecar HTML hash does not match the exact document.");
  }
  const document = GalleyDocumentCodec.parse(snapshot.html);
  const changed = await sourceChanged(repository, sidecar, signal);
  throwIfAborted(signal);
  return { snapshot, sidecar, document, sourceChanged: changed };
}

async function sourceChanged<Observation, Ownership, HistoryObservation>(
  repository: GalleyDocumentRepository<
    Observation,
    Ownership,
    HistoryObservation
  >,
  sidecar: GalleySidecarV1,
  signal?: AbortSignal
): Promise<boolean> {
  const source = await repository.readText(sidecar.sourcePath, signal);
  return source === null || (await sha256Text(source)) !== sidecar.sourceHash;
}

function parseSidecar(value: string): GalleySidecarV1 {
  return GalleySidecarV1Schema.parse(JSON.parse(value) as unknown);
}

function serializeSidecar(sidecar: GalleySidecarV1): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

function verifyCommittedSnapshot(
  snapshot: DocumentPairSnapshot<unknown>,
  expectedSidecar: GalleySidecarV1
): void {
  try {
    const sidecar = parseSidecar(snapshot.sidecarJson);
    GalleyDocumentCodec.parse(snapshot.html);
    if (
      snapshot.htmlHash !== expectedSidecar.htmlHash ||
      sidecar.htmlHash !== snapshot.htmlHash ||
      JSON.stringify(sidecar) !== JSON.stringify(expectedSidecar)
    ) {
      throw new Error("Committed Galley sidecar does not match the document.");
    }
  } catch (error) {
    if (error instanceof DocumentCommitVerificationError) throw error;
    throw new DocumentCommitVerificationError();
  }
}

function assertSameShell(before: GalleyDocument, after: GalleyDocument): void {
  if (
    before.doctype !== after.doctype ||
    before.lang !== after.lang ||
    before.headHtml !== after.headHtml
  ) {
    throw new Error("A body edit must not change the Galley document shell.");
  }
}

function validClockIso(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Galley save clock returned an invalid date.");
  }
  return date.toISOString();
}

function canonicalDocumentId(documentId: string): string {
  return GalleySidecarV1Schema.shape.documentId.parse(documentId).toLowerCase();
}

function postCommitCause(error: DocumentPostCommitError<unknown>): unknown {
  if (
    error.operationError instanceof DOMException &&
    error.operationError.name === "AbortError"
  ) {
    return error.operationError;
  }
  return error.operationError instanceof Error ? error.operationError : error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
