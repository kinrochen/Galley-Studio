import { describe, expect, it } from "vitest";
import { sanitizeInlineStyle } from "../../src/security/InlineStyleSanitizer";

describe("sanitizeInlineStyle", () => {
  it("preserves named article declarations and safe gradients", () => {
    const result = sanitizeInlineStyle(
      "color: #123; font-size: 18px; padding: 1rem 2rem; border-left: 3px solid rgb(1, 2, 3); border-radius: 8px; box-shadow: 0 1px 3px #0003; display: flex; align-items: center; text-align: center; overflow-wrap: anywhere; background: linear-gradient(90deg, #fff, rgba(0,0,0,.2))"
    );

    expect(result.removed).toEqual([]);
    expect(result.style).toContain("font-size: 18px");
    expect(result.style).toContain("display: flex");
    expect(result.style).toContain(
      "background: linear-gradient(90deg, #fff, rgba(0,0,0,.2))"
    );
  });

  it("removes executable, remote, custom, overlay, motion, filter, float, and grid declarations", () => {
    const result = sanitizeInlineStyle(
      "color:red; background:url(https://evil.example/x); background-image:image-set(url(x) 1x); width:expression(alert(1)); --payload:url(x); color:var(--payload); behavior:url(x); -moz-binding:url(x); animation:spin 1s; transition:all 1s; transform:scale(2); filter:blur(2px); position:fixed; float:left; display:grid; grid-template-columns:1fr"
    );

    expect(result.style).toBe("color: red");
    expect(result.removed).toEqual(
      expect.arrayContaining([
        "background",
        "background-image",
        "width",
        "--payload",
        "color",
        "behavior",
        "-moz-binding",
        "animation",
        "transition",
        "transform",
        "filter",
        "position",
        "float",
        "display",
        "grid-template-columns"
      ])
    );
  });

  it("parses quoted semicolons as one declaration", () => {
    const result = sanitizeInlineStyle(
      'font-family: "A; B", sans-serif; color: rgb(1, 2, 3)'
    );

    expect(result).toEqual({
      style: 'font-family: "A; B", sans-serif; color: rgb(1, 2, 3)',
      removed: []
    });
  });

  it.each([
    ["missing colon", "color red; font-size: 12px"],
    ["unterminated string", 'font-family: "broken; color: red'],
    ["unterminated function", "color:rgb(1, 2, 3"],
    ["unsafe escape", "width:e\\78 pression(alert(1)); color:red"],
    ["comment obfuscation", "width:exp/**/ression(alert(1)); color:red"],
    ["at-rule", "@import 'https://evil.example/x'; color:red"]
  ])("reports and removes a malformed declaration with %s", (_label, style) => {
    const result = sanitizeInlineStyle(style);

    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.style).not.toMatch(/expression|@import|broken|\\78/i);
  });

  it("allows only non-overlay positioning and approved display values", () => {
    expect(
      sanitizeInlineStyle(
        "position:relative; display:inline-block; position:absolute; display:none"
      )
    ).toEqual({
      style: "position: relative; display: inline-block",
      removed: ["position", "display"]
    });
  });
});
