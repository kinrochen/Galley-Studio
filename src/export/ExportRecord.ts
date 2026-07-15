import { z } from "zod";

const SHA256 = /^[a-f0-9]{64}$/u;
const NORMALIZED_PATH = z.string().min(1).refine(
  isNormalizedRelativePath,
  "Expected a normalized vault-relative path."
);
const NORMALIZED_SKILL_PATH = z.string().min(1).refine(
  isNormalizedRelativePath,
  "Expected a normalized Skill-relative path."
);

export const GalleyExportRecordV1Schema = z.object({
  id: z.string().uuid(),
  configurationId: z.string().min(1).max(64),
  profileId: z.enum(["standard-web", "portable-inline", "wechat"]),
  path: NORMALIZED_PATH,
  exportedAt: z.string().datetime({ offset: true }),
  sourceHtmlHash: z.string().regex(SHA256),
  outputHash: z.string().regex(SHA256),
  repairRounds: z.number().int().min(0).max(2),
  skillFiles: z.array(NORMALIZED_SKILL_PATH).max(8).superRefine((paths, context) => {
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", message: "Skill file paths must be unique." });
    }
  })
}).strict();

export type GalleyExportRecordV1 = z.infer<typeof GalleyExportRecordV1Schema>;

function isNormalizedRelativePath(path: string): boolean {
  return !(
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z]:/iu.test(path) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  );
}
