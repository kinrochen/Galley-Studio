import type {
  SourceBlock,
  SourceBlockKind
} from "../source/SourceAnnotator";

export interface LengthPrefixedMarkdown {
  markdown: string;
  markdownLength: number;
}

export interface LengthPrefixedHtml {
  html: string;
  htmlLength: number;
}

export interface PromptSourceBlock {
  id: string;
  kind: SourceBlockKind;
  markdown: string;
  markdownLength: number;
}

export function lengthPrefixedMarkdown(
  markdown: string
): LengthPrefixedMarkdown {
  return { markdown, markdownLength: markdown.length };
}

export function lengthPrefixedHtml(html: string): LengthPrefixedHtml {
  return { html, htmlLength: html.length };
}

export function promptSourceBlock(block: SourceBlock): PromptSourceBlock {
  return {
    id: block.id,
    kind: block.kind,
    markdown: block.markdown,
    markdownLength: block.markdown.length
  };
}

export function safeCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2).replace(
    /[<>&\u2028\u2029]/g,
    (character) => {
      switch (character) {
        case "<":
          return "\\u003c";
        case ">":
          return "\\u003e";
        case "&":
          return "\\u0026";
        case "\u2028":
          return "\\u2028";
        default:
          return "\\u2029";
      }
    }
  );
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Prompt payload numbers must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object") {
    throw new Error("Prompt payload contains a non-JSON value");
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Prompt payload objects must be plain records");
  }

  const record = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) {
      throw new Error("Prompt payload fields must not be undefined");
    }
    canonical[key] = canonicalize(item);
  }
  return canonical;
}
