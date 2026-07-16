import { AiError } from "../ai/AiError";
import type { SkillSession } from "../skill/SkillSession";
import type { AnnotatedSource } from "../source/SourceAnnotator";
import type { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../themes/ThemeIndex";
import {
  composeThemeCorrectionPrompt,
  composeThemeDecisionPrompt
} from "./PromptComposer";

export type GenerationPipelineErrorCode =
  | "input_invalid"
  | "generation_empty"
  | "long_block_oversized"
  | "theme_invalid";

export class GenerationPipelineError extends Error {
  constructor(readonly code: GenerationPipelineErrorCode, message: string) {
    super(message);
    this.name = "GenerationPipelineError";
  }
}

export interface ThemeDecision {
  themeId: string;
  articleType: string;
  reason: string;
}

export interface SelectedThemeDecision {
  decision: ThemeDecision;
  theme: ThemeDefinition;
}

export function parseThemeDecision(
  modelText: string,
  themes: BuiltInThemeRepository
): ThemeDecision {
  const values = parseStrictStringObject(modelText);
  const required = ["themeId", "articleType", "reason"] as const;
  const keys = [...values.keys()].sort();
  if (
    keys.length !== required.length ||
    [...required].sort().some((key, index) => key !== keys[index])
  ) {
    throw themeInvalid();
  }

  const rawThemeId = values.get("themeId");
  const themeId = nonEmpty(rawThemeId);
  const articleType = nonEmpty(values.get("articleType"));
  const reason = nonEmpty(values.get("reason"));
  if (
    !themeId ||
    themeId !== rawThemeId ||
    !articleType ||
    !reason ||
    !themes.get(themeId)
  ) {
    throw themeInvalid();
  }
  return { themeId, articleType, reason };
}

export async function decideTheme(
  session: SkillSession,
  source: AnnotatedSource,
  themes: BuiltInThemeRepository,
  signal: AbortSignal
): Promise<SelectedThemeDecision> {
  const registered = themes.list();
  const firstResponse = await session.completeScoped(
    composeThemeDecisionPrompt({ source, themes: registered }),
    signal
  );
  throwIfAborted(signal);

  let decision: ThemeDecision;
  try {
    decision = parseThemeDecision(firstResponse, themes);
  } catch (error) {
    if (!(error instanceof GenerationPipelineError)) {
      throw error;
    }
    const corrected = await session.completeScoped(
      composeThemeCorrectionPrompt({
        invalidResponse: firstResponse,
        themes: registered
      }),
      signal
    );
    throwIfAborted(signal);
    decision = parseThemeDecision(corrected, themes);
  }

  const theme = themes.get(decision.themeId);
  if (!theme) {
    throw themeInvalid();
  }
  return { decision, theme };
}

function parseStrictStringObject(source: string): Map<string, string> {
  let offset = 0;
  const values = new Map<string, string>();
  const whitespace = (): void => {
    while (isJsonWhitespace(source[offset] ?? "")) {
      offset += 1;
    }
  };
  const character = (expected: string): void => {
    if (source[offset] !== expected) {
      throw themeInvalid();
    }
    offset += 1;
  };
  const string = (): string => {
    if (source[offset] !== '"') {
      throw themeInvalid();
    }
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const current = source[offset];
      if (current === '"') {
        offset += 1;
        try {
          const parsed = JSON.parse(source.slice(start, offset)) as unknown;
          if (typeof parsed !== "string") {
            throw themeInvalid();
          }
          return parsed;
        } catch {
          throw themeInvalid();
        }
      }
      if (current === "\\") {
        offset += 2;
      } else {
        offset += 1;
      }
    }
    throw themeInvalid();
  };

  whitespace();
  character("{");
  whitespace();
  if (source[offset] === "}") {
    offset += 1;
  } else {
    while (true) {
      const key = string();
      if (values.has(key)) {
        throw themeInvalid();
      }
      whitespace();
      character(":");
      whitespace();
      const value = string();
      values.set(key, value);
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        break;
      }
      character(",");
      whitespace();
    }
  }
  whitespace();
  if (offset !== source.length) {
    throw themeInvalid();
  }
  return values;
}

function isJsonWhitespace(value: string): boolean {
  return value === "\t" || value === "\n" || value === "\r" || value === " ";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function themeInvalid(): GenerationPipelineError {
  return new GenerationPipelineError(
    "theme_invalid",
    "The model did not return one valid registered theme decision."
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AiError("aborted");
  }
}
