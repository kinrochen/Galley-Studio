import { describe, expect, it } from "vitest";
import {
  ComponentTransformError,
  transformSelectedBlock
} from "../../src/editor/ComponentTransformer";
import { ThemeComponentCatalog } from "../../src/editor/ThemeComponentCatalog";

describe("transformSelectedBlock", () => {
  it("reuses the current-theme template while preserving content and source ID", () => {
    const catalog = ThemeComponentCatalog.fromDocument(
      '<blockquote data-galley-role="quote" style="border-left:3px solid #111"><span data-galley-slot="content">sample</span><footer>theme footer</footer></blockquote>'
    );

    const result = transformSelectedBlock(
      '<p data-galley-source="paragraph-003">Keep <strong>this</strong></p>',
      "quote",
      catalog
    );

    expect(result).toContain('data-galley-role="quote"');
    expect(result).toContain('data-galley-source="paragraph-003"');
    expect(result).toContain("Keep <strong>this</strong>");
    expect(result).toContain("theme footer");
    expect(result).toContain("border-left:3px solid #111");
    expect(result).not.toContain("sample");
  });

  it("uses the role root as the content slot when no explicit slot exists", () => {
    const catalog = ThemeComponentCatalog.fromDocument(
      '<aside data-galley-role="note" style="background:#eee"><p>sample</p></aside>'
    );

    expect(
      transformSelectedBlock(
        '<section data-galley-source="paragraph-004"><em>selected</em></section>',
        "note",
        catalog
      )
    ).toBe(
      '<aside data-galley-role="note" style="background:#eee" data-galley-source="paragraph-004"><em>selected</em></aside>'
    );
  });

  it("rejects missing roles, ambiguous slots, and non-single-root selections", () => {
    const missing = ThemeComponentCatalog.fromDocument(
      '<p data-galley-role="paragraph">sample</p>'
    );
    const ambiguous = ThemeComponentCatalog.fromDocument(
      '<section data-galley-role="card"><p data-galley-slot="content">a</p><p data-galley-slot="content">b</p></section>'
    );

    expect(() =>
      transformSelectedBlock('<p data-galley-source="paragraph-003">x</p>', "quote", missing)
    ).toThrow(ComponentTransformError);
    expect(() =>
      transformSelectedBlock('<p data-galley-source="paragraph-003">x</p>', "card", ambiguous)
    ).toThrow(expect.objectContaining({ code: "component_slot_ambiguous" }));
    expect(() =>
      transformSelectedBlock("<p>one</p><p>two</p>", "paragraph", missing)
    ).toThrow(expect.objectContaining({ code: "component_selection_invalid" }));
  });

  it("does not mutate element inputs or catalog templates", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p data-galley-source="paragraph-008">original</p>';
    const selected = host.firstElementChild as HTMLElement;
    const catalog = ThemeComponentCatalog.fromDocument(
      '<aside data-galley-role="note"><span data-galley-slot="content">sample</span></aside>'
    );
    const beforeSelected = selected.outerHTML;
    const beforeTemplate = catalog.template("note")!.outerHTML;

    transformSelectedBlock(selected, "note", catalog);

    expect(selected.outerHTML).toBe(beforeSelected);
    expect(catalog.template("note")!.outerHTML).toBe(beforeTemplate);
  });
});
