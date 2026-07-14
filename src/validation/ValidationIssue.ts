export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  sourceId?: string;
  selector?: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}
