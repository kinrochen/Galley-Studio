import { describe, expect, it } from "vitest";
import { ThemeComponentCatalog } from "../../src/editor/ThemeComponentCatalog";

describe("ThemeComponentCatalog", () => {
  it("keeps the first sanitized template for each current-theme role", () => {
    const catalog = ThemeComponentCatalog.fromDocument([
      '<blockquote data-galley-role="quote" style="border-left:3px solid #111"><span>first</span></blockquote>',
      '<aside data-galley-role="quote" style="color:red">second</aside>',
      '<section data-galley-role="callout"><p data-galley-slot="content">slot</p></section>'
    ].join(""));

    expect(catalog.roles()).toEqual(["callout", "quote"]);
    expect(catalog.template("quote")?.outerHTML).toContain("border-left:3px solid #111");
    expect(catalog.template("quote")?.outerHTML).not.toContain("color:red");
    expect(catalog.has("callout")).toBe(true);
  });

  it("returns detached clones and ignores malformed roles", () => {
    const catalog = ThemeComponentCatalog.fromDocument([
      '<p data-galley-role="valid-role">one</p>',
      '<p data-galley-role="Bad Role">two</p>',
      '<p data-galley-role="../quote">three</p>'
    ].join(""));
    const first = catalog.template("valid-role")!;
    first.textContent = "mutated";

    expect(catalog.template("valid-role")?.textContent).toBe("one");
    expect(catalog.roles()).toEqual(["valid-role"]);
    expect(catalog.template("missing")).toBeNull();
  });
});
