const FENCE_LINE_PATTERN = /^[\t ]*```([^\r\n]*)$/gm;
const DOCTYPE_PATTERN = /<!doctype\b[^>]*>/gi;
const HTML_OPEN_PATTERN = /<html\b[^>]*>/gi;
const HTML_CLOSE_PATTERN = /<\/html\s*>/gi;
const BODY_OPEN_PATTERN = /<body\b[^>]*>/gi;
const BODY_CLOSE_PATTERN = /<\/body\s*>/gi;
const HEAD_OPEN_PATTERN = /<head\b[^>]*>/gi;
const HEAD_CLOSE_PATTERN = /<\/head\s*>/gi;

export function extractHtmlDocument(modelText: string): string {
  const source = unwrapOptionalHtmlFence(modelText);
  const doctypes = matches(source, DOCTYPE_PATTERN);
  const htmlOpenings = matches(source, HTML_OPEN_PATTERN);
  const htmlClosings = matches(source, HTML_CLOSE_PATTERN);

  if (
    doctypes.length !== 1 ||
    htmlOpenings.length !== 1 ||
    htmlClosings.length !== 1
  ) {
    throw new Error("Model output must contain a single complete HTML document");
  }

  const doctype = doctypes[0];
  const htmlOpening = htmlOpenings[0];
  const htmlClosing = htmlClosings[0];
  if (
    !doctype ||
    !htmlOpening ||
    !htmlClosing ||
    !/^<!doctype\s+html\s*>$/i.test(doctype[0])
  ) {
    throw new Error("Model output must contain a complete HTML5 document shell");
  }

  const doctypeIndex = matchIndex(doctype);
  const htmlOpeningIndex = matchIndex(htmlOpening);
  const htmlClosingIndex = matchIndex(htmlClosing);
  if (
    doctypeIndex > htmlOpeningIndex ||
    htmlOpeningIndex > htmlClosingIndex
  ) {
    throw new Error("Model output must contain a complete HTML5 document shell");
  }

  const end = htmlClosingIndex + htmlClosing[0].length;
  const candidate = source.slice(doctypeIndex, end).trim();
  assertCandidateShell(candidate);

  const outside = `${source.slice(0, doctypeIndex)}${source.slice(end)}`;
  if (/<!doctype\b|<\/?html\b/i.test(outside)) {
    throw new Error("Model output contains more than one HTML document");
  }

  return candidate;
}

function unwrapOptionalHtmlFence(modelText: string): string {
  const fenceLines = matches(modelText, FENCE_LINE_PATTERN);
  if (fenceLines.length === 0) {
    if (modelText.includes("```")) {
      throw new Error("Model output contains an incomplete or ambiguous fence");
    }
    return modelText;
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

  const openingEnd = matchIndex(opening) + opening[0].length;
  const newline = /\r?\n/y;
  newline.lastIndex = openingEnd;
  const newlineMatch = newline.exec(modelText);
  const closingIndex = matchIndex(closing);
  if (!newlineMatch || closingIndex <= newline.lastIndex) {
    throw new Error("The html fence must contain a complete document");
  }

  const outsideFence = `${modelText.slice(
    0,
    matchIndex(opening)
  )}${modelText.slice(closingIndex + closing[0].length)}`;
  if (/<!doctype\b|<\/?html\b|```/i.test(outsideFence)) {
    throw new Error("Model output contains an ambiguous fenced document");
  }

  return modelText.slice(newline.lastIndex, closingIndex).trim();
}

function assertCandidateShell(candidate: string): void {
  const htmlOpenings = matches(candidate, HTML_OPEN_PATTERN);
  const htmlClosings = matches(candidate, HTML_CLOSE_PATTERN);
  const bodyOpenings = matches(candidate, BODY_OPEN_PATTERN);
  const bodyClosings = matches(candidate, BODY_CLOSE_PATTERN);
  const headOpenings = matches(candidate, HEAD_OPEN_PATTERN);
  const headClosings = matches(candidate, HEAD_CLOSE_PATTERN);

  if (
    matches(candidate, DOCTYPE_PATTERN).length !== 1 ||
    htmlOpenings.length !== 1 ||
    htmlClosings.length !== 1 ||
    bodyOpenings.length !== 1 ||
    bodyClosings.length !== 1 ||
    headOpenings.length !== headClosings.length ||
    headOpenings.length > 1
  ) {
    throw new Error("Model output is missing a complete HTML document shell");
  }

  const htmlOpening = htmlOpenings[0];
  const htmlClosing = htmlClosings[0];
  const bodyOpening = bodyOpenings[0];
  const bodyClosing = bodyClosings[0];
  if (
    !htmlOpening ||
    !htmlClosing ||
    !bodyOpening ||
    !bodyClosing
  ) {
    throw new Error("Model output has a malformed HTML document shell");
  }

  const htmlOpeningIndex = matchIndex(htmlOpening);
  const htmlClosingIndex = matchIndex(htmlClosing);
  const bodyOpeningIndex = matchIndex(bodyOpening);
  const bodyClosingIndex = matchIndex(bodyClosing);
  if (
    htmlOpeningIndex >= bodyOpeningIndex ||
    bodyOpeningIndex >= bodyClosingIndex ||
    bodyClosingIndex >= htmlClosingIndex
  ) {
    throw new Error("Model output has a malformed HTML document shell");
  }

  const headOpening = headOpenings[0];
  const headClosing = headClosings[0];
  if (
    (headOpening && !headClosing) ||
    (!headOpening && headClosing) ||
    (headOpening &&
      headClosing &&
      (htmlOpeningIndex >= matchIndex(headOpening) ||
        matchIndex(headOpening) >= matchIndex(headClosing) ||
        matchIndex(headClosing) >= bodyOpeningIndex))
  ) {
    throw new Error("Model output has a malformed HTML head");
  }
}

function matches(value: string, pattern: RegExp): RegExpMatchArray[] {
  return [...value.matchAll(pattern)];
}

function matchIndex(match: RegExpMatchArray): number {
  if (match.index === undefined) {
    throw new Error("HTML document match is missing its source position");
  }
  return match.index;
}
