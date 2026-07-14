import { describe, expect, it } from "vitest";
import type { SanitizedDocument } from "../../src/security/AuthoringSanitizer";
import type {
  AnnotatedSource,
  SourceBlock
} from "../../src/source/SourceAnnotator";
import { validateAuthoringContract } from "../../src/validation/AuthoringContractValidator";
import { validateAuthoringDocument } from "../../src/validation/DocumentValidator";
import { validateSecurity } from "../../src/validation/SecurityValidator";

describe("validateSecurity", () => {
  it("inspects sanitized HTML structurally as well as its removal log", () => {
    const document = sanitized(
      validHtml().replace(
        '<p data-galley-source="paragraph-001">Body</p>',
        '<p data-galley-source="paragraph-001" onclick="x()" style="position: fixed">Body</p><a href="javascript:x()">bad URL</a><script>alert(1)</script>'
      )
    );

    const issues = validateSecurity(document);

    expect(issues.map(({ code }) => code)).toEqual([
      "unsafe_content_present",
      "unsafe_content_present",
      "unsafe_content_present",
      "unsafe_content_present"
    ]);
    expect(issues.map(({ message }) => message)).toEqual([
      expect.stringContaining("onclick"),
      expect.stringContaining("position"),
      expect.stringContaining("href"),
      expect.stringContaining("script")
    ]);
  });

  it("turns unsafe sanitizer removals into actionable de-duplicated errors", () => {
    const issues = validateSecurity([
      { kind: "element", name: "script" },
      { kind: "element", name: "script" },
      { kind: "element", name: "form" },
      { kind: "attribute", name: "onclick" },
      { kind: "url", name: "href" },
      { kind: "attribute", name: "background-image" },
      { kind: "attribute", name: "target" },
      { kind: "attribute", name: "data-secret" }
    ]);

    expect(issues).toHaveLength(5);
    expect(issues.every(({ code }) => code === "unsafe_content_removed")).toBe(
      true
    );
    expect(issues.map(({ message }) => message)).toEqual([
      expect.stringContaining("script"),
      expect.stringContaining("form"),
      expect.stringContaining("onclick"),
      expect.stringContaining("href"),
      expect.stringContaining("background-image")
    ]);
  });

  it("does not treat blank-target hardening or benign attribute normalization as unsafe content", () => {
    expect(
      validateSecurity([
        { kind: "attribute", name: "target" },
        { kind: "attribute", name: "data-secret" }
      ])
    ).toEqual([]);
  });
});

