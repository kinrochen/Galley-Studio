import type { GeneratedDocument } from "../generation/GenerationPipeline";
import {
  buildGalleySidecarV1,
  isNormalizedVaultRelativePath,
  type GalleySidecarV1
} from "./GalleySidecar";

export type ArtifactCommitResult<Handle> =
  | { status: "committed"; handle: Handle }
  | { status: "collision" };

export interface ArtifactVault<Handle> {
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  createOwned(path: string, contents: string): Promise<Handle>;
  commitOwned(
    handle: Handle,
    finalPath: string
  ): Promise<ArtifactCommitResult<Handle>>;
  owns(handle: Handle): Promise<boolean>;
  removeOwned(handle: Handle): Promise<void>;
}

export interface ArtifactPaths {
  html: string;
  sidecar: string;
}

export interface WriteArtifactInput {
  sourcePath: string;
  markdown: string;
  document: GeneratedDocument;
  model: string;
}

export interface ArtifactRepositoryOptions {
  outputFolder?: string;
  now?: () => Date;
  randomUUID?: () => string;
  serialize?: (value: GalleySidecarV1) => string;
}

export class ArtifactConfigurationError extends Error {
  readonly code = "invalid_output_folder";

  constructor() {
    super("Invalid Galley output folder.");
    this.name = "ArtifactConfigurationError";
  }
}

interface AttemptHandles<Handle> {
  htmlTemp: Handle | null;
  sidecarTemp: Handle | null;
  htmlFinal: Handle | null;
  sidecarFinal: Handle | null;
}

interface AttemptPaths extends ArtifactPaths {
  htmlTemp: string;
  sidecarTemp: string;
}

const MARKDOWN_EXTENSION = /\.md$/i;

class PairCollision extends Error {}

export class ArtifactRepository<Handle> {
  readonly #outputFolder: string;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;
  readonly #serialize: (value: GalleySidecarV1) => string;

