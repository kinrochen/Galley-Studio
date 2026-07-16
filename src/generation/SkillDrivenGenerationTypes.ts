import type { SkillLoadAudit } from "../skill/SkillAudit";
import type { AnnotatedSource } from "../source/SourceAnnotator";
import type { ThemeDefinition } from "../themes/ThemeIndex";
import type { ValidationIssue, ValidationReport } from "../validation/ValidationIssue";

export interface GenerateArticleInput {
  readonly sourcePath: string;
  readonly markdown: string;
  readonly manualThemeId?: string;
  readonly modelContextWindow: number;
}

export interface GeneratedDocument {
  readonly status: "verified" | "unverified";
  readonly html: string;
  readonly theme: ThemeDefinition;
  readonly source: AnnotatedSource;
  readonly validation: ValidationReport;
  readonly skillAudit: SkillLoadAudit;
  readonly diagnostics: ValidationIssue[];
}

export interface GenerationCommandPipeline {
  generate(input: GenerateArticleInput, signal: AbortSignal): Promise<GeneratedDocument>;
}
