/**
 * Galley accepts a deliberately strict lexical subset of HTML before any
 * browser parser sees Authoring output. This is not an HTML error-recovery
 * implementation: declarations, tags, attributes, comments, namespaces, and
 * raw-text content that depend on browser recovery fail closed.
 *
 * Accepted markup has one case-insensitive `<!DOCTYPE html>`, well-formed
 * comments, ASCII tag/attribute names, whitespace-delimited attributes, and
 * exact end tags. Quoted attribute values remain opaque so ordinary values may
 * contain `<`/`>`. Foreign namespaces and ambiguous raw/RCDATA `<` constructs
 * are outside the subset.
 */

export interface HtmlDocumentRange {
  start: number;
  end: number;
}

export interface HtmlShellOptions {
  requireHead: boolean;
  allowSurroundingContent: boolean;
}

type HtmlToken =
  | {
      kind: "text";
      start: number;
      end: number;
      raw: string;
    }
  | {
      kind: "comment";
      start: number;
      end: number;
      raw: string;
    }
  | {
      kind: "doctype";
      start: number;
      end: number;
      raw: string;
    }
  | {
      kind: "startTag";
      start: number;
      end: number;
      raw: string;
      name: string;
      selfClosing: boolean;
    }
  | {
      kind: "endTag";
      start: number;
      end: number;
      raw: string;
      name: string;
      selfClosing: false;
    };

const HTML5_DOCTYPE_PATTERN = /^<!doctype html>$/i;
const CANONICAL_DOCTYPE_LENGTH = "<!DOCTYPE html>".length;
const SHELL_NAMES = new Set(["html", "head", "body"]);
const FOREIGN_CONTENT_NAMES = new Set(["svg", "math"]);
const RAW_TEXT_NAMES = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "title",
  "textarea",
  "xmp"
]);
const FORBIDDEN_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export function locateHtmlDocument(
  source: string,
  options: HtmlShellOptions
): HtmlDocumentRange {
  let tokens: HtmlToken[];
  try {
    tokens = scanHtml(source);
  } catch (error) {
    throw documentError(errorMessage(error));
  }

  const doctypes = tokens.filter((token) => token.kind === "doctype");
  const htmlStarts = tokens.filter(
    (token) => token.kind === "startTag" && token.name === "html"
  );
  const htmlEnds = tokens.filter(
    (token) => token.kind === "endTag" && token.name === "html"
  );
  if (
    doctypes.length !== 1 ||
    htmlStarts.length !== 1 ||
    htmlEnds.length !== 1
  ) {
    throw documentError("expected exactly one doctype and html root");
  }

  const doctype = doctypes[0];
  const htmlStart = htmlStarts[0];
  const htmlEnd = htmlEnds[0];
  if (
    !doctype ||
    !htmlStart ||
    !htmlEnd ||
    !HTML5_DOCTYPE_PATTERN.test(doctype.raw) ||
    doctype.start >= htmlStart.start ||
    htmlStart.start >= htmlEnd.start
  ) {
    throw documentError("doctype and html root are malformed or out of order");
  }

  const range = { start: doctype.start, end: htmlEnd.end };
  validateCandidate(tokens, range, options.requireHead);
  validateOutside(tokens, range, options.allowSurroundingContent);
  return range;
}

export function containsDocumentShellToken(source: string): boolean {
  return scanHtml(source).some(
    (token) =>
      token.kind === "doctype" ||
      ((token.kind === "startTag" || token.kind === "endTag") &&
        SHELL_NAMES.has(token.name))
  );
}

export function assertShellFreeHtmlFragment(
  fragment: string,
  label: "head" | "body"
): void {
  let tokens: HtmlToken[];
  try {
    tokens = scanHtml(fragment);
  } catch (error) {
    throw new Error(
      `Galley ${label} fragment is malformed: ${errorMessage(error)}`
    );
  }

  if (
    tokens.some(
      (token) =>
        token.kind === "doctype" ||
        ((token.kind === "startTag" || token.kind === "endTag") &&
          SHELL_NAMES.has(token.name))
    )
  ) {
    throw new Error(`Galley ${label} fragment contains document shell markup`);
  }
}

