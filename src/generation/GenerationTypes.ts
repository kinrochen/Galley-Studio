import type {
  AnnotatedSource,
  SourceBlock
} from "../source/SourceAnnotator";
import type { DocumentBatch } from "../source/LongDocumentPlanner";
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

export interface LongBatchPromptInput {
  batch: DocumentBatch;
  theme: ThemeDefinition;
  articleType: string;
}

export interface LongBatchDesignEvidenceEntry {
  value: string;
  count: number;
}

export interface LongBatchConsistencyManifest {
  totalBatches: number;
  currentPosition: number;
  previousBatchId: string | null;
  nextBatchId: string | null;
  designEvidence: {
    sourceBatchCount: number;
    directChildPatterns: readonly LongBatchDesignEvidenceEntry[];
    classNames: readonly LongBatchDesignEvidenceEntry[];
    elementTags: readonly LongBatchDesignEvidenceEntry[];
    headingLevels: readonly LongBatchDesignEvidenceEntry[];
    inlineStyleDeclarations: readonly LongBatchDesignEvidenceEntry[];
  };
}

export interface LongBatchConsistencyPromptInput {
  batch: DocumentBatch;
  batchManifest: LongBatchConsistencyManifest;
  theme: ThemeDefinition;
  articleType: string;
  currentFragment: string;
}

export interface LongBatchRepairPromptInput
  extends LongBatchConsistencyPromptInput {
  issues: readonly PromptValidationIssue[];
  missingSourceBlocks: readonly SourceBlock[];
}

export interface ThemeCorrectionPromptInput {
  invalidResponse: string;
  themes: readonly ThemeDefinition[];
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
