import { z } from "zod";

import type { GeneratedDocument } from "../generation/GenerationPipeline";

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    code: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    selector: z.string().min(1).optional()
  })
  .strict();

const ValidationReportSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(ValidationIssueSchema)
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
    documentId: z.string().uuid(),
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
      }),
    model: z
      .string()
      .min(1)
      .refine((model) => model.trim().length > 0, "Model must not be blank."),
    promptVersion: z.literal(1),
    generatedAt: z.string().datetime({ offset: true }),
    validation: ValidationReportSchema,
    exports: z.array(z.never()).max(0)
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
    validation: {
      valid: input.document.validation.valid,
      issues: input.document.validation.issues.map((issue) => ({ ...issue }))
    },
    exports: []
  };

  return GalleySidecarV1Schema.parse(sidecar);
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
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
