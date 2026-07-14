import { describe, expect, it } from "vitest";
import { HUGERTE_VALID_ELEMENTS } from "../../src/security/AuthoringSanitizer";

const EXPECTED_EDITOR_TAGS = [
  "main", "article", "section", "header", "footer", "aside", "nav", "div",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "em",
  "b", "i", "u", "s", "small", "mark", "sub", "sup", "br", "hr", "ul",
  "ol", "li", "dl", "dt", "dd", "blockquote", "pre", "code", "kbd",
  "figure", "figcaption", "picture", "img", "a", "table", "caption",
  "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td", "time",
  "abbr", "cite", "q", "video", "audio", "source"
];

const EXPECTED_GLOBAL_ATTRIBUTES = [
  "class", "dir", "id", "lang", "role", "style", "title", "aria-*",
  "data-galley-source", "data-galley-role", "data-galley-slot"
];

const EXPECTED_TAG_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "rel", "target"],
  audio: ["controls", "muted", "preload", "src"],
  blockquote: ["cite"],
  col: ["span"],
  img: ["alt", "decoding", "height", "loading", "src", "width"],
  li: ["value"],
  ol: ["reversed", "start", "type"],
  q: ["cite"],
  source: ["media", "src", "type"],
  td: ["colspan", "headers", "rowspan"],
  th: ["abbr", "colspan", "headers", "rowspan", "scope"],
  time: ["datetime"],
  video: ["controls", "height", "muted", "poster", "preload", "src", "width"]
};

function parsePolicy(policy: string): {
  globals: string[];
  tags: Map<string, string[]>;
} {
  const parts = policy.split(",");
  const globalMatch = /^@\[([^\]]*)\]$/u.exec(parts.shift() ?? "");
  if (!globalMatch) throw new Error("Missing global HugeRTE policy rule");
  const tags = new Map<string, string[]>();
  for (const part of parts) {
    const match = /^([a-z0-9]+)(?:\[([^\]]*)\])?$/u.exec(part);
    if (!match?.[1]) throw new Error(`Invalid HugeRTE policy rule: ${part}`);
    tags.set(match[1], match[2] ? match[2].split("|") : []);
  }
  return { globals: globalMatch[1]!.split("|"), tags };
}

describe("HugeRTE authoring policy", () => {
  it("is generated from the exact sanitizer body tag and attribute policy", () => {
    const policy = parsePolicy(HUGERTE_VALID_ELEMENTS);

    expect([...policy.tags.keys()]).toEqual(EXPECTED_EDITOR_TAGS);
    expect(policy.globals).toEqual(EXPECTED_GLOBAL_ATTRIBUTES);
    expect(Object.fromEntries([...policy.tags].filter(([, attrs]) => attrs.length > 0)))
      .toEqual(EXPECTED_TAG_ATTRIBUTES);
  });

  it("keeps Galley provenance and the sanitizer-approved ARIA family", () => {
    const policy = parsePolicy(HUGERTE_VALID_ELEMENTS);

    expect(policy.globals).toEqual(expect.arrayContaining([
      "aria-*",
      "data-galley-source",
      "data-galley-role",
      "data-galley-slot"
    ]));
  });

  it("excludes document-shell, executable, foreign, form, event, and arbitrary data policy", () => {
    const policy = parsePolicy(HUGERTE_VALID_ELEMENTS);
    const forbiddenTags = [
      "html", "head", "body", "title", "meta", "script", "style", "link",
      "iframe", "object", "embed", "form", "input", "button", "textarea",
      "select", "svg", "math"
    ];

    for (const tag of forbiddenTags) expect(policy.tags.has(tag), tag).toBe(false);
    expect(HUGERTE_VALID_ELEMENTS).not.toMatch(/(?:^|[|\[,])on[a-z]+(?:[|\],]|$)/u);
    expect(policy.globals).not.toContain("data-*");
    expect(HUGERTE_VALID_ELEMENTS).not.toContain("data-mce-*");
  });
});
