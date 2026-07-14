export interface GalleySettings {
  baseUrl: string;
  model: string;
  secretId: string;
  temperature: number;
  timeoutMs: number;
  contextWindow: number;
  outputFolder: string;
  activeSkillVersion: string;
}

export const DEFAULT_SETTINGS: GalleySettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  secretId: "",
  temperature: 0.4,
  timeoutMs: 120_000,
  contextWindow: 128_000,
  outputFolder: "",
  activeSkillVersion: "bundled"
};

export function normalizeSettings(value: unknown): GalleySettings {
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    ...DEFAULT_SETTINGS,
    baseUrl: String(input.baseUrl ?? DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
    model: String(input.model ?? ""),
    secretId: String(input.secretId ?? ""),
    temperature: clamp(
      Number(input.temperature ?? DEFAULT_SETTINGS.temperature),
      0,
      2,
      DEFAULT_SETTINGS.temperature
    ),
    timeoutMs: clamp(
      Number(input.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs),
      10_000,
      600_000,
      DEFAULT_SETTINGS.timeoutMs
    ),
    contextWindow: clamp(
      Number(input.contextWindow ?? DEFAULT_SETTINGS.contextWindow),
      8_000,
      2_000_000,
      DEFAULT_SETTINGS.contextWindow
    ),
    outputFolder: String(input.outputFolder ?? ""),
    activeSkillVersion: String(input.activeSkillVersion ?? "bundled")
  };
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
