import { AiError } from "../ai/AiError";
import { assertShellFreeHtmlFragment } from "../documents/HtmlShellScanner";
import type { SkillLoadAudit } from "../skill/SkillAudit";
import type { SkillSession } from "../skill/SkillSession";
import {
  estimateTokens,
  planDocumentBatches,
  shouldUseLongMode,
  type DocumentBatch
} from "../source/LongDocumentPlanner";
import {
  annotateMarkdown,
  type AnnotatedSource
} from "../source/SourceAnnotator";
import type { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../themes/ThemeIndex";
import type {
  ValidationIssue,
  ValidationReport
} from "../validation/ValidationIssue";
import type {
  LongBatchConsistencyManifest,
  LongBatchDesignEvidenceEntry
} from "./GenerationTypes";
import {
  composeGenerationPrompt,
  composeLongBatchConsistencyPrompt,
  composeLongBatchPrompt,
  composeLongBatchRepairPrompt
} from "./PromptComposer";
import {
  EMPTY_SAFE_AUTHORING_HTML,
  evaluateBoundaryFailure,
  evaluateCandidate,
  missingSourceBlocksForIssues,
  retainLastSanitizedCandidate,
  runRepairLoop,
  type CandidateEvaluation
} from "./RepairLoop";
import {
  decideTheme,
  GenerationPipelineError
} from "./ThemeDecision";
import { applyWechatArticleFrame } from "./WechatArticleFrame";

export { GenerationPipelineError } from "./ThemeDecision";

export const MANUAL_THEME_ARTICLE_TYPE = "general-article";
export const LONG_MODE_SOURCE_BUDGET_RATIO = 0.5;
export const DIRECT_GENERATION_SOURCE_TOKEN_LIMIT = 12_000;
export const MAX_LONG_BATCH_SOURCE_TOKENS = 4_000;
const COMMON_COMPONENTS_FILE = "references/common-components.md";
const MAX_LONG_REPAIR_ROUNDS = 2;
const MAX_DESIGN_EVIDENCE_ENTRIES = 12;
const MAX_DESIGN_EVIDENCE_VALUE_LENGTH = 80;

export interface GenerateArticleInput {
  sourcePath: string;
  markdown: string;
  manualThemeId?: string;
  modelContextWindow: number;
}

export interface GeneratedDocument {
  status: "verified" | "unverified";
  html: string;
  theme: ThemeDefinition;
  source: AnnotatedSource;
  validation: ValidationReport;
  skillAudit: SkillLoadAudit;
  diagnostics: ValidationIssue[];
}

export interface GenerationPipelineDeps {
  session: SkillSession;
  themes: BuiltInThemeRepository;
}

interface LongBatchState {
  batch: DocumentBatch;
  source: AnnotatedSource;
  fragment: string;
  candidate: CandidateEvaluation;
  consistencyChecked: boolean;
}

export class GenerationPipeline {
  readonly #session: SkillSession;
  readonly #themes: BuiltInThemeRepository;

  constructor(deps: GenerationPipelineDeps) {
    this.#session = deps.session;
    this.#themes = deps.themes;
  }

  async generate(
    input: GenerateArticleInput,
    signal: AbortSignal
  ): Promise<GeneratedDocument> {
    throwIfAborted(signal);
    validateInput(input);
    const source = annotateMarkdown(input.markdown);

    await this.#session.bootstrap(signal);
    throwIfAborted(signal);

    let theme: ThemeDefinition;
    let articleType: string;
    if (input.manualThemeId !== undefined) {
      theme = this.#themes.get(input.manualThemeId) ?? failInvalidTheme();
      articleType = MANUAL_THEME_ARTICLE_TYPE;
    } else {
      const selected = await decideTheme(
        this.#session,
        source,
        this.#themes,
        signal
      );
      theme = selected.theme;
      articleType = selected.decision.articleType;
    }

    await this.#session.ensureFiles(
      [theme.file, COMMON_COMPONENTS_FILE],
      signal
    );
    throwIfAborted(signal);

    const estimatedSourceTokens = estimateTokens(input.markdown);
    // A model can fit a medium source in context yet still time out while
    // expanding the whole article into styled HTML. Bound the direct path by
    // expected output work as well as the provider context window.
    const longMode =
      estimatedSourceTokens > DIRECT_GENERATION_SOURCE_TOKEN_LIMIT ||
      shouldUseLongMode(estimatedSourceTokens, input.modelContextWindow);
    let final: CandidateEvaluation;
    if (longMode) {
      final = await this.#generateLongCandidate(
        source,
        theme,
        articleType,
        input.modelContextWindow,
        signal
      );
    } else {
      const initial = await this.#generateDirectCandidate(
        source,
        theme,
        articleType,
        signal
      );
      final = await runRepairLoop({
        session: this.#session,
        source,
        initial,
        signal
      });
    }
    throwIfAborted(signal);
    final = {
      ...final,
      html: applyWechatArticleFrame(final.html)
    };
    assertGeneratedArticleIsNotEmpty(final.html);

    const diagnostics = final.validation.issues;
    return {
      status: final.validation.valid ? "verified" : "unverified",
      html: final.html,
      theme,
      source,
      validation: final.validation,
      skillAudit: this.#session.audit(),
      diagnostics
    };
  }

  async #generateDirectCandidate(
    source: AnnotatedSource,
    theme: ThemeDefinition,
    articleType: string,
    signal: AbortSignal
  ): Promise<CandidateEvaluation> {
    const response = await this.#session.completeScoped(
      composeGenerationPrompt({ source, theme, articleType }),
      signal
    );
    throwIfAborted(signal);
    return evaluateCandidate(response, source);
  }

  async #generateLongCandidate(
    source: AnnotatedSource,
    theme: ThemeDefinition,
    articleType: string,
    contextWindow: number,
    signal: AbortSignal
  ): Promise<CandidateEvaluation> {
    // Reserve half the window for the loaded Skill, Authoring profile,
    // compact manifest, conversation framing, and the fragment response.
    const budget = Math.max(
      1,
      Math.min(
        MAX_LONG_BATCH_SOURCE_TOKENS,
        Math.floor(contextWindow * LONG_MODE_SOURCE_BUDGET_RATIO)
      )
    );
    let batches: DocumentBatch[];
    try {
      batches = planDocumentBatches(source, budget);
    } catch {
      throw new GenerationPipelineError(
        "long_block_oversized",
        "A single source block exceeds the long-document batch budget."
      );
    }
    const states: LongBatchState[] = [];

    for (const batch of batches) {
      const response = await this.#session.completeScoped(
        composeLongBatchPrompt({ batch, theme, articleType }),
        signal
      );
      throwIfAborted(signal);
      states.push(evaluateLongBatch(response, batch));
    }

    const normalizationEvidence = designEvidence(states);
    for (const state of states) {
      if (!state.candidate.validation.valid) {
        continue;
      }
      const normalized = await this.#normalizeLongBatch(
        state,
        states,
        normalizationEvidence,
        theme,
        articleType,
        signal
      );
      Object.assign(state, normalized);
    }

    for (let round = 0; round < MAX_LONG_REPAIR_ROUNDS; round += 1) {
      const roundEvidence = designEvidence(states);
      const affected = states.filter(
        ({ candidate }) => !candidate.validation.valid
      );
      if (affected.length === 0) {
        break;
      }
      for (const state of affected) {
        const response = await this.#session.completeScoped(
          composeLongBatchRepairPrompt({
            articleType,
            batch: state.batch,
            batchManifest: batchManifest(
              states,
              state,
              roundEvidence
            ),
            currentFragment: state.fragment,
            issues: state.candidate.validation.issues,
            missingSourceBlocks: missingSourceBlocksForIssues(
              state.source,
              state.candidate.validation.issues
            ),
            theme
          }),
          signal
        );
        throwIfAborted(signal);
        updateLongBatch(state, response);
        if (
          state.candidate.validation.valid &&
          !state.consistencyChecked
        ) {
          const normalized = await this.#normalizeLongBatch(
            state,
            states,
            roundEvidence,
            theme,
            articleType,
            signal
          );
          Object.assign(state, normalized);
        }
      }
    }

    return assembleLongCandidate(states, source);
  }

  async #normalizeLongBatch(
    state: LongBatchState,
    states: readonly LongBatchState[],
    evidence: LongBatchConsistencyManifest["designEvidence"],
    theme: ThemeDefinition,
    articleType: string,
    signal: AbortSignal
  ): Promise<LongBatchState> {
    const response = await this.#session.completeScoped(
      composeLongBatchConsistencyPrompt({
        articleType,
        batch: state.batch,
        batchManifest: batchManifest(states, state, evidence),
        currentFragment: state.fragment,
        theme
      }),
      signal
    );
    throwIfAborted(signal);
    const normalized = { ...state, consistencyChecked: true };
    updateLongBatch(normalized, response);
    return normalized;
  }
}

