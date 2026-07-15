import { AiError } from "../ai/AiError";
import type {
  ArtifactPaths,
  WriteArtifactInput
} from "../documents/ArtifactRepository";
import { ArtifactConfigurationError } from "../documents/ArtifactRepository";
import type {
  GenerateArticleInput,
  GeneratedDocument
} from "../generation/GenerationPipeline";
import {
  normalizeSettings,
  type GalleySettings
} from "../settings/GalleySettings";

export interface ActiveMarkdownFile {
  path: string;
  extension: string;
}

export interface GenerationCommandPipeline {
  generate(
    input: GenerateArticleInput,
    signal: AbortSignal
  ): Promise<GeneratedDocument>;
}

export interface GenerationCommandDependencies {
  model: string;
  pipeline: GenerationCommandPipeline;
}

export interface GenerationCommandArtifactWriter {
  prepare?(signal?: AbortSignal): Promise<void>;
  writeNew(
    input: WriteArtifactInput,
    signal?: AbortSignal
  ): Promise<ArtifactPaths>;
}

export interface GenerateCurrentArticleContext {
  getActiveFile(): ActiveMarkdownFile | null;
  read(file: ActiveMarkdownFile): Promise<string>;
  getSettings(): unknown;
  readonly manualThemeId?: string;
  createPipeline(
    settings: Readonly<GalleySettings>,
    signal: AbortSignal
  ): Promise<GenerationCommandDependencies>;
  createRepository(
    settings: Readonly<GalleySettings>
  ): GenerationCommandArtifactWriter;
  openArtifact?(htmlPath: string): Promise<void>;
  notice(message: string): void;
}

export type GenerateCommandErrorCode =
  | "missing_markdown"
  | "missing_model";

export class GenerateCommandError extends Error {
  constructor(readonly code: GenerateCommandErrorCode) {
    super(code);
    this.name = "GenerateCommandError";
  }
}

export async function generateCurrentArticle(
  context: GenerateCurrentArticleContext,
  signal: AbortSignal
): Promise<ArtifactPaths> {
  try {
    throwIfAborted(signal);
    const activeFile = context.getActiveFile();
    if (!isMarkdownFile(activeFile)) {
      throw new GenerateCommandError("missing_markdown");
    }

    const settings = Object.freeze(normalizeSettings(context.getSettings()));
    if (!settings.model.trim()) {
      throw new GenerateCommandError("missing_model");
    }
    const repository = context.createRepository(settings);
    await repository.prepare?.(signal);
    throwIfAborted(signal);

    context.notice("Galley: Reading current Markdown.");
    const markdown = await context.read(activeFile);
    throwIfAborted(signal);
    context.notice("Galley: Loading generation dependencies.");
    const generation = await context.createPipeline(settings, signal);
    throwIfAborted(signal);
    context.notice("Galley: Generating article.");
    const document = await generation.pipeline.generate(
      {
        sourcePath: activeFile.path,
        markdown,
        modelContextWindow: settings.contextWindow,
        ...(context.manualThemeId?.trim()
          ? { manualThemeId: context.manualThemeId.trim() }
          : {})
      },
      signal
    );
    throwIfAborted(signal);
    context.notice("Galley: Validating generated article.");
    context.notice("Galley: Saving independent artifacts.");
    const paths = await repository.writeNew(
      {
        sourcePath: activeFile.path,
        markdown,
        document,
        model: generation.model
      },
      signal
    );
    throwIfAborted(signal);

    context.notice(
      document.status === "unverified"
        ? `Galley: Saved UNVERIFIED DRAFT ${paths.html} and ${paths.sidecar}.`
        : `Galley: Generated ${paths.html} and ${paths.sidecar}.`
    );
    if (context.openArtifact) {
      try {
        await context.openArtifact(paths.html);
      } catch {
        context.notice(
          "Galley: The article was generated, but the workbench could not open it."
        );
      }
    }
    return paths;
  } catch (error) {
    context.notice(safeFailureNotice(error, signal));
    throw error;
  }
}

function isMarkdownFile(
  file: ActiveMarkdownFile | null
): file is ActiveMarkdownFile {
  return (
    file !== null &&
    file.extension.toLowerCase() === "md" &&
    file.path.toLowerCase().endsWith(".md")
  );
}

function safeFailureNotice(error: unknown, signal: AbortSignal): string {
  if (signal.aborted || errorCode(error) === "aborted") {
    return "Galley: Generation cancelled.";
  }
  if (error instanceof GenerateCommandError) {
    return error.code === "missing_markdown"
      ? "Galley: Open one Markdown file before generating."
      : "Galley: Configure a model before generating.";
  }
  if (error instanceof ArtifactConfigurationError) {
    return "Galley: Configure a valid vault-relative output folder.";
  }
  if (error instanceof AiError) {
    if (error.code === "missing_secret") {
      return "Galley: Configure an API key before generating.";
    }
    if (error.code === "invalid_base_url") {
      return "Galley: Check the configured provider Base URL.";
    }
    if (error.code === "timeout") {
      return "Galley: The AI request timed out.";
    }
    if (error.code === "http_error") {
      if (error.status === 401 || error.status === 403) {
        return "Galley: The provider rejected the API key or permissions.";
      }
      if (error.status === 429 || (error.status !== null && error.status >= 500)) {
        return "Galley: The provider is temporarily unavailable; try again.";
      }
    }
  }
  return "Galley: Generation failed. Check settings and try again.";
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AiError("aborted");
  }
}
