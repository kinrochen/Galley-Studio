import { z } from "zod";

import type { GeneratedDocument } from "../generation/SkillDrivenGenerationTypes";
import { GalleyExportRecordV1Schema } from "../export/ExportRecord";

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GALLEY_SOURCE_ID =
  /^(?:heading|paragraph|list|code|table|blockquote|thematicBreak|html)-[0-9]{3,}$/;
const MAX_PERSISTED_VALIDATION_ISSUES = 64;
const REQUIRED_SKILL_FILES = [
  "SKILL.md",
  "references/theme-index.md"
] as const;

const PERSISTED_VALIDATION_MESSAGES = {
  document_shell: "Generated HTML has an invalid document shell.",
  document_title: "Generated HTML must contain one non-empty title.",
  document_charset: "Generated HTML must declare UTF-8 once.",
  document_viewport: "Generated HTML must contain one viewport declaration.",
  document_article_root: "Generated HTML must contain one article content root.",
  document_styles_inline: "Generated HTML contains a disallowed stylesheet.",
  document_doctype: "Generated HTML must contain one HTML5 doctype.",
  document_html: "Generated HTML must contain one html root.",
  document_head: "Generated HTML must contain one head.",
  document_body: "Generated HTML must contain one body.",
  source_document_invalid: "Generated HTML source coverage could not be inspected.",
  source_article_root: "Generated HTML has an invalid article source root.",
  source_article_marker: "The article root must not carry a source marker.",
  source_outside_article: "A source marker appears outside the article root.",
  source_missing: "Generated HTML is missing a source block.",
  source_duplicate: "Generated HTML repeats a source block.",
  source_invalid: "A generated source marker is invalid.",
  source_unexpected: "Generated HTML contains an unexpected source marker.",
  source_order: "Generated source markers are out of order.",
  unsafe_content_removed: "Unsafe generated content was removed.",
  unsafe_content_present: "Unsafe content remains in generated HTML.",
  validation_security_failed: "Generated HTML security validation failed.",
  validation_contract_failed: "Generated HTML contract validation failed.",
  validation_source_failed: "Generated HTML source validation failed.",
  html_extraction_failed: "The model response did not contain usable HTML.",
  html_sanitization_failed: "Generated HTML could not be sanitized safely.",
  long_batch_invalid: "A generated long-document batch is invalid.",
  validation_issue: "Generated HTML did not pass a recognized validation check."
} as const;

type PersistedValidationCode = keyof typeof PERSISTED_VALIDATION_MESSAGES;

const NormalizedVaultPathSchema = z.string().min(1).superRefine((path, context) => {
  if (!isNormalizedVaultRelativePath(path)) {
    context.addIssue({
      code: "custom",
      message: "Expected a normalized vault-relative path."
    });
  }
});

const NormalizedSkillPathSchema = z.string().min(1).superRefine((path, context) => {
  if (!isNormalizedVaultRelativePath(path)) {
    context.addIssue({
      code: "custom",
      message: "Expected a normalized Skill-relative path."
    });
  }
});

const ValidationIssueSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(64)
      .refine(isPersistedValidationCode, "Unknown persisted validation code."),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1).max(160),
    sourceId: z.string().min(1).max(64).regex(GALLEY_SOURCE_ID).optional()
  })
  .strict()
  .superRefine((issue, context) => {
    const code = issue.code;
    if (issue.message !== PERSISTED_VALIDATION_MESSAGES[code]) {
      context.addIssue({
        code: "custom",
        message: "Persisted validation messages are code-derived."
      });
    }
  });

const ValidationReportSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(ValidationIssueSchema).max(MAX_PERSISTED_VALIDATION_ISSUES)
  })
  .strict()
  .superRefine((report, context) => {
    const expectedValid = !report.issues.some(
      ({ severity }) => severity === "error"
    );
    if (report.valid !== expectedValid) {
      context.addIssue({
        code: "custom",
        message: "Validation validity must agree with error issues."
      });
    }
  });

export const GalleySidecarV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: z.uuid(),
    sourcePath: NormalizedVaultPathSchema,
    sourceHash: z.string().regex(LOWERCASE_SHA256),
    htmlHash: z.string().regex(LOWERCASE_SHA256),
    themeId: z.string().regex(THEME_ID),
    skillVersion: z.string().min(1),
    skillLoadMode: z.enum(["tool-calls", "injected", "mixed"]),
    skillFiles: z
      .array(NormalizedSkillPathSchema)
      .superRefine((paths, context) => {
        if (new Set(paths).size !== paths.length) {
          context.addIssue({
            code: "custom",
            message: "Skill file paths must be unique."
          });
        }
        for (const required of REQUIRED_SKILL_FILES) {
          if (!paths.includes(required)) {
            context.addIssue({
              code: "custom",
              message: `Missing required Skill audit file: ${required}`
            });
          }
        }
      }),
    model: z
      .string()
      .min(1)
      .refine((model) => model.trim().length > 0, "Model must not be blank."),
    promptVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    validation: ValidationReportSchema,
    exports: z
      .array(GalleyExportRecordV1Schema)
      .max(256)
      .superRefine((records, context) => {
        const ids = new Set<string>();
        const paths = new Set<string>();
        for (const record of records) {
          if (ids.has(record.id) || paths.has(record.path)) {
            context.addIssue({
              code: "custom",
              message: "Export record ids and paths must be unique."
            });
            return;
          }
          ids.add(record.id);
          paths.add(record.path);
        }
      })
  })
  .strict();

