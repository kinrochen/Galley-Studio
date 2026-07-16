import type { ProviderCapabilities } from "../ai/CapabilityProbe";
import { safePreviewHtml } from "../preview/SafeHtmlPreview";
import type { SkillLoadAudit } from "../skill/SkillAudit";
import type { SkillSession } from "../skill/SkillSession";
import type { CustomThemeRepository, StoredThemeFiles } from "../themes/CustomThemeRepository";
import { createThemeManifest } from "../themes/ThemeManifest";
import {
  ComponentLibraryValidator,
  report,
  type ThemeValidationIssue,
  type ThemeValidationReport
} from "./ComponentLibraryValidator";
import {
  validateReferenceImage,
  type ReferenceImageInput
} from "./ReferenceImage";

export const THEME_GENERATION_REQUIRED_FILES = Object.freeze([
  "SKILL.md",
  "references/theme-index.md",
  "references/theme-generator.md",
  "references/common-components.md"
] as const);

export interface ThemeGenerationInput {
  readonly description: string;
  readonly referenceImage?: ReferenceImageInput;
}

export interface ThemeDraft extends StoredThemeFiles {
  readonly description?: string;
  readonly finalized?: boolean;
  readonly skillAudit: SkillLoadAudit;
  readonly validation: ThemeValidationReport;
}

export type ThemeGenerationStage =
  | "drafting"
  | "loading-rules"
  | "finalizing"
  | "validating"
  | "saving";

export type ThemeGenerationProgress = (stage: ThemeGenerationStage) => void;

export interface ThemeGenerationServiceOptions {
  readonly session: SkillSession;
  readonly capabilities: ProviderCapabilities;
  readonly repository: CustomThemeRepository;
  readonly now?: () => Date;
}

export class ThemeGenerationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ThemeGenerationError";
  }
}

export class ThemeGenerationService {
  readonly #session: SkillSession;
  readonly #capabilities: ProviderCapabilities;
  readonly #repository: CustomThemeRepository;
  readonly #now: () => Date;
  readonly #componentValidator = new ComponentLibraryValidator();

  constructor(options: ThemeGenerationServiceOptions) {
    this.#session = options.session;
    this.#capabilities = { ...options.capabilities };
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  async generate(
    input: ThemeGenerationInput,
    signal: AbortSignal,
    progress?: ThemeGenerationProgress
  ): Promise<ThemeDraft> {
    const description = input.description.trim();
    if (!description || description.length > 12_000) {
      throw new ThemeGenerationError(
        "theme_description_invalid",
        "Theme conversation must contain 1 to 12,000 characters."
      );
    }

    let imageDataUrl: string | undefined;
    if (input.referenceImage) {
      if (!this.#capabilities.vision) {
        throw new ThemeGenerationError(
          "vision_unavailable",
          "The configured model has no confirmed vision capability."
        );
      }
      imageDataUrl = validateReferenceImage(input.referenceImage).dataUrl;
    }

    progress?.("drafting");
    const prompt = composeDraftPrompt(description, imageDataUrl !== undefined);
    let response = "";
    try {
      response = imageDataUrl
        ? await this.#session.completeScopedWithImage(
            prompt,
            imageDataUrl,
            signal
          )
        : await this.#session.completeScopedWithRequiredFiles(
            prompt,
            [],
            signal
          );
    } catch (error) {
      if (errorCode(error) !== "invalid_response") throw error;
    }
    progress?.("validating");
    const now = this.#now();
    const parsed = parseDraftResponse(response, description, now);
    const manifest = createThemeManifest(parsed.manifest, now);
    let previewHtml: string;
    try {
      previewHtml = safePreviewHtml(parsed.previewHtml);
    } catch {
      previewHtml = safePreviewHtml(createFallbackPreview(description));
    }
    const issues = validatePreview(previewHtml, 8, 12);

