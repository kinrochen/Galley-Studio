import { z } from "zod";

export const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR = /^#[a-f0-9]{6}$/i;

export const ThemeManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(2).max(64).regex(THEME_ID_PATTERN),
    name: z.string().trim().min(1).max(80),
    primaryColor: z.string().regex(HEX_COLOR),
    useCases: z.string().trim().min(1).max(240),
    underlineCss: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((value) => !/[{}<>]/u.test(value), "Invalid underline CSS."),
    enabled: z.boolean(),
    license: z.literal("AGPL-3.0"),
    attribution: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) => /isjiamu\/gzh-design-skill/iu.test(value),
        "The upstream gzh-design attribution is required."
      ),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Theme updatedAt cannot precede createdAt."
      });
    }
  });

export type ThemeManifestV1 = z.infer<typeof ThemeManifestV1Schema>;

export interface ThemeManifestDraft {
  readonly id: string;
  readonly name: string;
  readonly primaryColor: string;
  readonly useCases: string;
  readonly underlineCss: string;
}

export function createThemeManifest(
  draft: ThemeManifestDraft,
  now: Date
): ThemeManifestV1 {
  const timestamp = now.toISOString();
  return ThemeManifestV1Schema.parse({
    schemaVersion: 1,
    ...draft,
    enabled: true,
    license: "AGPL-3.0",
    attribution: "Based on isjiamu/gzh-design-skill",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function parseThemeManifest(value: unknown): ThemeManifestV1 {
  return ThemeManifestV1Schema.parse(value);
}
