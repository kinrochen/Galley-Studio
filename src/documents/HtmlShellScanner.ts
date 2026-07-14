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
      kind: "text" | "comment" | "declaration" | "doctype";
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
      selfClosing: boolean;
    };

const HTML5_DOCTYPE_PATTERN = /^<!doctype\s+html\s*>$/i;
const SHELL_NAMES = new Set(["html", "head", "body"]);
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
      const closing = findRawTextClosing(source, index, rawTextName);
      if (!closing) {
        throw new Error(`unterminated raw-text element <${rawTextName}>`);
      }
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
    if (!token) {
      index += 1;
      continue;
    }

    flushText(index);
    tokens.push(token);
    index = token.end;
    textStart = index;
    if (token.kind === "startTag") {
      if (token.name === "plaintext") {
        rawTextName = "plaintext";
      } else if (RAW_TEXT_NAMES.has(token.name)) {
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

function readMarkupToken(
  source: string,
  start: number
): HtmlToken | undefined {
  if (source.startsWith("<!--", start)) {
    const end = findCommentEnd(source, start);
    return {
      kind: "comment",
      start,
      end,
      raw: source.slice(start, end)
    };
  }

  if (source.startsWith("<!", start) || source.startsWith("<?", start)) {
    return readDeclaration(source, start);
  }

  const tagStart = source[start + 1] === "/" ? start + 2 : start + 1;
  if (!isTagNameCharacter(source[tagStart])) {
    return undefined;
  }
  return readTag(source, start);
}

function findCommentEnd(source: string, start: number): number {
  const contentStart = start + 4;
  if (source[contentStart] === ">") {
    return contentStart + 1;
  }
  if (source[contentStart] === "-" && source[contentStart + 1] === ">") {
    return contentStart + 2;
  }

  for (let index = contentStart; index < source.length; index += 1) {
    if (source.startsWith("<!--", index)) {
      throw new Error("nested HTML comment opener is ambiguous");
    }
    if (source.startsWith("-->", index)) {
      return index + 3;
    }
    if (source.startsWith("--!>", index)) {
      return index + 4;
    }
  }
  throw new Error("unterminated HTML comment");
}

function readDeclaration(source: string, start: number): HtmlToken {
  let quote = "";
  for (let index = start + 2; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      const end = index + 1;
      const raw = source.slice(start, end);
      return {
        kind: /^<!doctype(?:\s|>)/i.test(raw) ? "doctype" : "declaration",
        start,
        end,
        raw
      };
    }
  }
  throw new Error(
    quote ? "unterminated quote in declaration" : "unterminated declaration"
  );
}

function readTag(
  source: string,
  start: number
): Extract<HtmlToken, { kind: "startTag" | "endTag" }> {
  const closing = source[start + 1] === "/";
  const nameStart = start + (closing ? 2 : 1);
  let cursor = nameStart;
  while (cursor < source.length && isTagNameCharacter(source[cursor])) {
    cursor += 1;
  }
  const name = source.slice(nameStart, cursor).toLowerCase();
  if (!name) {
    throw new Error("tag is missing a name");
  }

  type AttributeState =
    | "beforeName"
    | "name"
    | "afterName"
    | "beforeValue"
    | "doubleQuotedValue"
    | "singleQuotedValue"
    | "unquotedValue"
    | "afterQuotedValue";

  let state: AttributeState = "beforeName";
  for (let index = cursor; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (state === "doubleQuotedValue") {
      if (character === '"') {
        state = "afterQuotedValue";
      }
      continue;
    }

    if (state === "singleQuotedValue") {
      if (character === "'") {
        state = "afterQuotedValue";
      }
      continue;
    }

    if (character === ">") {
      const end = index + 1;
      const raw = source.slice(start, end);
      return {
        kind: closing ? "endTag" : "startTag",
        start,
        end,
        raw,
        name,
        selfClosing: /\/\s*>$/.test(raw)
      };
    }

    if (state === "unquotedValue") {
      if (isHtmlWhitespace(character)) {
        state = "beforeName";
      }
      continue;
    }

    if (state === "beforeValue") {
      if (isHtmlWhitespace(character)) {
        continue;
      }
      if (character === '"') {
        state = "doubleQuotedValue";
      } else if (character === "'") {
        state = "singleQuotedValue";
      } else {
        state = "unquotedValue";
      }
      continue;
    }

    if (state === "name") {
      if (isHtmlWhitespace(character)) {
        state = "afterName";
      } else if (character === "=") {
        state = "beforeValue";
      } else if (character === "/") {
        state = "afterName";
      }
      continue;
    }

    if (state === "afterName") {
      if (isHtmlWhitespace(character) || character === "/") {
        continue;
      }
      if (character === "=") {
        state = "beforeValue";
      } else {
        state = "name";
      }
      continue;
    }

    if (state === "afterQuotedValue") {
      if (isHtmlWhitespace(character) || character === "/") {
        state = "beforeName";
      } else {
        state = "name";
      }
      continue;
    }

    if (!isHtmlWhitespace(character) && character !== "/") {
      state = "name";
    }
  }
  throw new Error(
    state === "doubleQuotedValue" || state === "singleQuotedValue"
      ? `unterminated quote in <${name}> tag`
      : `unterminated <${name}> tag`
  );
}

function findRawTextClosing(
  source: string,
  start: number,
  name: string
): Extract<HtmlToken, { kind: "endTag" }> | undefined {
  if (name === "plaintext") {
    return undefined;
  }

  let cursor = start;
  while (cursor < source.length) {
    const candidate = source.indexOf("<", cursor);
    if (candidate < 0) {
      return undefined;
    }
    if (source[candidate + 1] === "/") {
      const token = readMarkupToken(source, candidate);
      if (token?.kind === "endTag" && token.name === name) {
        if (
          name === "script" &&
          source.slice(start, candidate).includes("<!--")
        ) {
          throw new Error("ambiguous escaped content in <script> element");
        }
        return token;
      }
    }
    cursor = candidate + 1;
  }
  return undefined;
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
        assertPlainShellEndTag(token, "head");
        state = "afterHead";
      } else if (isDocumentControlToken(token)) {
        throw documentError("a shell tag is nested or repeated inside head");
      }
      continue;
    }

    if (state === "inBody") {
      if (isEndTag(token, "body")) {
        assertPlainShellEndTag(token, "body");
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
        assertPlainShellEndTag(token, "html");
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
    token.kind === "declaration" ||
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

function assertPlainShellEndTag(
  token: Extract<HtmlToken, { kind: "endTag" }>,
  name: "html" | "head" | "body"
): void {
  if (!new RegExp(`^<\\/${name}\\s*>$`, "i").test(token.raw)) {
    throw documentError(`shell end tag </${name}> is malformed`);
  }
}

function isTagNameCharacter(character: string | undefined): boolean {
  return Boolean(character && !/[\t\n\f\r />]/.test(character));
}

function isHtmlWhitespace(character: string): boolean {
  return /[\t\n\f\r ]/.test(character);
}

function documentError(message: string): Error {
  return new Error(`HTML document shell is invalid: ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
