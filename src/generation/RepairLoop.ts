import { AiError } from "../ai/AiError";
import { sanitizeAuthoringDocument } from "../security/AuthoringSanitizer";
import type { SkillSession } from "../skill/SkillSession";
import type {
  AnnotatedSource,
  SourceBlock
} from "../source/SourceAnnotator";
import { validateAuthoringDocument } from "../validation/DocumentValidator";
import type {
  ValidationIssue,
  ValidationReport
} from "../validation/ValidationIssue";
import { extractHtmlDocument } from "./HtmlResponseExtractor";
import { composeRepairPrompt } from "./PromptComposer";

export const EMPTY_SAFE_AUTHORING_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unverified Galley draft</title></head><body><article></article></body></html>';
export const MAX_REPAIR_ROUNDS = 2;

export interface CandidateEvaluation {
  html: string;
  validation: ValidationReport;
  sanitized: boolean;
}

export interface RepairLoopInput {
  session: SkillSession;
  source: AnnotatedSource;
  initial: CandidateEvaluation;
  signal: AbortSignal;
}

export function evaluateCandidate(
  modelText: string,
  source: AnnotatedSource
): CandidateEvaluation {
  let extracted: string;
  try {
    extracted = extractHtmlDocument(modelText);
  } catch {
    return evaluateBoundaryFailure(source, {
      code: "html_extraction_failed",
      severity: "error",
      message:
        "Model output did not contain one exact complete HTML document; return a single complete Authoring document."
    });
  }

  try {
    const document = sanitizeAuthoringDocument(extracted);
    return {
      html: document.html,
      validation: validateAuthoringDocument({ source, document }),
      sanitized: true
    };
  } catch {
    return evaluateBoundaryFailure(source, {
      code: "html_sanitization_failed",
      severity: "error",
      message:
        "The extracted HTML could not be sanitized safely; return a well-formed complete Authoring document."
    });
  }
}

export function evaluateBoundaryFailure(
  source: AnnotatedSource,
  issue: ValidationIssue
): CandidateEvaluation {
  const document = sanitizeAuthoringDocument(EMPTY_SAFE_AUTHORING_HTML);
  const fallback = validateAuthoringDocument({ source, document });
  const issues = [issue, ...fallback.issues];
  return {
    html: document.html,
    validation: {
      valid: !issues.some(({ severity }) => severity === "error"),
      issues
    },
    sanitized: false
  };
}

export function retainLastSanitizedCandidate(
  previous: CandidateEvaluation,
  next: CandidateEvaluation
): CandidateEvaluation {
  if (next.sanitized || !previous.sanitized) {
    return next;
  }
  const boundaryIssue = next.validation.issues[0];
  const issues = uniqueIssues([
    ...(boundaryIssue === undefined ? [] : [boundaryIssue]),
    ...previous.validation.issues
  ]);
  return {
    html: previous.html,
    validation: { valid: false, issues },
    sanitized: true
  };
}

export function missingSourceBlocksForIssues(
  source: AnnotatedSource,
  issues: readonly ValidationIssue[]
): SourceBlock[] {
  const missing = new Set(
    issues
      .filter(({ code, sourceId }) => code === "source_missing" && sourceId)
      .map(({ sourceId }) => sourceId as string)
  );
  return source.blocks.filter(({ id }) => missing.has(id));
}

export async function runRepairLoop(
  input: RepairLoopInput
): Promise<CandidateEvaluation> {
  let current = input.initial;
  for (
    let repairRound = 0;
    !current.validation.valid && repairRound < MAX_REPAIR_ROUNDS;
    repairRound += 1
  ) {
    throwIfAborted(input.signal);
    const response = await input.session.completeScoped(
      composeRepairPrompt({
        issues: current.validation.issues,
        currentHtml: current.html,
        missingSourceBlocks: missingSourceBlocksForIssues(
          input.source,
          current.validation.issues
        )
      }),
      input.signal
    );
    throwIfAborted(input.signal);
    current = retainLastSanitizedCandidate(
      current,
      evaluateCandidate(response, input.source)
    );
  }
  return current;
}

function uniqueIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([
      issue.code,
      issue.severity,
      issue.message,
      issue.sourceId ?? null,
      issue.selector ?? null
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AiError("aborted");
  }
}
