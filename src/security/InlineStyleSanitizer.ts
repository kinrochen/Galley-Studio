import {
  hasAsciiControl,
  hasBidiControl
} from "./ControlCharacters";

export interface SanitizedInlineStyle {
  style: string;
  removed: string[];
}

const ALLOWED_PROPERTIES = new Set([
  "align-content",
  "align-items",
  "align-self",
  "aspect-ratio",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-block",
  "border-block-color",
  "border-block-end",
  "border-block-end-color",
  "border-block-end-style",
  "border-block-end-width",
  "border-block-start",
  "border-block-start-color",
  "border-block-start-style",
  "border-block-start-width",
  "border-block-style",
  "border-block-width",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-color",
  "border-inline",
  "border-inline-color",
  "border-inline-end",
  "border-inline-end-color",
  "border-inline-end-style",
  "border-inline-end-width",
  "border-inline-start",
  "border-inline-start-color",
  "border-inline-start-style",
  "border-inline-start-width",
  "border-inline-style",
  "border-inline-width",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "border-width",
  "box-shadow",
  "box-sizing",
  "color",
  "column-gap",
  "display",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "font",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-size",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-variant-caps",
  "font-weight",
  "gap",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-position",
  "list-style-type",
  "margin",
  "margin-block",
  "margin-block-end",
  "margin-block-start",
  "margin-bottom",
  "margin-inline",
  "margin-inline-end",
  "margin-inline-start",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "object-position",
  "opacity",
  "order",
  "overflow",
  "overflow-wrap",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-block",
  "padding-block-end",
  "padding-block-start",
  "padding-bottom",
  "padding-inline",
  "padding-inline-end",
  "padding-inline-start",
  "padding-left",
  "padding-right",
  "padding-top",
  "position",
  "row-gap",
  "tab-size",
  "text-align",
  "text-align-last",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-indent",
  "text-overflow",
  "text-shadow",
  "text-transform",
  "text-underline-offset",
  "vertical-align",
  "white-space",
  "width",
  "word-break",
  "word-spacing"
]);

const ALLOWED_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "conic-gradient",
  "hsl",
  "hsla",
  "lab",
  "lch",
  "linear-gradient",
  "max",
  "min",
  "oklab",
  "oklch",
  "radial-gradient",
  "repeating-conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "rgb",
  "rgba"
]);

const DISPLAY_VALUES = new Set(["block", "inline", "inline-block", "flex"]);
const SAFE_POSITION_VALUES = new Set(["relative", "static"]);
const PROPERTY_PATTERN = /^-?[a-z][a-z0-9-]*$/i;
const UNSAFE_VALUE_PATTERN =
  /(?:url|expression|var|env|image-set|-webkit-image-set|cross-fade|element|paint)\s*\(|@import\b|behavior\b|-moz-binding\b/i;

interface DeclarationCandidate {
  text: string;
  malformed: boolean;
}

export function sanitizeInlineStyle(styleText: string): SanitizedInlineStyle {
  const kept: string[] = [];
  const removed: string[] = [];
  const validationElement = new DOMParser()
    .parseFromString("<!doctype html><html><body></body></html>", "text/html")
    .createElement("span");

  for (const candidate of splitDeclarations(styleText)) {
    const declaration = candidate.text.trim();
    if (!declaration) {
      continue;
    }

    const colon = findDeclarationColon(declaration);
    const property = normalizeDiagnosticName(
      colon < 0 ? declaration : declaration.slice(0, colon)
    );
    if (candidate.malformed || colon < 0) {
      removed.push(property);
      continue;
    }

    const rawProperty = declaration.slice(0, colon).trim();
    let value = declaration.slice(colon + 1).trim();
    const normalizedProperty = rawProperty.toLowerCase();
    if (
      !PROPERTY_PATTERN.test(rawProperty) ||
      rawProperty.includes("\\") ||
      rawProperty.startsWith("--") ||
      !ALLOWED_PROPERTIES.has(normalizedProperty) ||
      !value ||
      hasUnsafeSyntax(value)
    ) {
      removed.push(normalizedProperty || property);
      continue;
    }

    let priority = "";
    const priorityMatch = /\s*!\s*important\s*$/i.exec(value);
    if (priorityMatch) {
      value = value.slice(0, priorityMatch.index).trim();
      priority = "important";
    }
    if (!value || /!/.test(value)) {
      removed.push(normalizedProperty);
      continue;
    }

    if (
      (normalizedProperty === "display" &&
        !DISPLAY_VALUES.has(value.toLowerCase())) ||
      (normalizedProperty === "position" &&
        !SAFE_POSITION_VALUES.has(value.toLowerCase())) ||
      !hasOnlySafeFunctions(value) ||
      !isSafeBackground(normalizedProperty, value) ||
      !cssomAccepts(validationElement, normalizedProperty, value, priority)
    ) {
      removed.push(normalizedProperty);
      continue;
    }

    kept.push(
      `${normalizedProperty}: ${value}${priority ? " !important" : ""}`
    );
  }

  return { style: kept.join("; "), removed };
}

function splitDeclarations(styleText: string): DeclarationCandidate[] {
  const declarations: DeclarationCandidate[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  let malformed = false;

  for (let index = 0; index < styleText.length; index += 1) {
    const character = styleText[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
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
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) {
        malformed = true;
      } else {
        depth -= 1;
      }
      continue;
    }
    if (character === ";" && depth === 0) {
      declarations.push({ text: styleText.slice(start, index), malformed });
      start = index + 1;
      malformed = false;
    }
  }

  declarations.push({
    text: styleText.slice(start),
    malformed: malformed || Boolean(quote) || depth !== 0 || escaped
  });
  return declarations;
}

function findDeclarationColon(declaration: string): number {
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < declaration.length; index += 1) {
    const character = declaration[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === ":" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function hasUnsafeSyntax(value: string): boolean {
  return (
    value.includes("\\") ||
    value.includes("/*") ||
    value.includes("*/") ||
    hasAsciiControl(value, true) ||
    hasBidiControl(value) ||
    UNSAFE_VALUE_PATTERN.test(value)
  );
}

function hasOnlySafeFunctions(value: string): boolean {
  for (const match of value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
    const name = match[1]?.toLowerCase();
    if (!name || !ALLOWED_FUNCTIONS.has(name)) {
      return false;
    }
  }
  return true;
}

function isSafeBackground(property: string, value: string): boolean {
  if (property !== "background-image") {
    return true;
  }
  return (
    value.toLowerCase() === "none" ||
    /^(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i.test(value)
  );
}

function cssomAccepts(
  element: HTMLElement,
  property: string,
  value: string,
  priority: string
): boolean {
  element.removeAttribute("style");
  element.style.setProperty(property, value, priority);
  return element.style.getPropertyValue(property) !== "";
}

function normalizeDiagnosticName(value: string): string {
  const name = value.trim().split(/[\s:]/u, 1)[0]?.toLowerCase() ?? "";
  return name || "<invalid>";
}