    return Object.freeze({
      manifest,
      componentLibrary: "",
      previewHtml,
      description,
      finalized: false,
      skillAudit: this.#session.audit(),
      validation: report(issues)
    });
  }

  async finalizeAndSave(
    draft: ThemeDraft,
    signal: AbortSignal,
    progress?: ThemeGenerationProgress
  ): Promise<ThemeDraft> {
    if (!draft.validation.valid || !draft.description) {
      throw new ThemeGenerationError(
        "theme_validation_failed",
        "A valid theme concept is required before finalization."
      );
    }

    progress?.("loading-rules");
    progress?.("finalizing");
    const response = await this.#session.completeScopedWithRequiredFiles(
      composeFinalPrompt(draft),
      THEME_GENERATION_REQUIRED_FILES,
      signal
    );
    progress?.("validating");
    let componentLibrary = parseComponentLibraryResponse(response);
    let componentValidation = this.#componentValidator.validate(
      componentLibrary
    );
    if (!componentValidation.valid) {
      progress?.("finalizing");
      const repaired = await this.#session.completeScopedWithRequiredFiles(
        composeComponentRepairPrompt(componentLibrary, componentValidation),
        THEME_GENERATION_REQUIRED_FILES,
        signal
      );
      progress?.("validating");
      componentLibrary = parseComponentLibraryResponse(repaired);
      componentValidation = this.#componentValidator.validate(
        componentLibrary
      );
    }
    const issues = [
      ...componentValidation.issues,
      ...validatePreview(draft.previewHtml, 8, 12)
    ];
    const finalized = Object.freeze({
      manifest: draft.manifest,
      componentLibrary,
      previewHtml: draft.previewHtml,
      description: draft.description,
      finalized: true,
      skillAudit: this.#session.audit(),
      validation: report(issues)
    });
    if (!finalized.validation.valid) {
      throw new ThemeGenerationError(
        "theme_validation_failed",
        "The finalized theme contains validation errors."
      );
    }
    progress?.("saving");
    await this.save(finalized);
    return finalized;
  }

  async save(draft: ThemeDraft): Promise<void> {
    if (!draft.validation.valid || !draft.componentLibrary) {
      throw new ThemeGenerationError(
        "theme_validation_failed",
        "A complete theme with valid components is required before saving."
      );
    }
    await this.#repository.save({
      manifest: draft.manifest,
      componentLibrary: draft.componentLibrary,
      previewHtml: draft.previewHtml
    });
  }
}

interface ThemeManifestResponse {
  readonly id: string;
  readonly name: string;
  readonly primaryColor: string;
  readonly useCases: string;
  readonly underlineCss: string;
}

interface ThemeDraftModelResponse {
  readonly manifest: ThemeManifestResponse;
  readonly previewHtml: string;
}

function parseDraftResponse(
  response: string,
  description: string,
  now: Date
): ThemeDraftModelResponse {
  try {
    const value = parseJsonObject(response);
    if (
      hasExactKeys(value, ["manifest", "previewHtml"]) &&
      typeof value.previewHtml === "string"
    ) {
      return {
        manifest: parseManifest(value.manifest),
        previewHtml:
          normalizeConceptPreview(value.previewHtml) ??
          createFallbackPreview(description)
      };
    }
  } catch {
    // Prefer the legacy JSON contract when present, then accept direct HTML.
  }
  const previewHtml =
    normalizeConceptPreview(extractHtmlDocument(response) ?? "") ??
    createFallbackPreview(description);
  return {
    manifest: inferThemeManifest(previewHtml, description, now),
    previewHtml
  };
}

function parseJsonObject(response: string): Record<string, unknown> {
  const value = extractJsonValue(response);
  if (!isRecord(value)) {
    throw new ThemeGenerationError("theme_response_invalid", "Theme response must be a JSON object.");
  }
  return value;
}