export type GalleySidecarV1 = z.infer<typeof GalleySidecarV1Schema>;

export interface BuildGalleySidecarInput {
  sourcePath: string;
  markdown: string;
  document: GeneratedDocument;
  model: string;
}

export interface GalleySidecarEnvironment {
  now: () => Date;
  randomUUID: () => string;
}

export async function buildGalleySidecarV1(
  input: BuildGalleySidecarInput,
  environment: GalleySidecarEnvironment
): Promise<GalleySidecarV1> {
  const sidecar = {
    schemaVersion: 1 as const,
    documentId: environment.randomUUID(),
    sourcePath: input.sourcePath,
    sourceHash: await sha256Text(input.markdown),
    htmlHash: await sha256Text(input.document.html),
    themeId: input.document.theme.id,
    skillVersion: input.document.skillAudit.skillVersion,
    skillLoadMode: input.document.skillAudit.loadMode,
    skillFiles: [...input.document.skillAudit.files],
    model: input.model,
    promptVersion: 1 as const,
    generatedAt: environment.now().toISOString(),
    validation: canonicalValidation(input.document),
    exports: []
  };

  return GalleySidecarV1Schema.parse(sidecar);
}

function canonicalValidation(
  document: GeneratedDocument
): GalleySidecarV1["validation"] {
  const validSourceIds = new Set(
    document.source.blocks
      .map(({ id }) => id)
      .filter((id) => GALLEY_SOURCE_ID.test(id) && id.length <= 64)
  );
  const issues: GalleySidecarV1["validation"]["issues"] = [];
  const selectedIndexes = new Set<number>();
  const selectedCodes = new Set<PersistedValidationCode>();

  document.validation.issues.forEach((issue, index) => {
    const canonical = canonicalIssue(
      issue,
      document.validation.valid,
      validSourceIds
    );
    if (
      issues.length < MAX_PERSISTED_VALIDATION_ISSUES &&
      !selectedCodes.has(canonical.code)
    ) {
      selectedCodes.add(canonical.code);
      selectedIndexes.add(index);
      issues.push(canonical);
    }
  });

  for (
    let index = 0;
    index < document.validation.issues.length &&
    issues.length < MAX_PERSISTED_VALIDATION_ISSUES;
    index += 1
  ) {
    if (selectedIndexes.has(index)) {
      continue;
    }
    const issue = document.validation.issues[index];
    if (issue) {
      issues.push(
        canonicalIssue(issue, document.validation.valid, validSourceIds)
      );
    }
  }

  if (
    !document.validation.valid &&
    !issues.some(({ severity }) => severity === "error")
  ) {
    const fallback = {
      code: "validation_issue" as const,
      severity: "error" as const,
      message: PERSISTED_VALIDATION_MESSAGES.validation_issue
    };
    if (issues.length === MAX_PERSISTED_VALIDATION_ISSUES) {
      issues[issues.length - 1] = fallback;
    } else {
      issues.push(fallback);
    }
  }

  return { valid: document.validation.valid, issues };
}

function canonicalIssue(
  issue: GeneratedDocument["validation"]["issues"][number],
  documentValid: boolean,
  validSourceIds: ReadonlySet<string>
): GalleySidecarV1["validation"]["issues"][number] {
  const code = isPersistedValidationCode(issue.code)
    ? issue.code
    : "validation_issue";
  const severity: "error" | "warning" = documentValid
    ? "warning"
    : issue.severity === "warning"
      ? "warning"
      : "error";
  const sourceId =
    typeof issue.sourceId === "string" &&
    issue.sourceId.length <= 64 &&
    GALLEY_SOURCE_ID.test(issue.sourceId) &&
    validSourceIds.has(issue.sourceId)
      ? issue.sourceId
      : undefined;
  return {
    code,
    severity,
    message: PERSISTED_VALIDATION_MESSAGES[code],
    ...(sourceId === undefined ? {} : { sourceId })
  };
}

function isPersistedValidationCode(
  code: string
): code is PersistedValidationCode {
  return Object.hasOwn(PERSISTED_VALIDATION_MESSAGES, code);
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isNormalizedVaultRelativePath(path: string): boolean {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    return false;
  }
  return !path
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}
