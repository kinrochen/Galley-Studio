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

  it.each(["html", "head", "body"] as const)(
    "does not count an expected marker placed on %s outside the article",
    (location) => {
      const issues = validateSourceCoverage(
        sourceWithIds(["paragraph-001"]),
        documentWithLayout({
          outside: [{ location, sourceId: "paragraph-001" }]
        })
      );

      expect(issues.map(({ code, sourceId }) => [code, sourceId])).toEqual([
        ["source_outside_article", "paragraph-001"],
        ["source_missing", "paragraph-001"],
        ["source_order", undefined]
      ]);
    }
  );

  it("does not count a marker placed on the article root itself", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["paragraph-001"]),
      documentWithLayout({ articleSourceId: "paragraph-001" })
    );

    expect(issues.map(({ code, sourceId }) => [code, sourceId])).toEqual([
      ["source_article_marker", "paragraph-001"],
      ["source_missing", "paragraph-001"],
      ["source_order", undefined]
    ]);
  });

  it("reports every expected block missing from an empty article", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["heading-001", "paragraph-001"]),
      documentWithLayout({})
    );

    expect(issues.map(({ code, sourceId }) => [code, sourceId])).toEqual([
      ["source_missing", "heading-001"],
      ["source_missing", "paragraph-001"],
      ["source_order", undefined]
    ]);
  });

  it("rejects an outside copy without treating it as an in-article duplicate", () => {
    const issues = validateSourceCoverage(
      sourceWithIds(["paragraph-001"]),
      documentWithLayout({
        outside: [{ location: "head", sourceId: "paragraph-001" }],
        inside: ["paragraph-001"]
      })
    );

    expect(issues.map(({ code, sourceId }) => [code, sourceId])).toEqual([
      ["source_outside_article", "paragraph-001"]
    ]);
  });

  it("fails closed and keeps source diagnostics when the article root is invalid", () => {
    const html = documentWithLayout({
      inside: ["paragraph-001"],
      invalidRoot: true
    });

    expect(() =>
      validateSourceCoverage(sourceWithIds(["paragraph-001"]), html)
    ).not.toThrow();
    expect(
      validateSourceCoverage(
        sourceWithIds(["paragraph-001"]),
        html
      ).map(({ code, sourceId }) => [code, sourceId])
    ).toEqual([
      ["source_article_root", undefined],
      ["source_outside_article", "paragraph-001"],
      ["source_missing", "paragraph-001"],
      ["source_order", undefined]
    ]);
  });

  it("keeps article-boundary diagnostics in byte-identical DOM order", () => {
    const source = sourceWithIds(["heading-001", "paragraph-001"]);
    const html = documentWithLayout({
      articleSourceId: "article-root",
      outside: [
        { location: "html", sourceId: "outside-html" },
        { location: "head", sourceId: "outside-head" },
        { location: "body", sourceId: "" }
      ],
      inside: ["heading-001", "heading-001", "invented-001"]
    });

    const first = validateSourceCoverage(source, html);
    const second = validateSourceCoverage(source, html);

    expect(first.map(({ code, sourceId }) => [code, sourceId])).toEqual([
      ["source_article_marker", "article-root"],
      ["source_outside_article", "outside-html"],
      ["source_outside_article", "outside-head"],
      ["source_outside_article", ""],
      ["source_missing", "paragraph-001"],
      ["source_duplicate", "heading-001"],
      ["source_unexpected", "invented-001"],
      ["source_order", undefined]
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
  return documentWithLayout({ inside: markers });
}

type MarkerLocation = "html" | "head" | "body";

interface DocumentLayout {
  articleSourceId?: string;
  inside?: readonly string[];
  invalidRoot?: boolean;
  outside?: ReadonlyArray<{
    location: MarkerLocation;
    sourceId: string;
  }>;
}

function documentWithLayout(layout: DocumentLayout): string {
  const document = new DOMParser().parseFromString(
    "<!DOCTYPE html><html><head></head><body><article></article></body></html>",
    "text/html"
  );
  const article = document.querySelector("article");
  if (!article) {
    throw new Error("Test document is missing its article element");
  }
  if (layout.articleSourceId !== undefined) {
    article.setAttribute("data-galley-source", layout.articleSourceId);
  }
  for (const marker of layout.inside ?? []) {
    const block = document.createElement("p");
    block.setAttribute("data-galley-source", marker);
    block.textContent = marker || "empty marker";
    article.append(block);
  }
  for (const { location, sourceId } of layout.outside ?? []) {
    document
      .querySelector(location)
      ?.setAttribute("data-galley-source", sourceId);
  }
  if (layout.invalidRoot) {
    const main = document.createElement("main");
    main.append(...article.childNodes);
    article.replaceWith(main);
  }
  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}