function scanHtml(source: string): HtmlToken[] {
  if (FORBIDDEN_CONTROL_PATTERN.test(source)) {
    throw new Error("HTML contains a forbidden control character");
  }

  const tokens: HtmlToken[] = [];
  let index = 0;
  let textStart = 0;
  let rawTextName: string | undefined;

  const flushText = (end: number): void => {
    if (end > textStart) {
      tokens.push({
        kind: "text",
        start: textStart,
        end,
        raw: source.slice(textStart, end)
      });
    }
  };

  while (index < source.length) {
    if (rawTextName) {
      const closing = readRawTextClosing(source, index, rawTextName);
      flushText(closing.start);
      tokens.push(closing);
      index = closing.end;
      textStart = index;
      rawTextName = undefined;
      continue;
    }

    if (source[index] !== "<") {
      index += 1;
      continue;
    }

    const token = readMarkupToken(source, index);
    flushText(index);
    tokens.push(token);
    index = token.end;
    textStart = index;

    if (token.kind === "startTag") {
      if (token.name === "plaintext") {
        throw new Error("the <plaintext> content model is unsupported");
      }
      if (RAW_TEXT_NAMES.has(token.name)) {
        if (token.selfClosing) {
          throw new Error(
            `raw-text element <${token.name}> cannot use self-closing syntax`
          );
        }
        rawTextName = token.name;
      }
    }
  }

  if (rawTextName) {
    throw new Error(`unterminated raw-text element <${rawTextName}>`);
  }
  flushText(source.length);
  return tokens;
}

function readMarkupToken(source: string, start: number): HtmlToken {
  if (source.startsWith("<!--", start)) {
    return readStrictComment(source, start);
  }

  if (source.startsWith("<!", start)) {
    const end = start + CANONICAL_DOCTYPE_LENGTH;
    const raw = source.slice(start, end);
    if (!HTML5_DOCTYPE_PATTERN.test(raw)) {
      throw new Error("only the canonical HTML5 doctype declaration is allowed");
    }
    return { kind: "doctype", start, end, raw };
  }

  if (source.startsWith("<?", start)) {
    throw new Error("processing instructions are unsupported");
  }

  if (source[start + 1] === "/") {
    return readStrictEndTag(source, start);
  }

  if (isAsciiLetter(source[start + 1])) {
    return readStrictStartTag(source, start);
  }

  throw new Error("ambiguous less-than markup is unsupported");
}

function readStrictComment(
  source: string,
  start: number
): Extract<HtmlToken, { kind: "comment" }> {
  const contentStart = start + 4;
  const endMarker = source.indexOf("-->", contentStart);
  if (endMarker < 0) {
    throw new Error("unterminated or malformed HTML comment");
  }

  const content = source.slice(contentStart, endMarker);
  if (
    content.startsWith(">") ||
    content.startsWith("->") ||
    content.endsWith("-") ||
    content.includes("<!--") ||
    content.includes("--")
  ) {
    throw new Error("HTML comment requires browser error recovery");
  }

  const end = endMarker + 3;
  return {
    kind: "comment",
    start,
    end,
    raw: source.slice(start, end)
  };
}

function readStrictStartTag(
  source: string,
  start: number
): Extract<HtmlToken, { kind: "startTag" }> {
  let cursor = start + 1;
  const nameStart = cursor;
  cursor = readTagName(source, cursor);
  const name = source.slice(nameStart, cursor).toLowerCase();
  assertHtmlNamespaceName(name);

  const attributes = new Set<string>();
  while (cursor < source.length) {
    const character = source[cursor] ?? "";
    if (character === ">") {
      return startTagToken(source, start, cursor + 1, name, false);
    }
    if (character === "/") {
      if (source[cursor + 1] !== ">") {
        throw new Error(`stray slash in <${name}> tag`);
      }
      return startTagToken(source, start, cursor + 2, name, true);
    }
    if (!isHtmlWhitespace(character)) {
      throw new Error(`attributes in <${name}> must be whitespace-delimited`);
    }

    cursor = skipHtmlWhitespace(source, cursor);
    if (source[cursor] === ">") {
      return startTagToken(source, start, cursor + 1, name, false);
    }
    if (source[cursor] === "/") {
      if (source[cursor + 1] !== ">") {
        throw new Error(`stray slash in <${name}> tag`);
      }
      return startTagToken(source, start, cursor + 2, name, true);
    }

    const attributeStart = cursor;
    cursor = readAttributeName(source, cursor, name);
    const attributeName = source.slice(attributeStart, cursor).toLowerCase();
    if (attributeName === "xmlns") {
      throw new Error("namespace declaration attributes are unsupported");
    }
    if (attributes.has(attributeName)) {
      throw new Error(`duplicate attribute ${attributeName} in <${name}>`);
    }
    attributes.add(attributeName);
    const nameEnd = cursor;
    const equals = skipHtmlWhitespace(source, cursor);
    if (source[equals] !== "=") {
      cursor = nameEnd;
      continue;
    }

    cursor = skipHtmlWhitespace(source, equals + 1);
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const valueEnd = source.indexOf(quote, cursor + 1);
      if (valueEnd < 0) {
        throw new Error(`unterminated quoted ${attributeName} attribute`);
      }
      cursor = valueEnd + 1;
      continue;
    }

    const valueStart = cursor;
    while (
      cursor < source.length &&
      !isHtmlWhitespace(source[cursor] ?? "") &&
      source[cursor] !== ">"
    ) {
      if (isForbiddenUnquotedValueCharacter(source[cursor] ?? "")) {
        throw new Error(
          `invalid character in unquoted ${attributeName} attribute`
        );
      }
      cursor += 1;
    }
    if (cursor === valueStart) {
      throw new Error(`attribute ${attributeName} is missing a value`);
    }
  }

  throw new Error(`unterminated <${name}> tag`);
}

