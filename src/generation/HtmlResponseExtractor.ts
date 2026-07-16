import {
  containsDocumentShellToken,
  locateHtmlDocument
} from "../documents/HtmlShellScanner";

const FENCE_LINE_PATTERN = /^[\t ]*```([^\r\n]*)$/gm;
const FLEXIBLE_FENCE_PATTERN = /```([a-z0-9_-]*)[ \t]*(?:\r?\n)?/giu;
const ARTICLE_ROOT_TAGS = new Set(["article", "main", "section", "div"]);

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

/**
 * Extracts the final artifact from model responses that may include prose,
 * Markdown fences, or other conversational context.
 */
export function extractFinalHtmlContent(modelText: string): string {
  const source = modelText.trim();
  if (!source) throw new Error("Model output did not contain HTML.");

  for (const candidate of flexibleFenceCandidates(source)) {
    const extracted = extractCandidate(candidate);
    if (extracted) return extracted;
  }

  const extracted = extractCandidate(source);
  if (extracted) return extracted;
  throw new Error("Model output did not contain one usable HTML artifact.");
}

function extractCandidate(value: string): string | null {
  try {
    return extractHtmlDocument(value);
  } catch {
    const cleanFragment = extractCleanFragment(value);
    if (cleanFragment) return cleanFragment;
    return extractLargestArticleRoot(value);
  }
}

function extractCleanFragment(value: string): string | null {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  const children = [...parsed.body.children];
  if (children.length === 0) return null;
  const hasOutsideText = [...parsed.body.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
  );
  if (hasOutsideText) return null;
  const structuralChildren = children.filter((element) =>
    ARTICLE_ROOT_TAGS.has(element.localName)
  );
  if (
    structuralChildren.length > 0 &&
    structuralChildren.length !== children.length
  ) {
    structuralChildren.sort(
      (left, right) => right.outerHTML.length - left.outerHTML.length
    );
    return structuralChildren[0]?.outerHTML.trim() ?? null;
  }
  return parsed.body.innerHTML.trim() || null;
}

function extractLargestArticleRoot(value: string): string | null {
  const parsed = new DOMParser().parseFromString(value, "text/html");
  const candidates = [...parsed.body.children].filter((element) =>
    ARTICLE_ROOT_TAGS.has(element.localName) &&
    (element.outerHTML.length >= 128 || element.querySelectorAll("*").length >= 2)
  );
  candidates.sort((left, right) => right.outerHTML.length - left.outerHTML.length);
  return candidates[0]?.outerHTML.trim() ?? null;
}

function flexibleFenceCandidates(value: string): string[] {
  const markers = [...value.matchAll(FLEXIBLE_FENCE_PATTERN)];
  const candidates: string[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const opening = markers[index];
    if (!opening || !["", "html"].includes(opening[1]?.toLowerCase() ?? "")) {
      continue;
    }
    const openingEnd = matchIndex(opening) + opening[0].length;
    const closing = markers
      .slice(index + 1)
      .find((marker) => (marker[1] ?? "") === "");
    const closingStart = closing ? matchIndex(closing) : value.length;
    if (closingStart <= openingEnd) continue;
    const candidate = value.slice(openingEnd, closingStart).trim();
    if (candidate) candidates.push(candidate);
    if ((opening[1] ?? "").toLowerCase() === "html") break;
  }
  return candidates;
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
