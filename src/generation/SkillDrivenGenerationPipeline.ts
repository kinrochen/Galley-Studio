import { AiError } from "../ai/AiError";
import type { SkillSession } from "../skill/SkillSession";
import { annotateMarkdown } from "../source/SourceAnnotator";
import type { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import type {
  GenerateArticleInput,
  GeneratedDocument,
  GenerationCommandPipeline
} from "./SkillDrivenGenerationTypes";
import { extractFinalHtmlContent } from "./HtmlResponseExtractor";
import type { GenerationModelEvent } from "./GenerationProgress";

export type { GenerateArticleInput, GeneratedDocument } from "./SkillDrivenGenerationTypes";

export interface SkillDrivenGenerationPipelineDeps {
  readonly session: SkillSession;
  readonly themes: BuiltInThemeRepository;
  readonly onModelEvent?: (event: GenerationModelEvent) => void;
}

/**
 * The production generation path deliberately contains no theme-decision,
 * validation, repair, batching, or consistency controller. Galley loads the
 * selected Skill, gives the Agent one user prompt, and extracts the final HTML
 * artifact from the Agent's response before persistence.
 */
export class SkillDrivenGenerationPipeline implements GenerationCommandPipeline {
  readonly #session: SkillSession;
  readonly #themes: BuiltInThemeRepository;
  readonly #onModelEvent: ((event: GenerationModelEvent) => void) | undefined;

  constructor(dependencies: SkillDrivenGenerationPipelineDeps) {
    this.#session = dependencies.session;
    this.#themes = dependencies.themes;
    this.#onModelEvent = dependencies.onModelEvent;
  }

  async generate(
    input: GenerateArticleInput,
    signal: AbortSignal
  ): Promise<GeneratedDocument> {
    throwIfAborted(signal);
    const markdown = input.markdown.trim();
    if (!markdown || !input.sourcePath.trim()) {
      throw generationError("input_invalid", "Generation requires Markdown input.");
    }

    const manualTheme = input.manualThemeId?.trim()
      ? this.#themes.get(input.manualThemeId.trim())
      : undefined;
    if (input.manualThemeId?.trim() && !manualTheme) {
      throw generationError("theme_invalid", "The selected theme is unavailable.");
    }

    const prompt = composeSkillHandoffPrompt({
      markdown,
      sourcePath: input.sourcePath,
      ...(manualTheme ? { themeName: manualTheme.name, themeId: manualTheme.id } : {})
    });
    this.#onModelEvent?.({
      type: "prompt",
      text: prompt,
      at: Date.now()
    });
    const themeFiles = manualTheme
      ? [manualTheme.file]
      : this.#themes.list().map(({ file }) => file);
    const response = await this.#session.completeScopedWithRequiredFiles(
      prompt,
      ["references/common-components.md", ...themeFiles],
      signal
    );
    throwIfAborted(signal);

    let html: string;
    try {
      html = extractFinalHtmlContent(response);
    } catch {
      throw generationError(
        "generation_empty",
        "The Agent returned no usable HTML artifact."
      );
    }

    const theme = manualTheme ?? this.#themes.list()[0];
    if (!theme) {
      throw generationError("theme_invalid", "The active Skill has no themes.");
    }
    return {
      status: "verified",
      html,
      theme,
      source: annotateMarkdown(input.markdown),
      validation: { valid: true, issues: [] },
      skillAudit: this.#session.audit(),
      diagnostics: []
    };
  }
}

interface SkillHandoffPromptInput {
  readonly sourcePath: string;
  readonly markdown: string;
  readonly themeName?: string;
  readonly themeId?: string;
}

export function composeSkillHandoffPrompt(input: SkillHandoffPromptInput): string {
  const themeInstruction = input.themeName && input.themeId
    ? `Use the already selected theme “${input.themeName}” (${input.themeId}).`
    : "Use the Skill's automatic mode to infer the article structure and choose the most suitable registered theme.";
  return [
    "Use the already loaded gzh-design Skill to format the following Markdown as a WeChat Official Account article.",
    themeInstruction,
    "This is a complete, fully automatic request. The Markdown content, source path, and theme policy are already supplied below. Do not ask the user to provide article text, choose a style, confirm the structure, or answer follow-up questions.",
    "Follow the Skill itself as the complete generation procedure. Galley adds no validation, repair, batching, consistency, source-marker, or other control workflow.",
    "Return only the final HTML content for the article. Do not return explanations, JSON, Markdown fences, validation reports, audit data, or file paths.",
    "Produce exactly one final HTML artifact. Do not create or request preview files, sidecar files, manifests, temporary files, history files, or any other auxiliary artifact.",
    "The HTML must be directly usable as the final file and must keep the article body centered at the WeChat reading width defined by the Skill.",
    `Source path: ${JSON.stringify(input.sourcePath)}`,
    "",
    "Markdown source:",
    input.markdown
  ].join("\n");
}

function generationError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AiError("aborted");
}
