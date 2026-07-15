import type { ExportConfiguration } from "../export/ExportConfiguration";
import type { GalleyLanguage } from "../i18n/LocalizedText";
import type {
  ActiveContext,
  ArticleCatalogSnapshot,
  GenerateArticleFormInput,
  GeneratedArticleResult
} from "./ConsoleTypes";

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly enabled: boolean;
}

export interface SkillSummary {
  readonly version: string;
  readonly source: "bundled" | "imported";
  readonly active: boolean;
  readonly valid: boolean;
}

export interface SettingsSnapshot {
  readonly baseUrl: string;
  readonly model: string;
  readonly secretId: string;
  readonly temperature: number;
  readonly timeoutMs: number;
  readonly contextWindow: number;
  readonly outputFolder: string;
  readonly language: GalleyLanguage;
  readonly activeSkillVersion?: string;
}

export interface ConnectionDiagnosticSnapshot {
  readonly ok: boolean;
  readonly model: string;
  readonly capabilities: {
    readonly tools: boolean;
    readonly streaming: boolean;
    readonly vision: boolean;
  };
  readonly skillVersion: string;
  readonly skillLoadMode: "tool-calls" | "injected" | "mixed";
  readonly skillFiles: readonly string[];
  readonly errorCode?: string;
}

export interface ConsoleHomeActivitySnapshot {
  readonly pendingExport?: { readonly path: string };
  readonly unsavedThemeDraft?: { readonly name: string };
}

export interface DesktopGalleyActions {
  openWorkbench(path: string): Promise<void>;
  openThemeLab?(): Promise<void>;
  listThemes?(): Promise<readonly ThemeSummary[]>;
  importTheme?(bytes: Uint8Array): Promise<string>;
  exportTheme?(id: string): Promise<{ filename: string; bytes: Uint8Array }>;
  setThemeEnabled?(id: string, enabled: boolean): Promise<void>;
  deleteTheme?(id: string): Promise<boolean>;
  listSkills?(): Promise<readonly SkillSummary[]>;
  importSkill?(bytes: Uint8Array): Promise<string>;
  activateSkill?(version: string): Promise<void>;
  listExportConfigurations?(): Promise<readonly ExportConfiguration[]>;
  saveExportConfiguration?(value: unknown): Promise<ExportConfiguration>;
  deleteExportConfiguration?(id: string): Promise<void>;
  readSettings?(): Promise<SettingsSnapshot>;
  listSecrets?(): Promise<readonly string[]>;
  saveSettings?(value: Partial<SettingsSnapshot>): Promise<SettingsSnapshot>;
  runDiagnostic?(signal: AbortSignal): Promise<ConnectionDiagnosticSnapshot>;
  readHomeActivity?(): Promise<ConsoleHomeActivitySnapshot>;
}

export interface GalleyActions {
  readonly desktop?: DesktopGalleyActions;
  inspectActiveContext(): Promise<ActiveContext>;
  listArticles(): Promise<ArticleCatalogSnapshot>;
  openPreview(path: string): Promise<void>;
  generateActiveMarkdown(
    input: GenerateArticleFormInput,
    signal: AbortSignal
  ): Promise<GeneratedArticleResult>;
  setLanguage(language: GalleyLanguage): Promise<void>;
}

export interface GalleyActionDependencies {
  readonly inspectActiveContext: () => Promise<ActiveContext>;
  readonly listArticles: () => Promise<ArticleCatalogSnapshot>;
  readonly openPreview: (path: string) => Promise<void>;
  readonly generate?: (
    input: GenerateArticleFormInput,
    signal: AbortSignal
  ) => Promise<GeneratedArticleResult>;
  readonly saveLanguage: (language: GalleyLanguage) => Promise<void>;
  readonly publishLanguage: (language: GalleyLanguage) => void;
  readonly desktop?: DesktopGalleyActions;
}

export function createGalleyActions(
  dependencies: GalleyActionDependencies
): GalleyActions {
  return Object.freeze({
    ...(dependencies.desktop ? { desktop: dependencies.desktop } : {}),
    inspectActiveContext: () => dependencies.inspectActiveContext(),
    listArticles: () => dependencies.listArticles(),
    openPreview: (path: string) => dependencies.openPreview(path),
    generateActiveMarkdown: async (
      input: GenerateArticleFormInput,
      signal: AbortSignal
    ) => {
      signal.throwIfAborted();
      if (!dependencies.generate) {
        throw new Error("Desktop generation is unavailable on this platform.");
      }
      return dependencies.generate(input, signal);
    },
    setLanguage: async (language: GalleyLanguage) => {
      await dependencies.saveLanguage(language);
      dependencies.publishLanguage(language);
    }
  });
}
