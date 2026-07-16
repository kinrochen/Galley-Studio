import {
  DEFAULT_EXPORT_CONFIGURATIONS,
  normalizeExportConfigurations,
  type ExportConfiguration
} from "../export/ExportConfiguration";
import {
  isGalleyLanguage,
  type GalleyLanguage
} from "../i18n/LocaleStore";

export type GenerationAgent = "plugin" | "codex-cli" | "claude-cli";

export const DEFAULT_GENERATION_TIMEOUT_MS = 30 * 60 * 1_000;

export interface GalleySettings {
  language: GalleyLanguage;
  generationAgent: GenerationAgent;
  codexCliPath: string;
  claudeCliPath: string;
  baseUrl: string;
  model: string;
  secretId: string;
  temperature: number;
  timeoutMs: number;
  contextWindow: number;
  outputFolder: string;
  activeSkillVersion: string;
  exportConfigurations: readonly ExportConfiguration[];
}

export const DEFAULT_SETTINGS: GalleySettings = {
  language: "auto",
  generationAgent: "plugin",
  codexCliPath: "codex",
  claudeCliPath: "claude",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  secretId: "",
  temperature: 0.4,
  timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
  contextWindow: 128_000,
  outputFolder: "",
  activeSkillVersion: "bundled",
  exportConfigurations: DEFAULT_EXPORT_CONFIGURATIONS
};

export function normalizeSettings(value: unknown): GalleySettings {
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    ...DEFAULT_SETTINGS,
    language: isGalleyLanguage(input.language) ? input.language : "auto",
    generationAgent: isGenerationAgent(input.generationAgent)
      ? input.generationAgent
      : DEFAULT_SETTINGS.generationAgent,
    codexCliPath: normalizeExecutable(
      input.codexCliPath,
      DEFAULT_SETTINGS.codexCliPath
    ),
    claudeCliPath: normalizeExecutable(
      input.claudeCliPath,
      DEFAULT_SETTINGS.claudeCliPath
    ),
    baseUrl: String(input.baseUrl ?? DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
    model: String(input.model ?? ""),
    secretId: String(input.secretId ?? ""),
    temperature: clamp(
      Number(input.temperature ?? DEFAULT_SETTINGS.temperature),
      0,
      2,
      DEFAULT_SETTINGS.temperature
    ),
    // The low-level timeout is not exposed in the UI. Normalize every legacy
    // value to the supported 30-minute generation window.
    timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
    contextWindow: clamp(
      Number(input.contextWindow ?? DEFAULT_SETTINGS.contextWindow),
      8_000,
      2_000_000,
      DEFAULT_SETTINGS.contextWindow
    ),
    outputFolder: String(input.outputFolder ?? ""),
    activeSkillVersion: String(input.activeSkillVersion ?? "bundled"),
    exportConfigurations: normalizeExportConfigurations(input.exportConfigurations)
  };
}

export function isGenerationAgent(value: unknown): value is GenerationAgent {
  return value === "plugin" || value === "codex-cli" || value === "claude-cli";
}

function normalizeExecutable(value: unknown, fallback: string): string {
  const executable = String(value ?? fallback).trim();
  return executable && !executable.includes("\0") ? executable : fallback;
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