function parseComponentLibraryResponse(response: string): string {
  try {
    const value = extractJsonValue(response);
    if (
      isRecord(value) &&
      hasExactKeys(value, ["componentLibrary"]) &&
      typeof value.componentLibrary === "string"
    ) {
      return value.componentLibrary.trim();
    }
  } catch {
    // A model may return the requested Markdown directly instead of JSON.
  }
  const markdown = unwrapMarkdownFence(response).trim();
  const heading = markdown.search(/^#(?:\s|#)/mu);
  return heading >= 0 ? markdown.slice(heading).trim() : markdown;
}

function extractJsonValue(response: string): unknown {
  const candidates = [response.trim(), unwrapMarkdownFence(response).trim()];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      const object = firstBalancedJsonObject(candidate);
      if (!object) continue;
      try {
        return JSON.parse(object) as unknown;
      } catch {
        // Try the next normalized candidate.
      }
    }
  }
  throw new ThemeGenerationError(
    "theme_response_invalid",
    "Theme response does not contain a readable JSON object."
  );
}

function unwrapMarkdownFence(response: string): string {
  const trimmed = response.trim();
  const match = trimmed.match(
    /^```(?:json|markdown|md)?\s*\n([\s\S]*?)\n```$/iu
  );
  return match?.[1] ?? trimmed;
}

function firstBalancedJsonObject(value: string): string | null {
  for (let start = value.indexOf("{"); start >= 0; start = value.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) return value.slice(start, index + 1);
      }
    }
  }
  return null;
}

function extractHtmlDocument(response: string): string | null {
  const candidates = [
    ...[...response.matchAll(/```html\s*\n([\s\S]*?)```/giu)]
      .map((match) => match[1] ?? ""),
    response
  ];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const doctype = lower.indexOf("<!doctype html");
    const html = lower.indexOf("<html");
    const start = doctype >= 0 ? doctype : html;
    if (start >= 0) {
      const end = lower.indexOf("</html>", start);
      return candidate
        .slice(start, end >= 0 ? end + "</html>".length : undefined)
        .trim();
    }
    const fragment = candidate.search(
      /<(?:article|main|header|section|aside|footer|div)\b/iu
    );
    if (fragment >= 0) {
      return [
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>",
        candidate.slice(fragment).trim(),
        "</body></html>"
      ].join("");
    }
  }
  return null;
}

function normalizeConceptPreview(html: string): string | null {
  if (!html.trim()) return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  const marked = [
    ...document.querySelectorAll<HTMLElement>("[data-galley-theme-block]")
  ].filter(isSafePreviewBlock);
  let blocks = marked.length >= 8 && marked.length <= 12
    ? marked
    : [
        ...document.body.querySelectorAll<HTMLElement>(
          "header,main,article,section,aside,footer,h1,h2,h3,p,blockquote,ul,ol,li,figure,table,div"
        )
      ].filter(isSafePreviewBlock);
  if (blocks.length < 8) {
    const seen = new Set(blocks);
    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
      if (
        seen.has(element) ||
        !isSafePreviewBlock(element)
      ) continue;
      seen.add(element);
      blocks.push(element);
      if (blocks.length >= 8) break;
    }
  }
  if (blocks.length < 8) return null;
  blocks = blocks.slice(0, 12);
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-galley-theme-block]"
  )) {
    element.removeAttribute("data-galley-theme-block");
  }
  blocks.forEach((block, index) => {
    block.setAttribute("data-galley-theme-block", String(index + 1));
  });
  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}

function isSafePreviewBlock(element: HTMLElement): boolean {
  return !element.matches(
    "script,style,link,meta,base,iframe,frame,frameset,object,embed,form,svg,path,br"
  ) && Boolean(element.textContent?.trim() || element.querySelector("img"));
}

