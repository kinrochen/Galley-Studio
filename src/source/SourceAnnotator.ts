import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export type SourceBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "table"
  | "blockquote"
  | "thematicBreak"
  | "html";

export interface SourceBlock {
  id: string;
  kind: SourceBlockKind;
  markdown: string;
  start: number;
  end: number;
}

export interface AnnotatedSource {
  original: string;
  promptMarkdown: string;
  blocks: SourceBlock[];
}

const DIRECT_KINDS = new Set<SourceBlockKind>([
  "heading",
  "paragraph",
  "list",
  "code",
  "table",
  "blockquote",
  "thematicBreak",
  "html"
]);

export function annotateMarkdown(markdown: string): AnnotatedSource {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  const counters = new Map<SourceBlockKind, number>();
  const blocks: SourceBlock[] = [];

  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error("Markdown parser omitted a top-level source position");
    }

    const kind = sourceBlockKind(node.type);
    const count = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, count);
    blocks.push({
      id: `${kind}-${String(count).padStart(3, "0")}`,
      kind,
      markdown: markdown.slice(start, end),
      start,
      end
    });
  }

  return {
    original: markdown,
    promptMarkdown: insertMarkers(markdown, blocks),
    blocks
  };
}

export function sourceMarker(blockId: string): string {
  return `<!-- galley-source:${blockId} -->`;
}

function sourceBlockKind(nodeType: string): SourceBlockKind {
  if (DIRECT_KINDS.has(nodeType as SourceBlockKind)) {
    return nodeType as SourceBlockKind;
  }

  // Definitions and future phrasing nodes still need stable source coverage.
  return "paragraph";
}

function insertMarkers(markdown: string, blocks: readonly SourceBlock[]): string {
  let cursor = 0;
  let promptMarkdown = "";

  for (const block of blocks) {
    promptMarkdown += markdown.slice(cursor, block.start);
    promptMarkdown += `${sourceMarker(block.id)}\n`;
    promptMarkdown += markdown.slice(block.start, block.end);
    cursor = block.end;
  }

  return promptMarkdown + markdown.slice(cursor);
}
