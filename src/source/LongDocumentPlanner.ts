import {
  sourceMarker,
  type AnnotatedSource,
  type SourceBlock
} from "./SourceAnnotator";

export const DEFAULT_CONTEXT_WINDOW = 128_000;

export interface DocumentBatch {
  id: string;
  blocks: SourceBlock[];
  blockIds: string[];
  promptMarkdown: string;
  estimatedTokens: number;
}

export const estimateTokens = (text: string): number =>
  Math.ceil(Array.from(text).length / 1.5);

export function shouldUseLongMode(
  estimated: number,
  contextWindow: number
): boolean {
  return estimated > Math.floor(contextWindow * 0.85);
}

export function planDocumentBatches(
  source: AnnotatedSource,
  budget: number
): DocumentBatch[] {
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("Document batches require a positive response budget");
  }

  for (const block of source.blocks) {
    if (estimateTokens(renderBlocks(source, [block])) > budget) {
      throw new Error(
        `Source block ${block.id} exceeds the response budget and cannot be split`
      );
    }
  }

  const batches: SourceBlock[][] = [];
  let pending: SourceBlock[] = [];

  const flush = (): void => {
    if (pending.length > 0) {
      batches.push(pending);
      pending = [];
    }
  };

  for (const section of sectionsAtLevelTwoHeadings(source.blocks)) {
    const candidate = [...pending, ...section];
    if (estimateTokens(renderBlocks(source, candidate)) <= budget) {
      pending = candidate;
      continue;
    }

    flush();
    if (estimateTokens(renderBlocks(source, section)) <= budget) {
      pending = [...section];
      continue;
    }

    for (const block of section) {
      const blockCandidate = [...pending, block];
      if (estimateTokens(renderBlocks(source, blockCandidate)) > budget) {
        flush();
      }
      pending.push(block);
    }
  }
  flush();

  return batches.map((blocks, index) => {
    const promptMarkdown = renderBlocks(source, blocks);
    return {
      id: `batch-${String(index + 1).padStart(3, "0")}`,
      blocks: [...blocks],
      blockIds: blocks.map((block) => block.id),
      promptMarkdown,
      estimatedTokens: estimateTokens(promptMarkdown)
    };
  });
}

function sectionsAtLevelTwoHeadings(
  blocks: readonly SourceBlock[]
): SourceBlock[][] {
  const sections: SourceBlock[][] = [];
  let section: SourceBlock[] = [];

  for (const block of blocks) {
    if (section.length > 0 && isLevelTwoHeading(block)) {
      sections.push(section);
      section = [];
    }
    section.push(block);
  }

  if (section.length > 0) {
    sections.push(section);
  }
  return sections;
}

function isLevelTwoHeading(block: SourceBlock): boolean {
  if (block.kind !== "heading") {
    return false;
  }

  if (/^ {0,3}##(?!#)(?:[\t ]+|$)/.test(block.markdown)) {
    return true;
  }

  const lines = block.markdown.split(/\r?\n/);
  return lines.length > 1 && /^ {0,3}-+[\t ]*$/.test(lines.at(-1) ?? "");
}

function renderBlocks(
  source: AnnotatedSource,
  blocks: readonly SourceBlock[]
): string {
  const first = blocks[0];
  if (!first) {
    return "";
  }

  let markdown = "";
  let cursor = first.start;
  for (const block of blocks) {
    markdown += source.original.slice(cursor, block.start);
    markdown += `${sourceMarker(block.id)}\n`;
    markdown += source.original.slice(block.start, block.end);
    cursor = block.end;
  }
  return markdown;
}
