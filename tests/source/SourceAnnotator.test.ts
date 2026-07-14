import { describe, expect, it } from "vitest";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";

describe("annotateMarkdown", () => {
  it("assigns stable markers to every top-level Markdown block", () => {
    const result = annotateMarkdown(
      "# Title\n\nIntro.\n\n- one\n- two\n\n![alt](img.png)"
    );

    expect(result.blocks.map((block) => [block.id, block.kind])).toEqual([
      ["heading-001", "heading"],
      ["paragraph-001", "paragraph"],
      ["list-001", "list"],
      ["paragraph-002", "paragraph"]
    ]);
    expect(result.promptMarkdown).toContain(
      "<!-- galley-source:heading-001 -->"
    );
    expect(result.promptMarkdown).toContain(
      "<!-- galley-source:list-001 -->"
    );
  });

  it("does not mutate fenced code contents", () => {
    const source = "```ts\nconst x = '<!-- galley-source:p -->';\n```";

    expect(annotateMarkdown(source).blocks[0]?.markdown).toBe(source);
  });

  it("uses exact source offsets and keeps a GFM table as one block", () => {
    const source =
      "# 标题\r\n\r\n| A | B |\r\n| - | - |\r\n| 😀 | two |\r\n\r\n> Quote";
    const result = annotateMarkdown(source);

    expect(result.blocks.map(({ id, kind }) => [id, kind])).toEqual([
      ["heading-001", "heading"],
      ["table-001", "table"],
      ["blockquote-001", "blockquote"]
    ]);
    for (const block of result.blocks) {
      expect(source.slice(block.start, block.end)).toBe(block.markdown);
    }
    expect(result.blocks[1]?.markdown).toBe(
      "| A | B |\r\n| - | - |\r\n| 😀 | two |"
    );
  });

  it("preserves all original Markdown and assigns counters per kind", () => {
    const source = "Before\n\n---\n\nAfter\n";
    const result = annotateMarkdown(source);

    expect(result.original).toBe(source);
    expect(result.blocks.map((block) => block.id)).toEqual([
      "paragraph-001",
      "thematicBreak-001",
      "paragraph-002"
    ]);
    expect(
      result.promptMarkdown.replace(
        /<!-- galley-source:[a-zA-Z]+-\d+ -->\n/g,
        ""
      )
    ).toBe(source);
  });

  it("returns an empty annotation for empty Markdown", () => {
    expect(annotateMarkdown("")).toEqual({
      original: "",
      promptMarkdown: "",
      blocks: []
    });
  });
});
