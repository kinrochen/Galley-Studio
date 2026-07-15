import type { ExportProfileId } from "./ExportProfile";
import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";

export interface ExportConfiguration {
  readonly id: string;
  readonly name: string;
  readonly profileId: ExportProfileId;
  readonly outputFolder: string;
  readonly fileNameTemplate: string;
}

const IDS = new Set<ExportProfileId>([
  "standard-web",
  "portable-inline",
  "wechat"
]);
const CONFIG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const DEFAULT_EXPORT_CONFIGURATIONS: readonly ExportConfiguration[] =
  Object.freeze([
    Object.freeze({
      id: "standard-web",
      name: "Standard web",
      profileId: "standard-web" as const,
      outputFolder: "",
      fileNameTemplate: "{stem}.standard-web.html"
    }),
    Object.freeze({
      id: "portable-inline",
      name: "Portable inline",
      profileId: "portable-inline" as const,
      outputFolder: "",
      fileNameTemplate: "{stem}.portable.html"
    }),
    Object.freeze({
      id: "wechat",
      name: "WeChat editor",
      profileId: "wechat" as const,
      outputFolder: "",
      fileNameTemplate: "{stem}.wechat.html"
    })
  ]);

export function normalizeExportConfiguration(value: unknown): ExportConfiguration {
  const input = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const profile = String(input.profileId ?? "standard-web") as ExportProfileId;
  const configuration = {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    profileId: profile,
    outputFolder: String(input.outputFolder ?? "").trim().replace(/^\/+|\/+$/gu, ""),
    fileNameTemplate: String(input.fileNameTemplate ?? "").trim()
  };
  if (!CONFIG_ID.test(configuration.id)) {
    throw new Error("Export configuration id must be a lowercase slug.");
  }
  if (!configuration.name || !IDS.has(profile)) {
    throw new Error("Export configuration requires a name and supported profile.");
  }
  if (
    configuration.outputFolder &&
    !isNormalizedVaultRelativePath(configuration.outputFolder)
  ) {
    throw new Error("Export output folder must be vault-relative.");
  }
  if (
    !configuration.fileNameTemplate.endsWith(".html") ||
    !configuration.fileNameTemplate.includes("{stem}") ||
    /[\\/]/u.test(configuration.fileNameTemplate) ||
    configuration.fileNameTemplate.includes("..")
  ) {
    throw new Error("Export filename template must be a safe HTML basename containing {stem}.");
  }
  return Object.freeze(configuration);
}

export function normalizeExportConfigurations(value: unknown): readonly ExportConfiguration[] {
  if (!Array.isArray(value)) return DEFAULT_EXPORT_CONFIGURATIONS;
  const normalized: ExportConfiguration[] = [];
  const ids = new Set<string>();
  for (const candidate of value.slice(0, 24)) {
    try {
      const configuration = normalizeExportConfiguration(candidate);
      if (!ids.has(configuration.id)) {
        ids.add(configuration.id);
        normalized.push(configuration);
      }
    } catch {
      // Invalid persisted configurations are ignored without affecting defaults.
    }
  }
  return Object.freeze(normalized.length > 0 ? normalized : [...DEFAULT_EXPORT_CONFIGURATIONS]);
}