function inferThemeManifest(
  previewHtml: string,
  description: string,
  now: Date
): ThemeManifestResponse {
  const document = new DOMParser().parseFromString(previewHtml, "text/html");
  const latestInstruction = extractLatestInstruction(description);
  const name = normalizeThemeName(
    document.title ||
    document.querySelector("h1")?.textContent ||
    latestInstruction
  );
  const palette = inferPalette(`${description}\n${previewHtml}`);
  const primaryColor = extractPrimaryColor(previewHtml) ?? palette.primary;
  return {
    id: `theme-${stableHash(
      `${name}\n${description}\n${now.toISOString()}`
    )}`,
    name,
    primaryColor,
    useCases: latestInstruction.slice(0, 240) || "Custom editorial articles",
    underlineCss: `border-bottom:2px solid ${primaryColor};`
  };
}

function extractLatestInstruction(description: string): string {
  const matches = [
    ...description.matchAll(
      /(?:^|\n\n)(?:Initial request|Refinement \d+):\n([\s\S]*?)(?=\n\n(?:Initial request|Refinement \d+):|$)/gu
    )
  ];
  return (matches.at(-1)?.[1] ?? description).trim();
}

function normalizeThemeName(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 80);
  return normalized || "Custom Theme";
}

function extractPrimaryColor(value: string): string | null {
  for (const match of value.matchAll(/#[a-f0-9]{3}(?:[a-f0-9]{3})?\b/giu)) {
    const normalized = normalizeHexColor(match[0]);
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 24) {
      return normalized;
    }
  }
  return null;
}

function normalizeHexColor(value: string): string {
  const hex = value.slice(1);
  return `#${(
    hex.length === 3
      ? [...hex].map((character) => character.repeat(2)).join("")
      : hex
  ).toUpperCase()}`;
}

interface ThemePalette {
  readonly primary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
}

function inferPalette(description: string): ThemePalette {
  const normalized = description.toLowerCase();
  if (/(科幻|赛博|霓虹|sci[\s-]?fi|cyber|neon)/u.test(normalized)) {
    return {
      primary: "#00E5FF",
      accent: "#A855F7",
      background: "#070B1A",
      surface: "#111936",
      text: "#E6FBFF"
    };
  }
  if (/(红|red|crimson)/u.test(normalized)) {
    return {
      primary: "#DC2626",
      accent: "#F97316",
      background: "#FFF7F5",
      surface: "#FFFFFF",
      text: "#3F1515"
    };
  }
  if (/(绿|green|forest|自然)/u.test(normalized)) {
    return {
      primary: "#059669",
      accent: "#84CC16",
      background: "#F3FAF6",
      surface: "#FFFFFF",
      text: "#16352A"
    };
  }
  if (/(蓝|blue|ocean|海洋)/u.test(normalized)) {
    return {
      primary: "#2563EB",
      accent: "#06B6D4",
      background: "#F4F8FF",
      surface: "#FFFFFF",
      text: "#172554"
    };
  }
  if (/(橙|orange|暖)/u.test(normalized)) {
    return {
      primary: "#EA580C",
      accent: "#F59E0B",
      background: "#FFF8F1",
      surface: "#FFFFFF",
      text: "#431407"
    };
  }
  return {
    primary: "#7C3AED",
    accent: "#EC4899",
    background: "#F8F7FF",
    surface: "#FFFFFF",
    text: "#24133F"
  };
}