function readStrictEndTag(
  source: string,
  start: number
): Extract<HtmlToken, { kind: "endTag" }> {
  let cursor = start + 2;
  const nameStart = cursor;
  cursor = readTagName(source, cursor);
  const name = source.slice(nameStart, cursor).toLowerCase();
  assertHtmlNamespaceName(name);
  cursor = skipHtmlWhitespace(source, cursor);
  if (source[cursor] !== ">") {
    throw new Error(`end tag </${name}> must not contain attributes or slashes`);
  }

  const end = cursor + 1;
  return {
    kind: "endTag",
    start,
    end,
    raw: source.slice(start, end),
    name,
    selfClosing: false
  };
}

function readRawTextClosing(
  source: string,
  start: number,
  name: string
): Extract<HtmlToken, { kind: "endTag" }> {
  const candidate = source.indexOf("<", start);
  if (candidate < 0) {
    throw new Error(`unterminated raw-text element <${name}>`);
  }

  let token: HtmlToken;
  try {
    token = readMarkupToken(source, candidate);
  } catch {
    throw new Error(`ambiguous less-than content in <${name}> element`);
  }
  if (token.kind !== "endTag" || token.name !== name) {
    throw new Error(`ambiguous less-than content in <${name}> element`);
  }
  return token;
}

function startTagToken(
  source: string,
  start: number,
  end: number,
  name: string,
  selfClosing: boolean
): Extract<HtmlToken, { kind: "startTag" }> {
  return {
    kind: "startTag",
    start,
    end,
    raw: source.slice(start, end),
    name,
    selfClosing
  };
}

