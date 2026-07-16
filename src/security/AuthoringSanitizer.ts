import createDOMPurify, {
  type Config,
  type RemovedAttribute,
  type RemovedElement
} from "dompurify";
import { locateHtmlDocument } from "../documents/HtmlShellScanner";
import {
  hasAsciiControl,
  stripAsciiControlAndSpace
} from "./ControlCharacters";
import { sanitizeInlineStyle } from "./InlineStyleSanitizer";

export interface SanitizedDocument {
  html: string;
  removed: Array<{ kind: "element" | "attribute" | "url"; name: string }>;
}

const ALLOWED_TAGS = [
  "html",
  "head",
  "body",
  "title",
  "meta",
  "main",
  "article",
  "section",
  "header",
  "footer",
  "aside",
  "nav",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "small",
  "mark",
  "sub",
  "sup",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "figure",
  "figcaption",
  "picture",
  "img",
  "a",
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "time",
  "abbr",
  "cite",
  "q",
  "video",
  "audio",
  "source"
];

const FORBIDDEN_TAGS = [
  "script",
  "style",
  "base",
  "link",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "fieldset",
  "legend",
  "label",
  "output",
  "template",
  "noscript",
  "svg",
  "math"
];

const GALLEY_ATTRIBUTES = new Set([
  "data-galley-source",
  "data-galley-role",
  "data-galley-slot"
]);

const GLOBAL_ATTRIBUTES = new Set([
  "class",
  "dir",
  "id",
  "lang",
  "role",
  "style",
  "title"
]);

const TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href", "rel", "target"]),
  audio: new Set(["controls", "muted", "preload", "src"]),
  blockquote: new Set(["cite"]),
  col: new Set(["span"]),
  img: new Set([
    "alt",
    "decoding",
    "height",
    "loading",
    "src",
    "width"
  ]),
  li: new Set(["value"]),
  meta: new Set(["charset", "content", "name", "property"]),
  ol: new Set(["reversed", "start", "type"]),
  q: new Set(["cite"]),
  source: new Set(["media", "src", "type"]),
  span: new Set(["leaf"]),
  td: new Set(["colspan", "headers", "rowspan"]),
  th: new Set(["abbr", "colspan", "headers", "rowspan", "scope"]),
  time: new Set(["datetime"]),
  video: new Set([
    "controls",
    "height",
    "muted",
    "poster",
    "preload",
    "src",
    "width"
  ])
};

const URL_ATTRIBUTES = new Set(["cite", "href", "poster", "src"]);
const MAX_URL_DECODE_PASSES = 4;
const DOMPURIFY_ATTRIBUTES = [
  ...GLOBAL_ATTRIBUTES,
  ...GALLEY_ATTRIBUTES,
  ...new Set(Object.values(TAG_ATTRIBUTES).flatMap((names) => [...names]))
];

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: DOMPURIFY_ATTRIBUTES,
  ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  ADD_URI_SAFE_ATTR: [...URL_ATTRIBUTES],
  FORBID_TAGS: FORBIDDEN_TAGS,
  KEEP_CONTENT: true,
  SANITIZE_DOM: true,
  SAFE_FOR_XML: true,
  WHOLE_DOCUMENT: true,
  RETURN_TRUSTED_TYPE: false
};

const DOCUMENT_ONLY_TAGS = new Set(["html", "head", "body", "title", "meta"]);
const HUGERTE_GLOBAL_ATTRIBUTES = [
  ...GLOBAL_ATTRIBUTES,
  "aria-*",
  ...GALLEY_ATTRIBUTES
];

export const HUGERTE_VALID_ELEMENTS = [
  `@[${HUGERTE_GLOBAL_ATTRIBUTES.join("|")}]`,
  ...ALLOWED_TAGS.filter((tag) => !DOCUMENT_ONLY_TAGS.has(tag)).map((tag) => {
    const attributes = TAG_ATTRIBUTES[tag];
    return attributes?.size
      ? `${tag}[${[...attributes].join("|")}]`
      : tag;
  })
].join(",");

export interface AuthoringSanitizerOptions {
  readonly additionalAttributes?: readonly string[];
}

