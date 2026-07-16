import type { GalleyLanguage } from "../i18n/LocalizedText";
import type {
  GenerationModelEvent,
  GenerationStage
} from "../generation/GenerationProgress";

export type ConsoleRoute =
  | "home"
  | "generation"
  | "articles"
  | "themes"
  | "skills"
  | "settings";

export type MobileConsoleRoute = "home" | "articles";

export type OperationState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly operation: string;
      readonly message?: string;
    }
  | { readonly status: "success"; readonly message: string }
  | {
      readonly status: "partial-success";
      readonly message: string;
      readonly path: string;
    }
  | { readonly status: "error"; readonly message: string };

export type ActiveContext =
  | { readonly kind: "empty" }
  | {
      readonly kind: "markdown";
      readonly path: string;
      readonly name: string;
      readonly words?: number;
      readonly characters?: number;
    }
  | {
      readonly kind: "galley";
      readonly path: string;
      readonly name: string;
    };

export type UnavailableArticleReason =
  | "missing_sidecar"
  | "missing_html"
  | "invalid_sidecar"
  | "invalid_document"
  | "html_hash_mismatch"
  | "unreadable";

export interface CatalogArticle {
  readonly htmlPath: string;
  readonly sidecarPath: string;
  readonly sourcePath: string;
  readonly documentId: string;
  readonly themeId: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly modifiedAt: number;
  readonly exportCount: number;
  readonly validation: "valid" | "unverified";
}

export interface UnavailableArticle {
  readonly path: string;
  readonly reason: UnavailableArticleReason;
}

export interface ArticleCatalogSnapshot {
  readonly documents: readonly CatalogArticle[];
  readonly unavailable: readonly UnavailableArticle[];
}

export interface GenerateArticleFormInput {
  readonly themeId?: string;
  readonly sourcePath?: string;
  readonly onProgress?: (stage: GenerationStage) => void;
  readonly onModelEvent?: (event: GenerationModelEvent) => void;
}

export interface GeneratedArticleResult {
  readonly status: "committed" | "partial-success";
  readonly htmlPath: string;
  readonly sidecarPath: string;
  readonly message?: string;
}

export interface ConsoleNavigationItem {
  readonly route: ConsoleRoute;
  readonly labelKey:
    | "console.nav.home"
    | "console.nav.articles"
    | "console.nav.themes"
    | "console.nav.skills"
    | "console.nav.settings";
}

export interface LanguageMutation {
  setLanguage(language: GalleyLanguage): Promise<void>;
}

export const DESKTOP_CONSOLE_ROUTES: readonly ConsoleRoute[] = Object.freeze([
  "home",
  "generation",
  "articles",
  "themes",
  "skills",
  "settings"
]);

export const MOBILE_CONSOLE_ROUTES: readonly MobileConsoleRoute[] =
  Object.freeze(["home", "articles"]);
