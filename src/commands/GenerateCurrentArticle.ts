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
import {
  ENGLISH_LOCALIZED_TEXT,
  type LocalizedText
} from "../i18n/LocalizedText";
import type { GenerationStage } from "../generation/GenerationProgress";

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
  progress?(stage: GenerationStage): void;
  readonly text?: Pick<LocalizedText, "t">;
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
  const text = context.text ?? ENGLISH_LOCALIZED_TEXT;
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

    context.progress?.("reading");
    context.notice(text.t("generation.notice.reading"));
    const markdown = await context.read(activeFile);
    throwIfAborted(signal);
    context.progress?.("loading-skill");
    context.notice(text.t("generation.notice.loading"));
    const generation = await context.createPipeline(settings, signal);
    throwIfAborted(signal);
    context.progress?.("generating");
    context.notice(text.t("generation.notice.generating"));
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
    context.progress?.("validating");
    context.notice(text.t("generation.notice.validating"));
    context.progress?.("saving");
    context.notice(text.t("generation.notice.saving"));
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
      text.t(
        document.status === "unverified"
          ? "generation.notice.unverified"
          : "generation.notice.generated",
        { html: paths.html, sidecar: paths.sidecar }
      )
    );
    if (context.openArtifact) {
      try {
        await context.openArtifact(paths.html);
      } catch {
        context.notice(text.t("generation.notice.openFailed"));
      }
    }
    return paths;
  } catch (error) {
    context.notice(generationFailureMessage(error, signal, text));
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

export function generationFailureMessage(
  error: unknown,
  signal: AbortSignal,
  text: Pick<LocalizedText, "t">
): string {
  if (signal.aborted || errorCode(error) === "aborted") {
    return text.t("generation.error.cancelled");
  }
  if (error instanceof GenerateCommandError) {
    return error.code === "missing_markdown"
      ? text.t("generation.error.missingMarkdown")
      : text.t("generation.error.missingModel");
  }
  if (error instanceof ArtifactConfigurationError) {
    return text.t("generation.error.outputFolder");
  }
  if (error instanceof AiError) {
    if (error.code === "missing_secret") {
      return text.t("generation.error.missingSecret");
    }
    if (error.code === "invalid_base_url") {
      return text.t("generation.error.baseUrl");
    }
    if (error.code === "timeout") {
      return text.t("generation.error.timeout");
    }
    if (error.code === "http_error") {
      if (error.status === 401 || error.status === 403) {
        return text.t("generation.error.authorization");
      }
      if (error.status === 429 || (error.status !== null && error.status >= 500)) {
        return text.t("generation.error.providerUnavailable");
      }
      if (error.status === 400 || error.status === 404 || error.status === 422) {
        return text.t("generation.error.compatibility");
      }
      if (error.status === 413) {
        return text.t("generation.error.requestTooLarge");
      }
    }
    if (error.code === "network_error") {
      return text.t("generation.error.network");
    }
    if (error.code === "invalid_response") {
      return text.t("generation.error.invalidResponse");
    }
    if (error.code === "tool_round_limit") {
      return text.t("generation.error.skillLoading");
    }
  }
  switch (errorCode(error)) {
    case "theme_invalid":
      return text.t("generation.error.themeDecision");
    case "input_invalid":
      return text.t("generation.error.inputInvalid");
    case "long_block_oversized":
      return text.t("generation.error.longBlock");
  }
  return text.t("generation.error.failed");
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