export function sanitizeAuthoringDocument(
  html: string,
  options: AuthoringSanitizerOptions = {}
): SanitizedDocument {
  const source = html.trim();
  locateHtmlDocument(source, {
    requireHead: false,
    allowSurroundingContent: false
  });
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const removed: SanitizedDocument["removed"] = [];

  const additionalAttributes = validateAdditionalAttributes(
    options.additionalAttributes ?? []
  );
  preprocessDocument(parsed, removed, additionalAttributes);

  const canonicalInput = `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
  const purifier = createDOMPurify(window);
  const clean = purifier.sanitize(canonicalInput, {
    ...PURIFY_CONFIG,
    ...(additionalAttributes.size === 0
      ? {}
      : { ADD_ATTR: [...additionalAttributes] })
  });
  recordPurifyRemovals(purifier.removed, removed);

  const cleanDocument = new DOMParser().parseFromString(clean, "text/html");
  const sanitizedHtml = `<!DOCTYPE html>${cleanDocument.documentElement.outerHTML}`;
  locateHtmlDocument(sanitizedHtml, {
    requireHead: true,
    allowSurroundingContent: false
  });
  return {
    html: sanitizedHtml,
    removed
  };
}

function preprocessDocument(
  document: Document,
  removed: SanitizedDocument["removed"],
  additionalAttributes: ReadonlySet<string>
): void {
  for (const meta of document.querySelectorAll("meta[http-equiv]")) {
    meta.remove();
    removed.push({ kind: "element", name: "meta" });
  }

  for (const element of document.querySelectorAll("*")) {
    const tag = element.localName.toLowerCase();
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!isAllowedAttribute(tag, name, additionalAttributes)) {
        element.removeAttribute(attribute.name);
        removed.push({ kind: "attribute", name });
        continue;
      }

      if (name === "style") {
        const style = sanitizeInlineStyle(attribute.value);
        for (const property of style.removed) {
          removed.push({ kind: "attribute", name: property });
        }
        if (style.style) {
          element.setAttribute("style", style.style);
        } else {
          element.removeAttribute("style");
        }
        continue;
      }

      if (
        URL_ATTRIBUTES.has(name) &&
        !isSafeAuthoringUrl(attribute.value, name, tag)
      ) {
        element.removeAttribute(attribute.name);
        removed.push({ kind: "url", name });
      }
    }

    if (tag === "a") {
      secureLinkTarget(element, removed);
    }
  }
}

function isAllowedAttribute(
  tag: string,
  name: string,
  additionalAttributes: ReadonlySet<string>
): boolean {
  return (
    GLOBAL_ATTRIBUTES.has(name) ||
    GALLEY_ATTRIBUTES.has(name) ||
    additionalAttributes.has(name) ||
    /^aria-[a-z0-9-]+$/.test(name) ||
    Boolean(TAG_ATTRIBUTES[tag]?.has(name))
  );
}

function validateAdditionalAttributes(
  attributes: readonly string[]
): ReadonlySet<string> {
  const validated = new Set<string>();
  for (const attribute of attributes) {
    if (!/^data-galley-[a-z0-9-]+$/u.test(attribute)) {
      throw new Error("Additional sanitizer attributes must be Galley data attributes.");
    }
    validated.add(attribute);
  }
  return validated;
}

function secureLinkTarget(
  element: Element,
  removed: SanitizedDocument["removed"]
): void {
  const target = element.getAttribute("target");
  if (!target) {
    return;
  }
  const normalized = target.toLowerCase();
  if (normalized !== "_blank" && normalized !== "_self") {
    element.removeAttribute("target");
    removed.push({ kind: "attribute", name: "target" });
    return;
  }
  if (normalized === "_blank") {
    const rel = new Set(
      (element.getAttribute("rel") ?? "")
        .split(/\s+/u)
        .map((value) => value.toLowerCase())
        .filter(Boolean)
    );
    rel.add("noopener");
    rel.add("noreferrer");
    element.setAttribute("rel", [...rel].join(" "));
  }
}

export function isSafeAuthoringUrl(
  value: string,
  attribute: string,
  tag: string
): boolean {
  const views = decodeUrlSecurityViews(value);
  return Boolean(
    views && views.every((view) => isSafeUrlView(view, attribute, tag))
  );
}

function decodeUrlSecurityViews(value: string): string[] | undefined {
  if (/%(?![0-9a-f]{2})/i.test(value)) {
    return undefined;
  }

  const views = [value];
  let current = value;
  for (let pass = 0; pass < MAX_URL_DECODE_PASSES; pass += 1) {
    const decoded = decodePercentTripletRuns(current);
    if (decoded === undefined) {
      return undefined;
    }
    if (decoded === current) {
      return views;
    }
    views.push(decoded);
    current = decoded;
  }

  const decoded = decodePercentTripletRuns(current);
  return decoded === current ? views : undefined;
}

function decodePercentTripletRuns(value: string): string | undefined {
  let invalidEncoding = false;
  const decoded = value.replace(/(?:%[0-9a-f]{2})+/gi, (sequence) => {
    try {
      return decodeURIComponent(sequence);
    } catch {
      invalidEncoding = true;
      return sequence;
    }
  });
  return invalidEncoding ? undefined : decoded;
}

function isSafeUrlView(
  value: string,
  attribute: string,
  tag: string
): boolean {
  if (
    !value ||
    value !== value.trim() ||
    value.includes("\\") ||
    hasAsciiControl(value)
  ) {
    return false;
  }

  const compact = stripAsciiControlAndSpace(value);
  if (compact.startsWith("//")) {
    return false;
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (!scheme) {
    return true;
  }
  if (scheme === "http" || scheme === "https") {
    return true;
  }
  if (scheme === "app") {
    return attribute === "href" || attribute === "src" || attribute === "poster";
  }
  if (scheme === "mailto" || scheme === "tel" || scheme === "obsidian") {
    return attribute === "href";
  }
  if (scheme === "data") {
    const imageContext =
      (attribute === "src" && tag === "img") ||
      (attribute === "poster" && tag === "video");
    return imageContext && isImageDataUrl(value);
  }
  return false;
}

function isImageDataUrl(value: string): boolean {
  return /^data:image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|vnd\.microsoft\.icon|webp|x-icon)(?:;[^,;=]+=[^,;]*)*(?:;base64)?,/i.test(
    value
  );
}

function recordPurifyRemovals(
  purifyRemovals: Array<RemovedElement | RemovedAttribute>,
  removed: SanitizedDocument["removed"]
): void {
  for (const removal of purifyRemovals) {
    if ("element" in removal) {
      removed.push({
        kind: "element",
        name: removal.element.nodeName.toLowerCase()
      });
      continue;
    }

    const name = removal.attribute?.name.toLowerCase();
    if (name) {
      removed.push({
        kind: URL_ATTRIBUTES.has(name) ? "url" : "attribute",
        name
      });
    }
  }
}