function createFallbackPreview(description: string): string {
  const latestInstruction = extractLatestInstruction(description);
  const label = escapeHtmlText(
    latestInstruction.slice(0, 48) || "Custom Theme"
  );
  const palette = inferPalette(description);
  const block = (
    index: number,
    tag: string,
    content: string,
    style: string
  ): string =>
    `<${tag} data-galley-theme-block="${index}" style="${style}">${content}</${tag}>`;
  const base =
    `margin:0;color:${palette.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`;
  return [
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${palette.primary}"><title>${label}</title></head>`,
    `<body style="${base}background:${palette.background};padding:28px 16px;">`,
    `<article style="max-width:720px;margin:0 auto;background:${palette.surface};border:1px solid ${palette.primary}55;box-shadow:0 24px 70px ${palette.primary}22;overflow:hidden;">`,
    block(
      1,
      "header",
      `<span style="display:block;font-size:12px;letter-spacing:4px;color:${palette.primary};">GALLEY THEME LAB</span><h1 style="margin:18px 0 8px;font-size:40px;line-height:1.08;">${label}</h1><p style="margin:0;opacity:.68;">一套可继续迭代并保存的文章视觉主题</p>`,
      `padding:44px 42px 36px;background:linear-gradient(135deg,${palette.surface},${palette.primary}18);border-bottom:1px solid ${palette.primary}44;`
    ),
    block(
      2,
      "section",
      `<p style="margin:0;font-size:18px;line-height:1.9;"><strong style="color:${palette.primary};">主题概念</strong> 将清晰的信息结构、鲜明的主色和舒适的阅读节奏组合在一起。</p>`,
      "padding:30px 42px;"
    ),
    block(
      3,
      "section",
      `<span style="display:inline-block;padding:5px 10px;background:${palette.primary};color:#fff;font-size:12px;">01 / KEY IDEA</span><h2 style="font-size:27px;margin:14px 0 8px;">视觉语言</h2><p style="margin:0;line-height:1.8;opacity:.78;">通过标题层级、留白与色彩对比建立文章节奏。</p>`,
      `margin:0 42px 22px;padding:22px;border-left:4px solid ${palette.primary};background:${palette.primary}0D;`
    ),
    block(
      4,
      "blockquote",
      `<p style="margin:0;font-size:22px;line-height:1.65;">“风格不是装饰，而是帮助读者理解内容的秩序。”</p>`,
      `margin:0 42px 28px;padding:26px;border:1px solid ${palette.accent}66;color:${palette.primary};`
    ),
    block(
      5,
      "section",
      `<h2 style="margin:0 0 16px;font-size:24px;">内容卡片</h2><p style="margin:0;line-height:1.8;">适合放置摘要、关键结论和需要被快速注意的信息。</p>`,
      `margin:0 42px 18px;padding:24px;background:${palette.background};border-radius:14px;`
    ),
    block(
      6,
      "section",
      `<span style="font-size:42px;font-weight:800;color:${palette.primary};">03</span><span style="margin-left:14px;font-size:14px;letter-spacing:2px;">CORE POINTS</span>`,
      "margin:0 42px 18px;display:flex;align-items:center;"
    ),
    block(
      7,
      "section",
      `<h3 style="margin:0 0 10px;">层级明确</h3><p style="margin:0;line-height:1.75;opacity:.78;">标题、正文、引用和重点信息拥有稳定而一致的视觉关系。</p>`,
      `margin:0 42px 14px;padding:20px;border-top:1px solid ${palette.primary}55;`
    ),
    block(
      8,
      "section",
      `<h3 style="margin:0 0 10px;">阅读友好</h3><p style="margin:0;line-height:1.75;opacity:.78;">在移动端阅读宽度下保持足够的字号、行高和段落间距。</p>`,
      `margin:0 42px 14px;padding:20px;border-top:1px solid ${palette.primary}55;`
    ),
    block(
      9,
      "section",
      `<span style="display:inline-block;margin-right:8px;padding:6px 12px;border:1px solid ${palette.primary};color:${palette.primary};">#主题</span><span style="display:inline-block;padding:6px 12px;border:1px solid ${palette.accent};color:${palette.accent};">#排版</span>`,
      "padding:22px 42px;"
    ),
    block(
      10,
      "footer",
      `<span style="font-size:12px;letter-spacing:3px;">DESIGNED WITH GALLEY</span>`,
      `padding:22px 42px;background:${palette.primary};color:#fff;text-align:right;`
    ),
    "</article></body></html>"
  ].join("");
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function parseManifest(value: unknown): ThemeManifestResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "name", "primaryColor", "underlineCss", "useCases"]) ||
    !Object.values(value).every((item) => typeof item === "string")
  ) {
    throw new ThemeGenerationError("theme_response_invalid", "Theme manifest fields are invalid.");
  }
  return value as unknown as ThemeManifestResponse;
}

