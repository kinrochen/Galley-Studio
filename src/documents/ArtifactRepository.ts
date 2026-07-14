import type { GeneratedDocument } from "../generation/GenerationPipeline";
import {
  buildGalleySidecarV1,
  isNormalizedVaultRelativePath,
  type GalleySidecarV1
} from "./GalleySidecar";

export interface ArtifactVault {
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  create(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
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

interface WriteState {
  htmlTempCreated: boolean;
  sidecarTempCreated: boolean;
  htmlFinalCreated: boolean;
  sidecarFinalCreated: boolean;
}

interface AttemptPaths extends ArtifactPaths {
  htmlTemp: string;
  sidecarTemp: string;
}

const MARKDOWN_EXTENSION = /\.md$/i;

export class ArtifactRepository {
  readonly #outputFolder: string;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;
  readonly #serialize: (value: GalleySidecarV1) => string;

  constructor(
    private readonly vault: ArtifactVault,
    options: ArtifactRepositoryOptions = {}
  ) {
    this.#outputFolder = validateConfiguredOutputFolder(
      options.outputFolder ?? ""
    );
    this.#now = options.now ?? (() => new Date());
    this.#randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.#serialize =
      options.serialize ?? ((value) => `${JSON.stringify(value, null, 2)}\n`);
  }

  async writeNew(
    input: WriteArtifactInput,
    signal?: AbortSignal
  ): Promise<ArtifactPaths> {
    throwIfAborted(signal);
    const sourcePath = validateSourcePath(input.sourcePath);
    const outputDirectory = validateOutputDirectory(
      this.#outputFolder,
      sourceDirectory(sourcePath)
    );
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
      const state: WriteState = {
        htmlTempCreated: false,
        sidecarTempCreated: false,
        htmlFinalCreated: false,
        sidecarFinalCreated: false
      };

      try {
        await this.vault.create(paths.htmlTemp, input.document.html);
        state.htmlTempCreated = true;
        throwIfAborted(signal);
        await this.vault.create(paths.sidecarTemp, sidecarJson);
        state.sidecarTempCreated = true;
        throwIfAborted(signal);

        await this.vault.rename(paths.htmlTemp, paths.html);
        state.htmlTempCreated = false;
        state.htmlFinalCreated = true;
        throwIfAborted(signal);
        await this.vault.rename(paths.sidecarTemp, paths.sidecar);
        state.sidecarTempCreated = false;
        state.sidecarFinalCreated = true;
        throwIfAborted(signal);

        if (
          !(await this.vault.exists(paths.html)) ||
          !(await this.vault.exists(paths.sidecar))
        ) {
          throw new Error("Galley artifact commit did not produce both files.");
        }
        return { html: paths.html, sidecar: paths.sidecar };
      } catch (error) {
        const raced =
          (!state.htmlFinalCreated && (await safelyExists(this.vault, paths.html))) ||
          (!state.sidecarFinalCreated &&
            (await safelyExists(this.vault, paths.sidecar)));
        await cleanupAttempt(this.vault, paths, state);
        if (raced && !isAbortError(error, signal)) {
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

async function cleanupAttempt(
  vault: ArtifactVault,
  paths: AttemptPaths,
  state: WriteState
): Promise<void> {
  const cleanupPaths: string[] = [];
  if (state.htmlTempCreated) cleanupPaths.push(paths.htmlTemp);
  if (state.sidecarTempCreated) cleanupPaths.push(paths.sidecarTemp);
  if (state.htmlFinalCreated) cleanupPaths.push(paths.html);
  if (state.sidecarFinalCreated) cleanupPaths.push(paths.sidecar);
  for (const path of cleanupPaths) {
    try {
      await vault.remove(path);
    } catch {
      // Best-effort cleanup must never replace the original failure.
    }
  }
}

async function safelyExists(vault: ArtifactVault, path: string): Promise<boolean> {
  try {
    return await vault.exists(path);
  } catch {
    return false;
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

function validateOutputDirectory(configured: string, fallback: string): string {
  if (!configured) {
    return fallback;
  }
  return configured;
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
