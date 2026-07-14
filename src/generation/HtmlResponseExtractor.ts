import {
  containsDocumentShellToken,
  locateHtmlDocument
} from "../documents/HtmlShellScanner";

const FENCE_LINE_PATTERN = /^[\t ]*```([^\r\n]*)$/gm;

interface UnwrappedResponse {
  source: string;
  outsideFence: string[];
}

export function extractHtmlDocument(modelText: string): string {
  const { source, outsideFence } = unwrapOptionalHtmlFence(modelText);
  try {
    if (outsideFence.some((part) => containsDocumentShellToken(part))) {
      throw new Error("another document shell occurs outside the html fence");
    }
    const range = locateHtmlDocument(source, {
      requireHead: false,
      allowSurroundingContent: true
    });
    return source.slice(range.start, range.end);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Model output must contain a single complete HTML document: ${detail}`
    );
  }
}

function unwrapOptionalHtmlFence(modelText: string): UnwrappedResponse {
  const fenceLines = [...modelText.matchAll(FENCE_LINE_PATTERN)];
  if (fenceLines.length === 0) {
    if (modelText.includes("```")) {
      throw new Error("Model output contains an incomplete or ambiguous fence");
    }
    return { source: modelText, outsideFence: [] };
  }

  if (fenceLines.length !== 2) {
    throw new Error("Model output must contain at most one HTML fence");
  }

  const opening = fenceLines[0];
  const closing = fenceLines[1];
  if (
    !opening ||
    !closing ||
    opening[1]?.trim().toLowerCase() !== "html" ||
    closing[1]?.trim() !== ""
  ) {
    throw new Error("A fenced document must use one unambiguous html fence");
  }

  const openingIndex = matchIndex(opening);
  const openingEnd = openingIndex + opening[0].length;
  const newline = /\r?\n/y;
  newline.lastIndex = openingEnd;
  const newlineMatch = newline.exec(modelText);
  const closingIndex = matchIndex(closing);
  if (!newlineMatch || closingIndex <= newline.lastIndex) {
    throw new Error("The html fence must contain a complete document");
  }

  const before = modelText.slice(0, openingIndex);
  const after = modelText.slice(closingIndex + closing[0].length);
  if (before.includes("```") || after.includes("```")) {
    throw new Error("Model output contains an ambiguous fenced document");
  }

  return {
    source: modelText.slice(newline.lastIndex, closingIndex).trim(),
    outsideFence: [before, after]
  };
}

function matchIndex(match: RegExpMatchArray): number {
  if (match.index === undefined) {
    throw new Error("HTML fence match is missing its source position");
  }
  return match.index;
}