  constructor(
    private readonly vault: ArtifactVault<Handle>,
    options: ArtifactRepositoryOptions = {}
  ) {
    this.#outputFolder = validateConfiguredOutputFolder(
      options.outputFolder ?? ""
    );
    this.#now = options.now ?? (() => new Date());
    this.#randomUUID =
      options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.#serialize =
      options.serialize ?? ((value) => `${JSON.stringify(value, null, 2)}\n`);
  }

  async writeNew(
    input: WriteArtifactInput,
    signal?: AbortSignal
  ): Promise<ArtifactPaths> {
    throwIfAborted(signal);
    const sourcePath = validateSourcePath(input.sourcePath);
    const outputDirectory = this.#outputFolder || sourceDirectory(sourcePath);
    await this.prepare(signal);
    throwIfAborted(signal);

    const sidecar = await buildGalleySidecarV1(
      { ...input, sourcePath },
      { now: this.#now, randomUUID: this.#randomUUID }
    );
    const sidecarJson = this.#serialize(sidecar);
    const baseName = sourceFileName(sourcePath).replace(MARKDOWN_EXTENSION, "");
    const unverified = input.document.status === "unverified";
    let candidateNumber = 1;
    let attemptNumber = 0;

    while (true) {
      const pair = await this.#availablePair(
        outputDirectory,
        baseName,
        unverified,
        candidateNumber
      );
      candidateNumber = pair.number;
      attemptNumber += 1;
      const tempToken = this.#randomUUID();
      const paths: AttemptPaths = {
        html: pair.paths.html,
        sidecar: pair.paths.sidecar,
        htmlTemp: joinVaultPath(
          outputDirectory,
          `.${pair.stem}.galley-tmp-${tempToken}-${attemptNumber}.html`
        ),
        sidecarTemp: joinVaultPath(
          outputDirectory,
          `.${pair.stem}.galley-tmp-${tempToken}-${attemptNumber}.json`
        )
      };
      const handles: AttemptHandles<Handle> = {
        htmlTemp: null,
        sidecarTemp: null,
        htmlFinal: null,
        sidecarFinal: null
      };

      try {
        handles.htmlTemp = await this.vault.createOwned(
          paths.htmlTemp,
          input.document.html
        );
        throwIfAborted(signal);
        handles.sidecarTemp = await this.vault.createOwned(
          paths.sidecarTemp,
          sidecarJson
        );
        throwIfAborted(signal);

        handles.htmlFinal = await commitOrCollide(
          this.vault,
          handles.htmlTemp,
          paths.html
        );
        await this.vault.removeOwned(handles.htmlTemp);
        handles.htmlTemp = null;
        throwIfAborted(signal);

        handles.sidecarFinal = await commitOrCollide(
          this.vault,
          handles.sidecarTemp,
          paths.sidecar
        );
        await this.vault.removeOwned(handles.sidecarTemp);
        handles.sidecarTemp = null;
        throwIfAborted(signal);

        if (
          !(await this.vault.owns(handles.htmlFinal)) ||
          !(await this.vault.owns(handles.sidecarFinal))
        ) {
          throw new Error("Galley artifact commit lost an owned final file.");
        }
        return { html: paths.html, sidecar: paths.sidecar };
      } catch (error) {
        await cleanupAttempt(this.vault, handles);
        if (error instanceof PairCollision && !isAbortError(error, signal)) {
          candidateNumber += 1;
          continue;
        }
        throw error;
      }
    }
  }

  async prepare(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!this.#outputFolder) {
      return;
    }
    try {
      await this.vault.ensureFolder(this.#outputFolder);
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      throw new ArtifactConfigurationError();
    }
    throwIfAborted(signal);
  }

  async #availablePair(
    directory: string,
    baseName: string,
    unverified: boolean,
    initialNumber: number
  ): Promise<{ number: number; stem: string; paths: ArtifactPaths }> {
    let number = initialNumber;
    while (true) {
      const numberedBase = number === 1 ? baseName : `${baseName}-${number}`;
      const stem = unverified ? `${numberedBase}.unverified` : numberedBase;
      const paths = {
        html: joinVaultPath(directory, `${stem}.galley.html`),
        sidecar: joinVaultPath(directory, `${stem}.galley.json`)
      };
      if (
        !(await this.vault.exists(paths.html)) &&
        !(await this.vault.exists(paths.sidecar))
      ) {
        return { number, stem, paths };
      }
      number += 1;
    }
  }
}

async function commitOrCollide<Handle>(
  vault: ArtifactVault<Handle>,
  handle: Handle,
  finalPath: string
): Promise<Handle> {
  const result = await vault.commitOwned(handle, finalPath);
  if (result.status === "collision") {
    throw new PairCollision();
  }
  return result.handle;
}

async function cleanupAttempt<Handle>(
  vault: ArtifactVault<Handle>,
  handles: AttemptHandles<Handle>
): Promise<void> {
  const owned = [
    handles.htmlTemp,
    handles.sidecarTemp,
    handles.htmlFinal,
    handles.sidecarFinal
  ];
  for (const handle of owned) {
    if (handle === null) {
      continue;
    }
    try {
      await vault.removeOwned(handle);
    } catch {
      // Cleanup is conditional and best-effort; preserve the original failure.
    }
  }
}

function validateSourcePath(sourcePath: string): string {
  if (
    !isNormalizedVaultRelativePath(sourcePath) ||
    !MARKDOWN_EXTENSION.test(sourcePath) ||
    sourceFileName(sourcePath).replace(MARKDOWN_EXTENSION, "").length === 0
  ) {
    throw new Error("Invalid source path: expected a normalized Markdown path.");
  }
  return sourcePath;
}

function validateConfiguredOutputFolder(configured: string): string {
  if (configured && !isNormalizedVaultRelativePath(configured)) {
    throw new ArtifactConfigurationError();
  }
  return configured;
}

function sourceDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function sourceFileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinVaultPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}