function readTagName(source: string, start: number): number {
  if (!isAsciiLetter(source[start])) {
    throw new Error("tag name must start with an ASCII letter");
  }
  let cursor = start + 1;
  while (isTagNameCharacter(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readAttributeName(
  source: string,
  start: number,
  tagName: string
): number {
  if (!isAsciiLetter(source[start])) {
    throw new Error(`attribute name in <${tagName}> must start with a letter`);
  }
  let cursor = start + 1;
  while (isAttributeNameCharacter(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function assertHtmlNamespaceName(name: string): void {
  if (FOREIGN_CONTENT_NAMES.has(name)) {
    throw new Error(`foreign-content element <${name}> is unsupported`);
  }
}

function skipHtmlWhitespace(source: string, start: number): number {
  let cursor = start;
  while (isHtmlWhitespace(source[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function isAsciiLetter(character: string | undefined): boolean {
  return Boolean(character && /[a-z]/i.test(character));
}

function isTagNameCharacter(character: string | undefined): boolean {
  return Boolean(character && /[a-z0-9-]/i.test(character));
}

function isAttributeNameCharacter(character: string | undefined): boolean {
  return Boolean(character && /[a-z0-9._-]/i.test(character));
}

function isHtmlWhitespace(character: string): boolean {
  return /[\t\n\r ]/.test(character);
}

function isForbiddenUnquotedValueCharacter(character: string): boolean {
  return character === '"' || character === "'" || /[`=<]/.test(character);
}

function validateCandidate(
  tokens: readonly HtmlToken[],
  range: HtmlDocumentRange,
  requireHead: boolean
): void {
  type State =
    | "doctype"
    | "beforeHtml"
    | "beforeContent"
    | "inHead"
    | "afterHead"
    | "inBody"
    | "afterBody"
    | "afterHtml";

  let state: State = "doctype";
  let sawHead = false;
  const candidate = tokens.filter(
    (token) => token.start >= range.start && token.end <= range.end
  );

  for (const token of candidate) {
    if (state === "doctype") {
      if (token.kind !== "doctype" || !HTML5_DOCTYPE_PATTERN.test(token.raw)) {
        throw documentError("candidate does not start with an HTML5 doctype");
      }
      state = "beforeHtml";
      continue;
    }

    if (state === "beforeHtml") {
      if (isBoundaryTrivia(token)) {
        continue;
      }
      if (isStartTag(token, "html")) {
        assertNonSelfClosingShellTag(token);
        state = "beforeContent";
        continue;
      }
      throw documentError("non-whitespace content occurs between doctype and html");
    }

    if (state === "beforeContent" || state === "afterHead") {
      if (isBoundaryTrivia(token)) {
        continue;
      }
      if (state === "beforeContent" && isStartTag(token, "head")) {
        assertNonSelfClosingShellTag(token);
        sawHead = true;
        state = "inHead";
        continue;
      }
      if (isStartTag(token, "body")) {
        if (requireHead && !sawHead) {
          throw documentError("an explicit head is required before body");
        }
        assertNonSelfClosingShellTag(token);
        state = "inBody";
        continue;
      }
      throw documentError("content occurs outside the explicit head/body shell");
    }

    if (state === "inHead") {
      if (isEndTag(token, "head")) {
        state = "afterHead";
      } else if (isDocumentControlToken(token)) {
        throw documentError("a shell tag is nested or repeated inside head");
      }
      continue;
    }

    if (state === "inBody") {
      if (isEndTag(token, "body")) {
        state = "afterBody";
      } else if (isDocumentControlToken(token)) {
        throw documentError("a shell tag is nested or repeated inside body");
      }
      continue;
    }

    if (state === "afterBody") {
      if (isBoundaryTrivia(token)) {
        continue;
      }
      if (isEndTag(token, "html")) {
        state = "afterHtml";
        continue;
      }
      throw documentError("content occurs after body but before html closes");
    }

    throw documentError("content occurs after the html root closes");
  }

  if (state !== "afterHtml") {
    throw documentError("doctype/html/head/body tags are missing or unclosed");
  }
}

function validateOutside(
  tokens: readonly HtmlToken[],
  range: HtmlDocumentRange,
  allowSurroundingContent: boolean
): void {
  for (const token of tokens) {
    if (token.start >= range.start && token.end <= range.end) {
      continue;
    }
    if (
      token.kind === "doctype" ||
      ((token.kind === "startTag" || token.kind === "endTag") &&
        SHELL_NAMES.has(token.name))
    ) {
      throw documentError("a second or stray document shell occurs outside the root");
    }
    if (!allowSurroundingContent && !isBoundaryTrivia(token)) {
      throw documentError("non-whitespace content occurs outside the html root");
    }
  }
}

function isBoundaryTrivia(token: HtmlToken): boolean {
  return (
    token.kind === "comment" ||
    (token.kind === "text" && !token.raw.trim())
  );
}

function isDocumentControlToken(token: HtmlToken): boolean {
  return (
    token.kind === "doctype" ||
    ((token.kind === "startTag" || token.kind === "endTag") &&
      SHELL_NAMES.has(token.name))
  );
}

function isStartTag(
  token: HtmlToken,
  name: string
): token is Extract<HtmlToken, { kind: "startTag" }> {
  return token.kind === "startTag" && token.name === name;
}

function isEndTag(
  token: HtmlToken,
  name: string
): token is Extract<HtmlToken, { kind: "endTag" }> {
  return token.kind === "endTag" && token.name === name;
}

function assertNonSelfClosingShellTag(
  token: Extract<HtmlToken, { kind: "startTag" }>
): void {
  if (token.selfClosing) {
    throw documentError(`shell start tag <${token.name}> cannot self-close`);
  }
}

function documentError(message: string): Error {
  return new Error(`HTML document shell is invalid: ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
