import {
  DocumentCommitVerificationError,
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

export interface DocumentSessionState {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  htmlHash: string;
  sourceChanged: boolean;
  lastSavedAt: string | null;
}

export type SaveReason = "auto" | "explicit" | "overwrite";

export interface DocumentHistory {
  store(
    documentId: string,
    html: string,
    timestamp: Date,
    signal?: AbortSignal
  ): Promise<unknown>;
}

export interface DocumentSessionDependencies<Observation, Ownership> {
  repository: GalleyDocumentRepository<Observation, Ownership>;
  history: DocumentHistory;
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

export class DocumentSession<Observation, Ownership> {
  readonly #repository: GalleyDocumentRepository<Observation, Ownership>;
  readonly #history: DocumentHistory;
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
    dependencies: DocumentSessionDependencies<Observation, Ownership>,
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

  static async open<Observation, Ownership>(
    dependencies: DocumentSessionDependencies<Observation, Ownership>,
    signal?: AbortSignal
  ): Promise<DocumentSession<Observation, Ownership>> {
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
      const savedRevision = this.#revision;
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

      const nextSidecar = GalleySidecarV1Schema.parse({
        ...this.#sidecar,
        htmlHash: targetHash
      });
      const sidecarJson = serializeSidecar(nextSidecar);
      const savedAt = this.#now();
      await this.#history.store(
        this.#sidecar.documentId,
        current.html,
        savedAt,
        signal
      );
      throwIfAborted(signal);

      const result = await this.#repository.replacePair(
        this.#paths,
        current.observation,
        { html: targetHtml, sidecarJson },
        signal
      );
      if (result.status === "conflict") {
        this.#conflict = true;
        throw new DocumentConflictError();
      }
      verifyCommittedSnapshot(result.snapshot, nextSidecar);

      this.#observation = result.snapshot.observation;
      this.#sidecar = nextSidecar;
      this.#savedHtml = targetHtml;
      this.#savedDocument = targetDocument;
      this.#htmlHash = targetHash;
      this.#lastSavedAt = validClockIso(savedAt);
      this.#conflict = false;
      this.#dirty = !(
        this.#revision === savedRevision && this.#currentHtml === targetHtml
      );
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
      if (copyDocumentId === this.#sidecar.documentId) {
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
}

async function loadDocument<Observation, Ownership>(
  repository: GalleyDocumentRepository<Observation, Ownership>,
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
  const source = await repository.readText(sidecar.sourcePath, signal);
  const sourceChanged =
    source === null || (await sha256Text(source)) !== sidecar.sourceHash;
  throwIfAborted(signal);
  return { snapshot, sidecar, document, sourceChanged };
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