function evaluateLongBatch(
  modelText: string,
  batch: DocumentBatch
): LongBatchState {
  const source = batchSource(batch);
  try {
    const fragment = parseBatchFragment(modelText, batch);
    const candidate = evaluateCandidate(wrapFragment(fragment), source);
    return {
      batch,
      source,
      fragment: articleFragment(candidate.html),
      candidate,
      consistencyChecked: false
    };
  } catch {
    const candidate = evaluateBoundaryFailure(source, {
      code: "long_batch_invalid",
      severity: "error",
      message: `Long-document batch ${batch.id} did not return its assigned source markers exactly once in order.`
    });
    return {
      batch,
      source,
      fragment: "",
      candidate,
      consistencyChecked: false
    };
  }
}

function updateLongBatch(state: LongBatchState, modelText: string): void {
  const next = evaluateLongBatch(modelText, state.batch).candidate;
  state.candidate = retainLastSanitizedCandidate(state.candidate, next);
  state.fragment = articleFragment(state.candidate.html);
}

function parseBatchFragment(
  modelText: string,
  batch: DocumentBatch
): DocumentFragment {
  let source = stripSingleHtmlFence(modelText.trim());
  if (!source) {
    throw new Error("Long batch output is empty");
  }

  if (/<!doctype\s+html|<html(?:\s|>)|<body(?:\s|>)/iu.test(source)) {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    source =
      parsed.querySelector("body > article")?.innerHTML ??
      parsed.body.innerHTML;
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const rootArticle = singleElementRoot(template.content, "article");
  if (rootArticle) {
    template.innerHTML = rootArticle.innerHTML;
  }
  if (template.content.querySelector("article")) {
    throw new Error("Long batch output contains a nested article root");
  }
  assertShellFreeHtmlFragment(template.innerHTML, "body");

  const markerElements = [
    ...template.content.querySelectorAll("[data-galley-source]")
  ];
  const actual = markerElements.map(
    (element) => element.getAttribute("data-galley-source") ?? ""
  );
  if (!sameSequence(actual, batch.blockIds)) {
    throw new Error("Long batch source markers do not match the assignment");
  }
  return template.content.cloneNode(true) as DocumentFragment;
}

function stripSingleHtmlFence(source: string): string {
  const fenced = source.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/iu);
  return fenced?.[1]?.trim() ?? source;
}

