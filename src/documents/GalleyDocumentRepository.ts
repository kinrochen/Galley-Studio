import {
  isNormalizedVaultRelativePath,
  sha256Text
} from "./GalleySidecar";

export interface ArtifactPaths {
  html: string;
  sidecar: string;
}

export interface VaultPairSnapshot<Observation> {
  html: string;
  sidecarJson: string;
  observation: Observation;
}

export type VaultReplacePairResult<Observation> =
  | { status: "committed"; observation: Observation }
  | { status: "conflict" };

export type VaultCreatePairResult<Observation, Ownership> =
  | {
      status: "created";
      observation: Observation;
      ownership: Ownership;
    }
  | { status: "collision" };

/**
 * The adapter owns identity/version tracking and the transactional primitive.
 * A replace/create call must leave either the complete old pair or the complete
 * new pair durable on every return/throw; it must never expose a mixed pair.
 */
export interface GalleyDocumentVault<Observation, Ownership> {
  readPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<VaultPairSnapshot<Observation> | null>;
  readText(path: string, signal?: AbortSignal): Promise<string | null>;
  samePairObservation(left: Observation, right: Observation): boolean;
  replacePairAtomically(
    paths: ArtifactPaths,
    expected: Observation,
    next: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<VaultReplacePairResult<Observation>>;
  createPairAtomically(
    paths: ArtifactPaths,
    contents: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<VaultCreatePairResult<Observation, Ownership>>;
  removeCreatedPair(ownership: Ownership): Promise<void>;
}

const OBSERVATION = Symbol("GalleyDocumentObservation");

export interface DocumentObservation<Observation> {
  readonly htmlHash: string;
  readonly [OBSERVATION]: {
    readonly repository: symbol;
    readonly vault: Observation;
  };
}

export interface DocumentPairSnapshot<Observation> {
  html: string;
  sidecarJson: string;
  htmlHash: string;
  observation: DocumentObservation<Observation>;
}

export type ReplacePairResult<Observation> =
  | { status: "committed"; snapshot: DocumentPairSnapshot<Observation> }
  | { status: "conflict" };

export interface CreatedDocumentPair<Observation> {
  paths: ArtifactPaths;
  snapshot: DocumentPairSnapshot<Observation>;
}

export class DocumentCommitVerificationError extends Error {
  readonly code = "document_commit_verification";

  constructor() {
    super("Galley could not verify the complete committed document pair.");
    this.name = "DocumentCommitVerificationError";
  }
}

export class GalleyDocumentRepository<Observation, Ownership> {
  readonly #identity = Symbol("GalleyDocumentRepository");

  constructor(
    private readonly vault: GalleyDocumentVault<Observation, Ownership>
  ) {}

  async readPair(
    paths: ArtifactPaths,
    signal?: AbortSignal
  ): Promise<DocumentPairSnapshot<Observation> | null> {
    validatePairPaths(paths);
    throwIfAborted(signal);
    const pair = await this.vault.readPair(paths, signal);
    throwIfAborted(signal);
    if (!pair) return null;
    const htmlHash = await sha256Text(pair.html);
    throwIfAborted(signal);
    return {
      html: pair.html,
      sidecarJson: pair.sidecarJson,
      htmlHash,
      observation: {
        htmlHash,
        [OBSERVATION]: {
          repository: this.#identity,
          vault: pair.observation
        }
      }
    };
  }

  async readText(path: string, signal?: AbortSignal): Promise<string | null> {
    validateVaultPath(path);
    throwIfAborted(signal);
    const value = await this.vault.readText(path, signal);
    throwIfAborted(signal);
    return value;
  }

  sameObservation(
    left: DocumentObservation<Observation>,
    right: DocumentObservation<Observation>
  ): boolean {
    const leftData = this.#observationData(left);
    const rightData = this.#observationData(right);
    return (
      left.htmlHash === right.htmlHash &&
      this.vault.samePairObservation(leftData.vault, rightData.vault)
    );
  }

  async replacePair(
    paths: ArtifactPaths,
    expected: DocumentObservation<Observation>,
    next: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<ReplacePairResult<Observation>> {
    validatePairPaths(paths);
    const expectedData = this.#observationData(expected);
    throwIfAborted(signal);
    const result = await this.vault.replacePairAtomically(
      paths,
      expectedData.vault,
      next,
      signal
    );
    throwIfAborted(signal);
    if (result.status === "conflict") return result;
    return {
      status: "committed",
      snapshot: await this.#verifyCommitted(
        paths,
        next,
        result.observation,
        signal
      )
    };
  }

  async createNumberedCopy(
    currentPaths: ArtifactPaths,
    contents: { html: string; sidecarJson: string },
    signal?: AbortSignal
  ): Promise<CreatedDocumentPair<Observation>> {
    validatePairPaths(currentPaths);
    const { directory, stem, unverified } = copyStem(currentPaths);
    let number = 2;

    while (true) {
      throwIfAborted(signal);
      const numbered = unverified
        ? `${stem}-${number}.unverified`
        : `${stem}-${number}`;
      const paths = {
        html: joinPath(directory, `${numbered}.galley.html`),
        sidecar: joinPath(directory, `${numbered}.galley.json`)
      };
      const result = await this.vault.createPairAtomically(
        paths,
        contents,
        signal
      );
      if (result.status === "collision") {
        number += 1;
        continue;
      }

      try {
        throwIfAborted(signal);
        const snapshot = await this.#verifyCommitted(
          paths,
          contents,
          result.observation,
          signal
        );
        return { paths, snapshot };
      } catch (error) {
        try {
          await this.vault.removeCreatedPair(result.ownership);
        } catch {
          // Preserve the operation/verification error. Cleanup is identity-safe.
        }
        throw error;
      }
    }
  }

  async #verifyCommitted(
    paths: ArtifactPaths,
    expected: { html: string; sidecarJson: string },
    returnedObservation: Observation,
    signal?: AbortSignal
  ): Promise<DocumentPairSnapshot<Observation>> {
    const verified = await this.readPair(paths, signal);
    if (
      !verified ||
      verified.html !== expected.html ||
      verified.sidecarJson !== expected.sidecarJson ||
      !this.vault.samePairObservation(
        returnedObservation,
        verified.observation[OBSERVATION].vault
      )
    ) {
      throw new DocumentCommitVerificationError();
    }
    return verified;
  }

