import createDOMPurify, {
  type Config,
  type RemovedAttribute,
  type RemovedElement,
  type WindowLike
} from "dompurify";
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

export function sanitizeAuthoringDocument(html: string): SanitizedDocument {
  assertStandaloneShell(html);
  const parsed = new DOMParser().parseFromString(html.trim(), "text/html");
  const removed: SanitizedDocument["removed"] = [];

  preprocessDocument(parsed, removed);

  const canonicalInput = `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
  const purifier = createDOMPurify(window as unknown as WindowLike);
  const clean = purifier.sanitize(canonicalInput, PURIFY_CONFIG);
  recordPurifyRemovals(purifier.removed, removed);

  const cleanDocument = new DOMParser().parseFromString(clean, "text/html");
  return {
    html: `<!DOCTYPE html>${cleanDocument.documentElement.outerHTML}`,
    removed
  };
}

function preprocessDocument(
  document: Document,
  removed: SanitizedDocument["removed"]
): void {
  for (const meta of document.querySelectorAll("meta[http-equiv]")) {
    meta.remove();
    removed.push({ kind: "element", name: "meta" });
  }

  for (const element of document.querySelectorAll("*")) {
    const tag = element.localName.toLowerCase();
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!isAllowedAttribute(tag, name)) {
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

      if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value, name, tag)) {
        element.removeAttribute(attribute.name);
        removed.push({ kind: "url", name });
      }
    }

    if (tag === "a") {
      secureLinkTarget(element);
    }
  }
}

function isAllowedAttribute(tag: string, name: string): boolean {
  return (
    GLOBAL_ATTRIBUTES.has(name) ||
    GALLEY_ATTRIBUTES.has(name) ||
    /^aria-[a-z0-9-]+$/.test(name) ||
    Boolean(TAG_ATTRIBUTES[tag]?.has(name))
  );
}

function secureLinkTarget(element: Element): void {
  const target = element.getAttribute("target");
  if (!target) {
    return;
  }
  const normalized = target.toLowerCase();
  if (normalized !== "_blank" && normalized !== "_self") {
    element.removeAttribute("target");
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

function isSafeUrl(value: string, attribute: string, tag: string): boolean {
  if (!value || value !== value.trim() || /[\\\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return false;
  }

  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
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

function assertStandaloneShell(html: string): void {
  const source = html.trim();
  const doctypes = matches(source, /<!doctype\b[^>]*>/gi);
  const htmlOpenings = matches(source, /<html\b[^>]*>/gi);
  const htmlClosings = matches(source, /<\/html\s*>/gi);
  const bodyOpenings = matches(source, /<body\b[^>]*>/gi);
  const bodyClosings = matches(source, /<\/body\s*>/gi);
  const headOpenings = matches(source, /<head\b[^>]*>/gi);
  const headClosings = matches(source, /<\/head\s*>/gi);

  if (
    doctypes.length !== 1 ||
    !/^<!doctype\s+html\s*>$/i.test(doctypes[0]?.[0] ?? "") ||
    htmlOpenings.length !== 1 ||
    htmlClosings.length !== 1 ||
    bodyOpenings.length !== 1 ||
    bodyClosings.length !== 1 ||
    headOpenings.length !== headClosings.length ||
    headOpenings.length > 1
  ) {
    throw new Error("Authoring HTML requires a complete standalone document shell");
  }

  const positions = [
    doctypes[0]?.index,
    htmlOpenings[0]?.index,
    bodyOpenings[0]?.index,
    bodyClosings[0]?.index,
    htmlClosings[0]?.index
  ];
  if (
    positions.some((position) => position === undefined) ||
    positions.some(
      (position, index) => index > 0 && position! <= positions[index - 1]!
    )
  ) {
    throw new Error("Authoring HTML has a malformed document body");
  }

  const headOpening = headOpenings[0];
  const headClosing = headClosings[0];
  const htmlOpening = htmlOpenings[0];
  const bodyOpening = bodyOpenings[0];
  if (
    headOpening &&
    headClosing &&
    htmlOpening &&
    bodyOpening &&
    (matchIndex(htmlOpening) >= matchIndex(headOpening) ||
      matchIndex(headOpening) >= matchIndex(headClosing) ||
      matchIndex(headClosing) >= matchIndex(bodyOpening))
  ) {
    throw new Error("Authoring HTML has a malformed document head");
  }

  const doctypeStart = doctypes[0]?.index ?? 0;
  const rootEnd =
    (htmlClosings[0]?.index ?? 0) + (htmlClosings[0]?.[0].length ?? 0);
  if (source.slice(0, doctypeStart).trim() || source.slice(rootEnd).trim()) {
    throw new Error("Authoring HTML cannot contain content outside its document");
  }
}

function matches(value: string, pattern: RegExp): RegExpMatchArray[] {
  return [...value.matchAll(pattern)];
}

function matchIndex(match: RegExpMatchArray): number {
  if (match.index === undefined) {
    throw new Error("Authoring document match is missing its source position");
  }
  return match.index;
}
