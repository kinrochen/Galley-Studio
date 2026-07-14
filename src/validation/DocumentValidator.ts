import type { SanitizedDocument } from "../security/AuthoringSanitizer";
import type { AnnotatedSource } from "../source/SourceAnnotator";
import { validateAuthoringContract } from "./AuthoringContractValidator";
import { validateSecurity } from "./SecurityValidator";
import { validateSourceCoverage } from "./SourceCoverageValidator";
import type { ValidationIssue, ValidationReport } from "./ValidationIssue";

export interface AuthoringValidationInput {
  source: AnnotatedSource;
  document: SanitizedDocument;
}

export function validateAuthoringDocument(
  input: AuthoringValidationInput
): ValidationReport {
  const issues: ValidationIssue[] = [];

  issues.push(
    ...runValidator(
      "validation_security_failed",
      "Security removal diagnostics could not be inspected.",
      () => validateSecurity(input.document)
    )
  );
  issues.push(
    ...runValidator(
      "validation_contract_failed",
      "Authoring document contract validation could not inspect the HTML.",
      () => validateAuthoringContract(input.document.html)
    )
  );
  issues.push(
    ...runValidator(
      "validation_source_failed",
      "Source coverage validation could not inspect the document.",
      () => validateSourceCoverage(input.source, input.document.html)
    )
  );

  return {
    valid: !issues.some(({ severity }) => severity === "error"),
    issues
  };
}

function runValidator(
  code: string,
  message: string,
  validate: () => ValidationIssue[]
): ValidationIssue[] {
  try {
    return validate();
  } catch {
    return [{ code, severity: "error", message }];
  }
}
