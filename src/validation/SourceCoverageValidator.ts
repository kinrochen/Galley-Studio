import type { AnnotatedSource } from "../source/SourceAnnotator";
import type { ValidationIssue } from "./ValidationIssue";

export function validateSourceCoverage(
  source: AnnotatedSource | readonly string[],
  html: string
): ValidationIssue[] {
  const expected = expectedIds(source);
  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [
      {
        code: "source_document_invalid",
        severity: "error",
        message: "Source coverage could not inspect the Authoring document DOM."
      }
    ];
  }

  const actual = [...document.querySelectorAll("[data-galley-source]")].map(
    (element) => element.getAttribute("data-galley-source") ?? ""
  );
  const expectedSet = new Set(expected);
  const counts = countIds(actual);
  const uniqueActual = uniqueInOrder(actual);
  const issues: ValidationIssue[] = [];

  for (const sourceId of uniqueInOrder(expected)) {
    if (!counts.has(sourceId)) {
      issues.push({
        code: "source_missing",
        severity: "error",
        message: `Source block ${quoted(sourceId)} is missing from the Authoring document.`,
        sourceId
      });
    }
  }

  for (const sourceId of uniqueActual) {
    const count = counts.get(sourceId) ?? 0;
    if (count > 1) {
      issues.push({
        code: "source_duplicate",
        severity: "error",
        message: `Source block ${quoted(sourceId)} appears ${count} times; render it exactly once.`,
        sourceId
      });
    }
  }

  for (const sourceId of uniqueActual) {
    if (!sourceId) {
      issues.push({
        code: "source_invalid",
        severity: "error",
        message:
          "A data-galley-source marker is empty; use the exact supplied source block ID.",
        sourceId
      });
    } else if (!expectedSet.has(sourceId)) {
      issues.push({
        code: "source_unexpected",
        severity: "error",
        message: `Source marker ${quoted(sourceId)} was not supplied; remove the invented marker.`,
        sourceId
      });
    }
  }

  if (!sameSequence(uniqueActual, expected)) {
    issues.push({
      code: "source_order",
      severity: "error",
      message:
        "data-galley-source markers must match every supplied source block exactly once and in source order."
    });
  }

  return issues;
}

function expectedIds(source: AnnotatedSource | readonly string[]): string[] {
  if (isAnnotatedSource(source)) {
    return source.blocks.map(({ id }) => id);
  }
  return source.map((id) => String(id));
}

function isAnnotatedSource(
  source: AnnotatedSource | readonly string[]
): source is AnnotatedSource {
  return !Array.isArray(source);
}

function countIds(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function uniqueInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

function sameSequence(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function quoted(value: string): string {
  return JSON.stringify(value);
}
