import type { SanitizedDocument } from "../security/AuthoringSanitizer";
import { sanitizeInlineStyle } from "../security/InlineStyleSanitizer";
import type { ValidationIssue } from "./ValidationIssue";

type SanitizerRemoval = SanitizedDocument["removed"][number];

const UNSAFE_ELEMENTS = new Set([
  "applet",
  "base",
  "button",
  "embed",
  "fieldset",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "label",
  "legend",
  "link",
  "math",
  "meta",
  "noscript",
  "object",
  "option",
  "output",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea"
]);

const UNSAFE_ATTRIBUTES = new Set([
  "action",
  "formaction",
  "http-equiv",
  "manifest",
  "srcdoc",
  "xlink:href",
  "xmlns"
]);

const URL_ATTRIBUTES = new Set(["cite", "href", "poster", "src"]);

const CSS_NAMES = new Set([
  "aspect-ratio",
  "background",
  "box-shadow",
  "box-sizing",
  "color",
  "column-gap",
  "display",
  "filter",
  "float",
  "gap",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "object-fit",
  "object-position",
  "opacity",
  "order",
  "position",
  "row-gap",
  "tab-size",
  "transform",
  "vertical-align",
  "white-space",
  "width"
]);

const CSS_PREFIXES = [
  "align-",
  "animation",
  "backdrop-",
  "background-",
  "behavior",
  "border",
  "flex",
  "font",
  "grid",
  "inset",
  "list-style",
  "margin",
  "max-",
  "min-",
  "-moz-binding",
  "overflow",
  "padding",
  "text-",
  "transition",
  "word-"
] as const;

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

  for (const removal of removals) {
    const name = removal.name.trim().toLowerCase();
    if (!name || !isUnsafeRemoval(removal.kind, name)) {
      continue;
    }

    const key = `${removal.kind}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    issues.push({
      code: "unsafe_content_removed",
      severity: "error",
      message: removalMessage(removal.kind, name)
    });
  }

  if (isSanitizedDocument(input)) {
    issues.push(...validateSanitizedHtml(input.html, seen));
  }

  return issues;
}

function validateSanitizedHtml(
  html: string,
  seen: Set<string>
): ValidationIssue[] {
  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [
      {
        code: "unsafe_content_present",
        severity: "error",
        message:
          "Sanitized Authoring HTML could not be inspected for unsafe content."
      }
    ];
  }

  const issues: ValidationIssue[] = [];
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "style") {
        for (const property of sanitizeInlineStyle(attribute.value).removed) {
          addPresentIssue(
            issues,
            seen,
            "attribute",
            property,
            `Unsafe or forbidden CSS declaration ${property} remains in sanitized HTML.`
          );
        }
      } else if (name.startsWith("on") || UNSAFE_ATTRIBUTES.has(name)) {
        addPresentIssue(
          issues,
          seen,
          "attribute",
          name,
          `Unsafe attribute ${name} remains in sanitized HTML.`
        );
      } else if (
        URL_ATTRIBUTES.has(name) &&
        isUnsafeUrl(attribute.value, name, element.localName.toLowerCase())
      ) {
        addPresentIssue(
          issues,
          seen,
          "url",
          name,
          `Unsafe URL in ${name} remains in sanitized HTML.`
        );
      }
    }

    const name = element.localName.toLowerCase();
    if (name !== "meta" && UNSAFE_ELEMENTS.has(name)) {
      addPresentIssue(
        issues,
        seen,
        "element",
        name,
        `Unsafe element <${name}> remains in sanitized HTML.`
      );
    }
  }
  return issues;
}

function addPresentIssue(
  issues: ValidationIssue[],
  seen: Set<string>,
  kind: SanitizerRemoval["kind"],
  name: string,
  message: string
): void {
  const key = `${kind}:${name}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  issues.push({
    code: "unsafe_content_present",
    severity: "error",
    message
  });
}

function isUnsafeUrl(value: string, attribute: string, tag: string): boolean {
  if (!value || value !== value.trim()) {
    return true;
  }
  const compact = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join("");
  if (compact.startsWith("//") || compact.includes("\\")) {
    return true;
  }

  const separator = compact.indexOf(":");
  if (separator < 0) {
    return false;
  }
  const scheme = compact.slice(0, separator).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
    return false;
  }
  if (scheme === "http" || scheme === "https") {
    return false;
  }
  if (scheme === "app") {
    return (
      attribute !== "href" && attribute !== "src" && attribute !== "poster"
    );
  }
  if (scheme === "mailto" || scheme === "tel" || scheme === "obsidian") {
    return attribute !== "href";
  }
  if (scheme === "data") {
    const imageContext =
      (tag === "img" && attribute === "src") ||
      (tag === "video" && attribute === "poster");
    return !imageContext || !compact.toLowerCase().startsWith("data:image/");
  }
  return true;
}

function isSanitizedDocument(
  input: SanitizedDocument | readonly SanitizerRemoval[]
): input is SanitizedDocument {
  return !Array.isArray(input);
}

function isUnsafeRemoval(
  kind: SanitizerRemoval["kind"],
  name: string
): boolean {
  if (kind === "url") {
    return true;
  }
  if (kind === "element") {
    return UNSAFE_ELEMENTS.has(name);
  }
  return (
    name.startsWith("on") ||
    UNSAFE_ATTRIBUTES.has(name) ||
    isCssDiagnosticName(name)
  );
}

function isCssDiagnosticName(name: string): boolean {
  return (
    name.startsWith("--") ||
    name.startsWith("@") ||
    CSS_NAMES.has(name) ||
    CSS_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function removalMessage(
  kind: SanitizerRemoval["kind"],
  name: string
): string {
  if (kind === "element") {
    return `Unsafe element <${name}> was removed; regenerate the document without this element.`;
  }
  if (kind === "url") {
    return `Unsafe URL in ${name} was removed; use a permitted local, web, or image resource URL.`;
  }
  if (name.startsWith("on") || UNSAFE_ATTRIBUTES.has(name)) {
    return `Unsafe attribute ${name} was removed; regenerate the document without executable attributes.`;
  }
  return `Unsafe or forbidden CSS declaration ${name} was removed; use only permitted inline article styles.`;
}
