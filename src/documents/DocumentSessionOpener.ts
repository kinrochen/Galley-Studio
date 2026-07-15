import type { DocumentSessionState, SaveReason } from "./DocumentSession";
import type { ArtifactPaths } from "./GalleyDocumentRepository";
import { isNormalizedVaultRelativePath } from "./GalleySidecar";
import type { HistorySnapshot } from "./HistoryRepository";
import type { GalleyExportRecordV1 } from "../export/ExportRecord";

const GALLEY_HTML_SUFFIX = ".galley.html";
const GALLEY_SIDECAR_SUFFIX = ".galley.json";

export type DocumentRecoveryState =
  | { readonly status: "ready" }
  | {
      readonly status: "ambiguous";
      readonly transactionId: string | null;
    }
  | {
      readonly status: "quarantined";
      readonly transactionId: string | null;
    };

export interface DocumentRecoveryInspection {
  readonly paths: ArtifactPaths;
  readonly pair: "present" | "missing" | "unknown";
  readonly recovery: DocumentRecoveryState;
}

/**
 * Workbench-facing session boundary. It deliberately hides the production
 * vault/repository observation and ownership generic types.
 */
export interface OpenedGalleyDocumentSession {
  state(): DocumentSessionState;
  paths(): ArtifactPaths;
  documentId(): string;
  html(): string;
  bodyHtml(): string;
  exportPaths(): readonly string[];
  updateBody(bodyHtml: string): void;
  save(reason: SaveReason, signal?: AbortSignal): Promise<void>;
  reload(signal?: AbortSignal): Promise<void>;
  saveCopy(signal?: AbortSignal): Promise<ArtifactPaths>;
  history(signal?: AbortSignal): Promise<readonly HistorySnapshot[]>;
  restoreHistory(path: string, signal?: AbortSignal): Promise<void>;
  recordExport(record: GalleyExportRecordV1, signal?: AbortSignal): Promise<void>;
  recoveryState(): DocumentRecoveryState;
}

export interface DocumentSessionOpener {
  open(
    htmlPath: string,
    signal?: AbortSignal
  ): Promise<OpenedGalleyDocumentSession>;
  inspectRecovery(
    htmlPath: string,
    signal?: AbortSignal
  ): Promise<DocumentRecoveryInspection>;
}

export class GalleyDocumentPathError extends Error {
  readonly code = "galley_document_path_invalid";

  constructor(readonly path: string) {
    super("Galley can open only a canonical vault-relative *.galley.html path.");
    this.name = "GalleyDocumentPathError";
  }
}

export class GalleyDocumentMissingError extends Error {
  readonly code = "galley_document_missing";

  constructor(readonly paths: ArtifactPaths) {
    super("The Galley HTML and sidecar pair does not exist.");
    this.name = "GalleyDocumentMissingError";
  }
}

export class GalleyDocumentOpenUnstableError extends Error {
  readonly code = "galley_document_open_unstable";

  constructor(readonly paths: ArtifactPaths) {
    super("The Galley document changed repeatedly while it was opening.");
    this.name = "GalleyDocumentOpenUnstableError";
  }
}

export class GalleyDocumentQuarantinedError extends Error {
  readonly code = "galley_document_quarantined";

  constructor(
    readonly paths: ArtifactPaths,
    readonly recovery: Extract<DocumentRecoveryState, { status: "quarantined" }>,
    readonly operationError: unknown
  ) {
    super("Galley quarantined recovery for this document scope.");
    this.name = "GalleyDocumentQuarantinedError";
  }
}

export class GalleyDocumentAmbiguousError extends Error {
  readonly code = "galley_document_ambiguous";

  constructor(
    readonly paths: ArtifactPaths,
    readonly recovery: Extract<DocumentRecoveryState, { status: "ambiguous" }>,
    readonly operationError: unknown
  ) {
    super("Galley could not prove recovery for this document scope.");
    this.name = "GalleyDocumentAmbiguousError";
  }
}

export class GalleyHistorySnapshotNotFoundError extends Error {
  readonly code = "galley_history_snapshot_missing";

  constructor(readonly path: string) {
    super("The selected Galley history snapshot is no longer retained.");
    this.name = "GalleyHistorySnapshotNotFoundError";
  }
}

export function galleyArtifactPaths(htmlPath: string): ArtifactPaths {
  if (
    !isNormalizedVaultRelativePath(htmlPath) ||
    !htmlPath.endsWith(GALLEY_HTML_SUFFIX)
  ) {
    throw new GalleyDocumentPathError(htmlPath);
  }
  const nameStart = htmlPath.lastIndexOf("/") + 1;
  const stemEnd = htmlPath.length - GALLEY_HTML_SUFFIX.length;
  if (stemEnd <= nameStart) throw new GalleyDocumentPathError(htmlPath);

  const stem = htmlPath.slice(0, stemEnd);
  return {
    html: htmlPath,
    sidecar: `${stem}${GALLEY_SIDECAR_SUFFIX}`
  };
}