function singleElementRoot(
  fragment: DocumentFragment,
  tagName: string
): Element | undefined {
  const meaningfulNodes = [...fragment.childNodes].filter(
    (node) =>
      node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim())
  );
  const only = meaningfulNodes[0];
  return meaningfulNodes.length === 1 &&
    only instanceof Element &&
    only.tagName.toLowerCase() === tagName
    ? only
    : undefined;
}

function wrapFragment(fragment: DocumentFragment): string {
  const wrapped = new DOMParser().parseFromString(
    EMPTY_SAFE_AUTHORING_HTML,
    "text/html"
  );
  const article = wrapped.querySelector("body > article");
  if (!article) {
    throw new Error("Safe batch shell is missing its article root");
  }
  for (const node of [...fragment.childNodes]) {
    article.append(wrapped.importNode(node, true));
  }
  return `<!DOCTYPE html>${wrapped.documentElement.outerHTML}`;
}

function articleFragment(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.querySelector("body > article")?.innerHTML ?? "";
}

function batchSource(batch: DocumentBatch): AnnotatedSource {
  return {
    original: batch.blocks.map(({ markdown }) => markdown).join("\n\n"),
    promptMarkdown: batch.promptMarkdown,
    blocks: [...batch.blocks]
  };
}

function batchManifest(
  states: readonly LongBatchState[],
  current: LongBatchState,
  evidence: LongBatchConsistencyManifest["designEvidence"]
): LongBatchConsistencyManifest {
  const index = states.indexOf(current);
  if (index < 0) {
    throw new Error("Current long-document batch is not in the batch plan");
  }
  return {
    totalBatches: states.length,
    currentPosition: index + 1,
    previousBatchId: states[index - 1]?.batch.id ?? null,
    nextBatchId: states[index + 1]?.batch.id ?? null,
    designEvidence: evidence
  };
}

function designEvidence(
  states: readonly LongBatchState[]
): LongBatchConsistencyManifest["designEvidence"] {
  const directChildPatterns = new Map<string, number>();
  const classNames = new Map<string, number>();
  const elementTags = new Map<string, number>();
  const headingLevels = new Map<string, number>();
  const inlineStyleDeclarations = new Map<string, number>();

  for (const state of states) {
    if (!state.candidate.sanitized || !state.fragment) {
      continue;
    }
    const template = document.createElement("template");
    template.innerHTML = state.fragment;
    for (const child of template.content.children) {
      incrementEvidence(directChildPatterns, elementPattern(child));
    }
    for (const element of template.content.querySelectorAll("*")) {
      const tag = element.tagName.toLowerCase();
      incrementEvidence(elementTags, tag);
      if (/^h[1-6]$/.test(tag)) {
        incrementEvidence(headingLevels, tag);
      }
      for (const className of safeClassNames(element)) {
        incrementEvidence(classNames, className);
      }
      for (const declaration of safeInlineStyleDeclarations(element)) {
        incrementEvidence(inlineStyleDeclarations, declaration);
      }
    }
  }

  return {
    sourceBatchCount: states.length,
    directChildPatterns: topEvidence(directChildPatterns),
    classNames: topEvidence(classNames),
    elementTags: topEvidence(elementTags),
    headingLevels: topEvidence(headingLevels),
    inlineStyleDeclarations: topEvidence(inlineStyleDeclarations)
  };
}