  #observationData(observation: DocumentObservation<Observation>): {
    readonly repository: symbol;
    readonly vault: Observation;
  } {
    const data = observation[OBSERVATION];
    if (data.repository !== this.#identity) {
      throw new Error("Galley document observation belongs to another repository.");
    }
    return data;
  }
}

function validatePairPaths(paths: ArtifactPaths): void {
  validateVaultPath(paths.html);
  validateVaultPath(paths.sidecar);
  const htmlStem = stripSuffix(paths.html, ".galley.html");
  const sidecarStem = stripSuffix(paths.sidecar, ".galley.json");
  if (htmlStem === null || sidecarStem === null || htmlStem !== sidecarStem) {
    throw new Error("Galley document paths must identify one matching pair.");
  }
}

function validateVaultPath(path: string): void {
  if (!isNormalizedVaultRelativePath(path)) {
    throw new Error("Galley document path must be normalized and vault-relative.");
  }
}

function stripSuffix(value: string, suffix: string): string | null {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : null;
}

function copyStem(paths: ArtifactPaths): {
  directory: string;
  stem: string;
  unverified: boolean;
} {
  const fileStart = paths.html.lastIndexOf("/") + 1;
  const directory = fileStart > 0 ? paths.html.slice(0, fileStart - 1) : "";
  const name = paths.html.slice(fileStart, -".galley.html".length);
  const unverified = name.endsWith(".unverified");
  return {
    directory,
    stem: unverified ? name.slice(0, -".unverified".length) : name,
    unverified
  };
}

function joinPath(directory: string, fileName: string): string {
  return directory ? `${directory}/${fileName}` : fileName;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
