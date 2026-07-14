import { describe, expect, it } from "vitest";
import type {
  AnnotatedSource,
  SourceBlock
} from "../../src/source/SourceAnnotator";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";

describe("validateSourceCoverage", () => {
  it("accepts every expected marker exactly once in source order", () => {
    expect(
      validateSourceCoverage(
        sourceWithIds(["heading-001", "paragraph-001", "list-001"]),
        documentWithMarkers([
          "heading-001",
          "paragraph-001",
          "list-001"
        ])
      )
    ).toEqual([]);
  });

  it("supports the plan-level exact-ID interface", () => {
    expect(
      validateSourceCoverage(
        ["heading-001", "paragraph-001"],
        documentWithMarkers(["heading-001", "paragraph-001"])
      )
    ).toEqual([]);
  });

  it("reports one missing issue for each absent expected source block", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001", "list-001"]),
      documentWithMarkers(["heading-001"])
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "source_missing",
        severity: "error",
        sourceId: "paragraph-001"
      }),
      expect.objectContaining({
        code: "source_missing",
        severity: "error",
        sourceId: "list-001"
      }),
      expect.objectContaining({
        code: "source_order",
        severity: "error"
      })
    ]);
  });

  it("reports one duplicate issue per duplicated marker ID", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001", "list-001"]),
      documentWithMarkers([
        "heading-001",
        "paragraph-001",
        "paragraph-001",
        "list-001",
        "list-001"
      ])
    );

    expect(issues.map(({ code, sourceId }) => [code, sourceId])).toEqual([
      ["source_duplicate", "paragraph-001"],
      ["source_duplicate", "list-001"]
    ]);
  });

  it("reports one order issue when the de-duplicated DOM sequence is reordered", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001", "list-001"]),
      documentWithMarkers([
        "heading-001",
        "list-001",
        "paragraph-001"
      ])
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "source_order",
        severity: "error"
      })
    ]);
  });

  it("reports invented marker IDs and includes their source IDs", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001"]),
      documentWithMarkers([
        "heading-001",
        "invented-001",
        "paragraph-001"
      ])
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "source_unexpected",
        severity: "error",
        sourceId: "invented-001"
      }),
      expect.objectContaining({
        code: "source_order",
        severity: "error"
      })
    ]);
  });

  it("reports an empty marker value without omitting its sourceId field", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001"]),
      documentWithMarkers(["heading-001", "", "paragraph-001"])
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "source_invalid",
        severity: "error",
        sourceId: ""
      }),
      expect.objectContaining({
        code: "source_order",
        severity: "error"
      })
    ]);
    expect(issues[0]).toHaveProperty("sourceId", "");
  });

  it("reports missing, duplicate, and reordered markers deterministically", () => {
    const source = sourceWithIds([
      "heading-001",
      "paragraph-001",
      "list-001"
    ]);
    const html = documentWithMarkers([
      "heading-001",
      "list-001",
      "list-001"
    ]);

    const first = validateSourceCoverage(source, html);
    const second = validateSourceCoverage(source, html);

    expect(first.map(({ code }) => code)).toEqual([
      "source_missing",
      "source_duplicate",
      "source_order"
    ]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("treats adversarial marker values as opaque DOM attributes", () => {
    const adversarialId = `quote'\"] [onclick] \\ slash > marker`;

    expect(
      validateSourceCoverage(
        sourceWithIds([adversarialId]),
        documentWithMarkers([adversarialId])
      )
    ).toEqual([]);
  });

  it("returns deterministic issues rather than throwing for malformed HTML", () => {
    const source = sourceWithIds(["paragraph-001"]);

    expect(() => validateSourceCoverage(source, "\u0000<broken")).not.toThrow();
    expect(JSON.stringify(validateSourceCoverage(source, "\u0000<broken"))).toBe(
      JSON.stringify(validateSourceCoverage(source, "\u0000<broken"))
    );
  });
});

function sourceWithIds(ids: readonly string[]): AnnotatedSource {
  const blocks: SourceBlock[] = ids.map((id, index) => ({
    id,
    kind: "paragraph",
    markdown: `Block ${index + 1}`,
    start: index,
    end: index + 1
  }));
  return {
    original: blocks.map(({ markdown }) => markdown).join("\n\n"),
    promptMarkdown: blocks.map(({ markdown }) => markdown).join("\n\n"),
    blocks
  };
}

function documentWithMarkers(markers: readonly string[]): string {
  const document = new DOMParser().parseFromString(
    "<!DOCTYPE html><html><head></head><body><article></article></body></html>",
    "text/html"
  );
  const article = document.querySelector("article");
  if (!article) {
    throw new Error("Test document is missing its article element");
  }
  for (const marker of markers) {
    const block = document.createElement("p");
    block.setAttribute("data-galley-source", marker);
    block.textContent = marker || "empty marker";
    article.append(block);
  }
  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}