function elementPattern(element: Element): string {
  let pattern = element.tagName.toLowerCase();
  for (const className of safeClassNames(element).slice(0, 3)) {
    const next = `${pattern}.${className}`;
    if (next.length > MAX_DESIGN_EVIDENCE_VALUE_LENGTH) {
      break;
    }
    pattern = next;
  }
  return pattern;
}

function safeClassNames(element: Element): string[] {
  return [...element.classList]
    .filter((value) => /^[A-Za-z0-9_-]+$/.test(value))
    .filter((value) => value.length <= MAX_DESIGN_EVIDENCE_VALUE_LENGTH)
    .sort();
}

function safeInlineStyleDeclarations(element: Element): string[] {
  if (!(element instanceof HTMLElement) || !element.hasAttribute("style")) {
    return [];
  }
  const declarations: string[] = [];
  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index).trim().toLowerCase();
    const value = element.style
      .getPropertyValue(property)
      .trim()
      .replace(/\s+/g, " ");
    const priority = element.style.getPropertyPriority(property);
    const declaration = `${property}:${value}${
      priority ? ` !${priority}` : ""
    }`;
    if (
      property &&
      value &&
      declaration.length <= MAX_DESIGN_EVIDENCE_VALUE_LENGTH
    ) {
      declarations.push(declaration);
    }
  }
  return declarations.sort();
}

function incrementEvidence(counts: Map<string, number>, value: string): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function topEvidence(
  counts: ReadonlyMap<string, number>
): LongBatchDesignEvidenceEntry[] {
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, MAX_DESIGN_EVIDENCE_ENTRIES);
}

function assembleLongCandidate(
  states: readonly LongBatchState[],
  source: AnnotatedSource
): CandidateEvaluation {
  const assembled = new DOMParser().parseFromString(
    EMPTY_SAFE_AUTHORING_HTML,
    "text/html"
  );
  const article = assembled.querySelector("body > article");
  if (!article) {
    throw new Error("Safe long-document shell is missing its article root");
  }
  for (const state of states) {
    const template = document.createElement("template");
    template.innerHTML = state.fragment;
    for (const node of [...template.content.childNodes]) {
      article.append(assembled.importNode(node, true));
    }
  }
  const candidate = evaluateCandidate(
    `<!DOCTYPE html>${assembled.documentElement.outerHTML}`,
    source
  );
  const batchIssues = states
    .filter(({ candidate: batch }) => !batch.validation.valid)
    .flatMap(({ candidate: batch }) => batch.validation.issues);
  if (batchIssues.length === 0) {
    return candidate;
  }
  const issues = uniqueIssues([...batchIssues, ...candidate.validation.issues]);
  return {
    ...candidate,
    validation: { valid: false, issues }
  };
}

function sameSequence(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function uniqueIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.code,
      issue.severity,
      issue.message,
      issue.sourceId ?? null,
      issue.selector ?? null
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function validateInput(input: GenerateArticleInput): void {
  const manualThemeInvalid =
    input.manualThemeId !== undefined &&
    (typeof input.manualThemeId !== "string" || !input.manualThemeId.trim());
  if (
    typeof input.sourcePath !== "string" ||
    !input.sourcePath.trim() ||
    !/\.md$/i.test(input.sourcePath.trim()) ||
    typeof input.markdown !== "string" ||
    !input.markdown.trim() ||
    !Number.isFinite(input.modelContextWindow) ||
    input.modelContextWindow <= 0 ||
    manualThemeInvalid
  ) {
    throw new GenerationPipelineError(
      "input_invalid",
      "Generation requires a non-empty Markdown source and a positive model context window."
    );
  }
}

function assertGeneratedArticleIsNotEmpty(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const article = parsed.querySelector("body > article");
  if (!article || !article.innerHTML.trim()) {
    throw new GenerationPipelineError(
      "generation_empty",
      "The generation provider returned no usable article body after repair."
    );
  }
}

function failInvalidTheme(): never {
  throw new GenerationPipelineError(
    "theme_invalid",
    "The manually selected theme is not registered."
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AiError("aborted");
  }
}
