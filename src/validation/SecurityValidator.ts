import {
  sanitizeAuthoringDocument,
  type SanitizedDocument
} from "../security/AuthoringSanitizer";
import type { ValidationIssue } from "./ValidationIssue";

type SanitizerRemoval = SanitizedDocument["removed"][number];
type SecurityIssueCode =
  | "unsafe_content_removed"
  | "unsafe_content_present";

export function validateSecurity(
  document: SanitizedDocument
): ValidationIssue[];
export function validateSecurity(
  removals: readonly SanitizerRemoval[]
): ValidationIssue[];
export function validateSecurity(
  input: SanitizedDocument | readonly SanitizerRemoval[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const removals = isSanitizedDocument(input) ? input.removed : input;

  appendRemovalIssues(
    issues,
    seen,
    removals,
    "unsafe_content_removed",
    "was removed"
  );

  if (isSanitizedDocument(input)) {
    try {
      const inspection = sanitizeAuthoringDocument(input.html);
      appendRemovalIssues(
        issues,
        seen,
        inspection.removed,
        "unsafe_content_present",
        "remains in sanitized HTML"
      );
    } catch {
      issues.push({
        code: "unsafe_content_present",
        severity: "error",
        message:
          "Sanitized Authoring HTML could not be inspected for unsafe content."
      });
    }
  }

  return issues;
}

function appendRemovalIssues(
  issues: ValidationIssue[],
  seen: Set<string>,
  removals: readonly SanitizerRemoval[],
  code: SecurityIssueCode,
  state: string
): void {
  for (const removal of removals) {
    const name = removal.name.trim().toLowerCase() || "unknown";
    if (isBenignRemoval(removal.kind, name)) {
      continue;
    }

    const key = `${removal.kind}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    issues.push({
      code,
      severity: "error",
      message: removalMessage(removal.kind, name, state)
    });
  }
}

function isBenignRemoval(
  kind: SanitizerRemoval["kind"],
  name: string
): boolean {
  // AuthoringSanitizer logs unsupported link targets under this identity.
  // Its _blank noopener/noreferrer hardening is not logged.
  return kind === "attribute" && name === "target";
}

function removalMessage(
  kind: SanitizerRemoval["kind"],
  name: string,
  state: string
): string {
  if (kind === "element") {
    return `Unsupported or unsafe element <${name}> ${state}; regenerate without it.`;
  }
  if (kind === "url") {
    return `Unsafe URL in ${name} ${state}; use a permitted local, web, or image resource URL.`;
  }
  return `Unsupported or unsafe attribute or CSS declaration ${name} ${state}; use only the Authoring subset.`;
}

function isSanitizedDocument(
  input: SanitizedDocument | readonly SanitizerRemoval[]
): input is SanitizedDocument {
  return !Array.isArray(input);
}