function validatePreview(
  html: string,
  minimumBlocks: number,
  maximumBlocks: number
): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (/<script\b/iu.test(html)) {
    issues.push({ code: "preview_script", severity: "error", message: "Theme preview contains a script." });
  }
  if (/\son[a-z]+\s*=/iu.test(html)) {
    issues.push({ code: "preview_event_handler", severity: "error", message: "Theme preview contains an event handler." });
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...document.querySelectorAll("[data-galley-theme-block]")];
  if (blocks.length < minimumBlocks || blocks.length > maximumBlocks) {
    issues.push({
      code: "preview_block_count",
      severity: "error",
      message: `Theme preview must contain ${minimumBlocks} to ${maximumBlocks} marked blocks.`
    });
  }
  if (
    blocks.some(
      (block, index) =>
        block.getAttribute("data-galley-theme-block") !== String(index + 1)
    )
  ) {
    issues.push({
      code: "preview_block_sequence",
      severity: "error",
      message: "Theme preview block markers must be unique consecutive integers in DOM order from 1 to N."
    });
  }
  return issues;
}

function composeDraftPrompt(
  description: string,
  hasReferenceImage: boolean
): string {
  return [
    "This is Galley's internal Theme Lab, not an article-formatting request.",
    "The user phrase is already the complete visual-direction input. Do not ask for article content, files, or confirmation.",
    "Create a fast visual concept preview for a reusable gzh-design article theme.",
    "Return only one script-free full HTML5 document. Do not return JSON, Markdown fences, explanations, or componentLibrary.",
    "Invent short representative placeholder copy appropriate for the requested visual direction.",
    "The document must contain exactly 8 to 12 concise representative blocks.",
    "Give every preview block a unique consecutive data-galley-theme-block=\"N\" marker in DOM order.",
    hasReferenceImage
      ? "The final user content includes the explicitly selected validated reference image."
      : "No reference image was selected; do not infer that one exists.",
    `Untrusted cumulative user style conversation (${description.length} characters):`,
    JSON.stringify(description)
  ].join("\n\n");
}

function composeFinalPrompt(draft: ThemeDraft): string {
  return [
    "Follow the loaded gzh-design theme rules to finalize the approved visual concept.",
    "Galley already owns the approved manifest and preview. Generate only the complete reusable component-library Markdown.",
    "Return one JSON object with exactly one string field: componentLibrary.",
    "componentLibrary must contain all five required theme-library sections, complete inline-styled HTML component fences, the article template skeleton, article-type recipes, and Markdown mapping.",
    "Every component text node must use approved <span leaf=\"\"> wrappers. Do not return manifest, previewHtml, explanations, or extra keys.",
    `Approved cumulative style conversation (${draft.description?.length ?? 0} characters):`,
    JSON.stringify(draft.description ?? ""),
    "Approved lightweight concept manifest:",
    JSON.stringify({
      id: draft.manifest.id,
      name: draft.manifest.name,
      primaryColor: draft.manifest.primaryColor,
      useCases: draft.manifest.useCases,
      underlineCss: draft.manifest.underlineCss
    }),
    "Approved lightweight concept preview:",
    JSON.stringify(draft.previewHtml)
  ].join("\n\n");
}

function composeComponentRepairPrompt(
  componentLibrary: string,
  validation: ThemeValidationReport
): string {
  return [
    "Repair the following gzh-design component-library Markdown.",
    "Return one JSON object with exactly one string field: componentLibrary.",
    "Fix every listed validation issue. Preserve the approved visual direction. Do not return explanations or extra keys.",
    "Validation issue codes:",
    JSON.stringify(validation.issues.map(({ code }) => code)),
    "Current component library:",
    JSON.stringify(componentLibrary)
  ].join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function errorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) return null;
  return typeof error.code === "string" ? error.code : null;
}
