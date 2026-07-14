import type {
  AnnotatedSource,
  SourceBlock
} from "../source/SourceAnnotator";
import type { SourceResource } from "../source/SourceResourceResolver";
import type { ThemeDefinition } from "../themes/ThemeIndex";

export interface ThemeDecisionPromptInput {
  source: AnnotatedSource;
  themes: readonly ThemeDefinition[];
}

export interface GenerationPromptInput {
  source: AnnotatedSource;
  theme: ThemeDefinition;
  articleType: string;
  resources?: readonly SourceResource[];
}

export interface PromptValidationIssue {
  code: string;
  severity: string;
  message: string;
  sourceId?: string;
  selector?: string;
}

export interface RepairPromptInput {
  issues: readonly PromptValidationIssue[];
  currentHtml: string;
  missingSourceBlocks: readonly SourceBlock[];
}
