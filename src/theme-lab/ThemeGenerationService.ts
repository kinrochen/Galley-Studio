import themeGeneratorProfile from "../../assets/profiles/theme-generator.md?raw";

import type { ProviderCapabilities } from "../ai/CapabilityProbe";
import { safePreviewHtml } from "../preview/SafeHtmlPreview";
import type { SkillLoadAudit } from "../skill/SkillAudit";
import type { SkillSession } from "../skill/SkillSession";
import type { CustomThemeRepository, StoredThemeFiles } from "../themes/CustomThemeRepository";
import {
  createThemeManifest,
  type ThemeManifestV1
} from "../themes/ThemeManifest";
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
  "references/common-components.md",
  "assets/profiles/theme-generator.md"
] as const);

export interface ThemeGenerationInput {
  readonly description: string;
  readonly referenceImage?: ReferenceImageInput;
}

export interface ThemeDraft extends StoredThemeFiles {
  readonly skillAudit: SkillLoadAudit;
  readonly validation: ThemeValidationReport;
}

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
    signal: AbortSignal
  ): Promise<ThemeDraft> {
    const description = input.description.trim();
    if (!description || description.length > 4_000) {
      throw new ThemeGenerationError(
        "theme_description_invalid",
        "Theme description must contain 1 to 4,000 characters."
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

    await this.#session.ensureFiles(THEME_GENERATION_REQUIRED_FILES, signal);
    const prompt = composePrompt(description, imageDataUrl !== undefined);
    const response = imageDataUrl
      ? await this.#session.completeScopedWithImage(prompt, imageDataUrl, signal)
      : await this.#session.completeScoped(prompt, signal);
    const parsed = parseResponse(response);
    const manifest = createThemeManifest(parsed.manifest, this.#now());
    const issues = [
      ...this.#componentValidator.validate(parsed.componentLibrary).issues,
      ...validatePreview(parsed.previewHtml)
    ];
    let previewHtml = parsed.previewHtml;
    try {
      previewHtml = safePreviewHtml(parsed.previewHtml);
    } catch {
      issues.push({
        code: "preview_document",
        severity: "error",
        message: "Theme preview is not a valid full HTML document."
      });
    }

    return Object.freeze({
      manifest,
      componentLibrary: parsed.componentLibrary,
      previewHtml,
      skillAudit: this.#session.audit(),
      validation: report(issues)
    });
  }

  async save(draft: ThemeDraft): Promise<void> {
    if (!draft.validation.valid) {
      throw new ThemeGenerationError(
        "theme_validation_failed",
        "A theme draft with validation errors cannot be saved."
      );
    }
    await this.#repository.save({
      manifest: draft.manifest,
      componentLibrary: draft.componentLibrary,
      previewHtml: draft.previewHtml
    });
  }
}

interface ThemeModelResponse {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly primaryColor: string;
    readonly useCases: string;
    readonly underlineCss: string;
  };
  readonly componentLibrary: string;
  readonly previewHtml: string;
}

function parseResponse(response: string): ThemeModelResponse {
  if (response.trimStart().startsWith("```")) {
    throw new ThemeGenerationError("theme_response_invalid", "Theme response must not use a Markdown fence.");
  }
  let value: unknown;
  try {
    value = JSON.parse(response) as unknown;
  } catch {
    throw new ThemeGenerationError("theme_response_invalid", "Theme response is not strict JSON.");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["componentLibrary", "manifest", "previewHtml"])) {
    throw new ThemeGenerationError("theme_response_invalid", "Theme response has an invalid top-level contract.");
  }
  const manifest = value.manifest;
  if (
    !isRecord(manifest) ||
    !hasExactKeys(manifest, ["id", "name", "primaryColor", "underlineCss", "useCases"]) ||
    !Object.values(manifest).every((item) => typeof item === "string") ||
    typeof value.componentLibrary !== "string" ||
    typeof value.previewHtml !== "string"
  ) {
    throw new ThemeGenerationError("theme_response_invalid", "Theme response fields are invalid.");
  }
  return {
    manifest: manifest as unknown as ThemeModelResponse["manifest"],
    componentLibrary: value.componentLibrary,
    previewHtml: value.previewHtml
  };
}

function validatePreview(html: string): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (/<script\b/iu.test(html)) {
    issues.push({ code: "preview_script", severity: "error", message: "Theme preview contains a script." });
  }
  if (/\son[a-z]+\s*=/iu.test(html)) {
    issues.push({ code: "preview_event_handler", severity: "error", message: "Theme preview contains an event handler." });
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...document.querySelectorAll("[data-galley-theme-block]")];
  if (blocks.length < 45 || blocks.length > 75) {
    issues.push({
      code: "preview_block_count",
      severity: "error",
      message: "Theme preview must contain 45 to 75 marked blocks."
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

function composePrompt(description: string, hasReferenceImage: boolean): string {
  return [
    "Follow the already-loaded gzh-design theme-generation workflow and Galley profile.",
    themeGeneratorProfile.trim(),
    "Return the complete theme preview HTML directly in previewHtml; do not describe or AST-render it.",
    hasReferenceImage
      ? "The final user content includes the explicitly selected validated reference image."
      : "No reference image was selected; do not infer that one exists.",
    `Untrusted user style description (${description.length} characters):`,
    JSON.stringify(description)
  ].join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