describe("validateAuthoringContract", () => {
  it("accepts the complete Authoring document contract", () => {
    expect(validateAuthoringContract(validHtml())).toEqual([]);
  });

  it.each([
    [
      "missing doctype",
      () => validHtml().replace("<!DOCTYPE html>", ""),
      "document_doctype"
    ],
    [
      "invalid doctype",
      () => validHtml().replace("<!DOCTYPE html>", "<!DOCTYPE svg>"),
      "document_doctype"
    ],
    [
      "missing html root",
      () =>
        validHtml()
          .replace('<html lang="en">', "")
          .replace("</html>", ""),
      "document_html"
    ],
    [
      "missing explicit head",
      () =>
        validHtml().replace(
          '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Article</title></head>',
          ""
        ),
      "document_head"
    ],
    [
      "missing explicit body",
      () => validHtml().replace("<body>", "").replace("</body>", ""),
      "document_body"
    ],
    [
      "missing title",
      () => validHtml().replace("<title>Article</title>", ""),
      "document_title"
    ],
    [
      "empty title",
      () => validHtml().replace("<title>Article</title>", "<title> </title>"),
      "document_title"
    ],
    [
      "missing charset",
      () => validHtml().replace('<meta charset="utf-8">', ""),
      "document_charset"
    ],
    [
      "non-UTF-8 charset",
      () => validHtml().replace('charset="utf-8"', 'charset="gbk"'),
      "document_charset"
    ],
    [
      "missing viewport",
      () =>
        validHtml().replace(
          '<meta name="viewport" content="width=device-width, initial-scale=1">',
          ""
        ),
      "document_viewport"
    ],
    [
      "empty viewport",
      () =>
        validHtml().replace(
          'content="width=device-width, initial-scale=1"',
          'content=""'
        ),
      "document_viewport"
    ],
    [
      "missing article root",
      () => validHtml().replace(/article/g, "main"),
      "document_article_root"
    ]
  ])("reports %s independently", (_label, makeHtml, expectedCode) => {
    const issues = validateAuthoringContract(makeHtml());

    expect(issues.map(({ code }) => code)).toContain(expectedCode);
    expect(issues.find(({ code }) => code === expectedCode)?.severity).toBe(
      "error"
    );
  });

  it("requires exactly one article as the sole Authoring content root under body", () => {
    const nested = validHtml()
      .replace("<body><article>", "<body><main><article>")
      .replace("</article></body>", "</article></main></body>");
    const sibling = validHtml().replace(
      "</article></body>",
      "</article><aside>outside the root</aside></body>"
    );

    expect(validateAuthoringContract(nested).map(({ code }) => code)).toContain(
      "document_article_root"
    );
    expect(validateAuthoringContract(sibling).map(({ code }) => code)).toContain(
      "document_article_root"
    );
  });

  it("rejects stylesheet links and non-inline style blocks", () => {
    const html = validHtml().replace(
      "<title>Article</title>",
      '<title>Article</title><link rel="stylesheet" href="theme.css"><style>article { color: red; }</style>'
    );
    const issues = validateAuthoringContract(html);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "document_styles_inline",
        severity: "error",
        selector: expect.stringContaining("style")
      })
    );
  });

  it("returns a deterministic shell issue rather than throwing on malformed input", () => {
    const html = "\u0000<!DOCTYPE html><html><head><title>x</title></head><body>";

    expect(() => validateAuthoringContract(html)).not.toThrow();
    const first = validateAuthoringContract(html);
    const second = validateAuthoringContract(html);
    expect(first.some(({ severity }) => severity === "error")).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("validateAuthoringDocument", () => {
  it("returns the exact empty valid report for a complete document and source", () => {
    expect(
      validateAuthoringDocument({
        source: validSource(),
        document: sanitized(validHtml())
      })
    ).toEqual({ valid: true, issues: [] });
  });

  it("composes security, contract, then source coverage issues in fixed order", () => {
    const html = validHtml()
      .replace("<title>Article</title>", "<title> </title>")
      .replace(
        '<p data-galley-source="paragraph-001">Body</p>',
        ""
      );
    const report = validateAuthoringDocument({
      source: validSource(),
      document: sanitized(html, [{ kind: "element", name: "script" }])
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map(({ code }) => code)).toEqual([
      "unsafe_content_removed",
      "document_title",
      "source_missing",
      "source_order"
    ]);
  });

  it("produces byte-identical JSON on repeated validation", () => {
    const input = {
      source: validSource(),
      document: sanitized(
        validHtml().replace("<title>Article</title>", "<title></title>"),
        [
          { kind: "url" as const, name: "href" },
          { kind: "element" as const, name: "script" }
        ]
      )
    };

    expect(JSON.stringify(validateAuthoringDocument(input))).toBe(
      JSON.stringify(validateAuthoringDocument(input))
    );
  });

  it("does not mutate the input source, HTML, or sanitizer removal log", () => {
    const source = deepFreeze(validSource());
    const document = deepFreeze(
      sanitized(validHtml(), [
        { kind: "attribute" as const, name: "onclick" }
      ])
    );
    const before = JSON.stringify({ source, document });

    validateAuthoringDocument({ source, document });

    expect(JSON.stringify({ source, document })).toBe(before);
  });

  it("returns a deterministic invalid report instead of throwing for malformed input", () => {
    const input = {
      source: validSource(),
      document: sanitized("\u0000<not-a-document")
    };

    expect(() => validateAuthoringDocument(input)).not.toThrow();
    const first = validateAuthoringDocument(input);
    const second = validateAuthoringDocument(input);
    expect(first.valid).toBe(false);
    expect(first.issues.some(({ severity }) => severity === "error")).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

function validSource(): AnnotatedSource {
  return sourceWithIds(["heading-001", "paragraph-001"]);
}

function sourceWithIds(ids: readonly string[]): AnnotatedSource {
  const blocks: SourceBlock[] = ids.map((id, index) => ({
    id,
    kind: index === 0 ? "heading" : "paragraph",
    markdown: index === 0 ? "# Article" : "Body",
    start: index * 2,
    end: index * 2 + 1
  }));
  return {
    original: "# Article\n\nBody",
    promptMarkdown: "<!-- galley-source:heading-001 -->\n# Article\n\n<!-- galley-source:paragraph-001 -->\nBody",
    blocks
  };
}

function validHtml(): string {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Article</title></head><body><article><h1 data-galley-source="heading-001">Article</h1><p data-galley-source="paragraph-001">Body</p></article></body></html>';
}

function sanitized(
  html: string,
  removed: SanitizedDocument["removed"] = []
): SanitizedDocument {
  return { html, removed };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
