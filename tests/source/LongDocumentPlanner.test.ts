import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  planDocumentBatches,
  shouldUseLongMode
} from "../../src/source/LongDocumentPlanner";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import { makeLongDocumentMarkdown } from "../support/generationFixtures";

describe("long-document estimation", () => {
  it("estimates Unicode code points using the specified ratio", () => {
    expect(estimateTokens("a😀中")).toBe(2);
  });

  it("enters long mode only above the floored 85 percent threshold", () => {
    expect(shouldUseLongMode(108_800, 128_000)).toBe(false);
    expect(shouldUseLongMode(108_801, 128_000)).toBe(true);
  });
});

describe("planDocumentBatches", () => {
  it("keeps ten heading sections ordered without missing or duplicate IDs", () => {
    const source = annotateMarkdown(makeLongDocumentMarkdown(10));
    const batches = planDocumentBatches(source, 70);
    const plannedIds = batches.flatMap((batch) =>
      batch.blocks.map((block) => block.id)
    );

    expect(plannedIds).toEqual(source.blocks.map((block) => block.id));
    expect(new Set(plannedIds).size).toBe(source.blocks.length);
    expect(batches.every((batch) => batch.estimatedTokens <= 70)).toBe(true);
    expect(
      batches.slice(1).every((batch) =>
        batch.blocks[0]?.markdown.startsWith("## ")
      )
    ).toBe(true);
  });

  it("starts a new batch rather than crossing a level-two heading budget", () => {
    const source = annotateMarkdown(
      "# Title\n\nPreamble.\n\n## One\n\nFirst section.\n\n## Two\n\nSecond section."
    );
    const firstSection = source.blocks.slice(0, 4);
    const firstSectionCost = estimateTokens(
      firstSection
        .map(
          (block) =>
            `<!-- galley-source:${block.id} -->\n${block.markdown}`
        )
        .join("\n\n")
    );
    const batches = planDocumentBatches(source, firstSectionCost);

    expect(batches.map((batch) => batch.blocks.map((block) => block.id))).toEqual([
      ["heading-001", "paragraph-001", "heading-002", "paragraph-002"],
      ["heading-003", "paragraph-003"]
    ]);
  });

  it.each(["list", "code", "table"] as const)(
    "never splits an oversized %s block",
    (kind) => {
      const markdownByKind = {
        list: "- one long item that cannot fit",
        code: "```txt\none long line that cannot fit\n```",
        table: "| one long cell |\n| --- |\n| cannot fit |"
      };
      const source = annotateMarkdown(markdownByKind[kind]);

      expect(() => planDocumentBatches(source, 1)).toThrow(
        new RegExp(`${kind}-001.*response budget`, "i")
      );
    }
  );

  it("rejects a non-positive response budget", () => {
    expect(() => planDocumentBatches(annotateMarkdown("text"), 0)).toThrow(
      /positive response budget/i
    );
  });
});
