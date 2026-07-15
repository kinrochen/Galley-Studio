import { describe, expect, it, vi } from "vitest";
import { EditorResourceResolver } from "../../src/editor/EditorResourceResolver";

describe("EditorResourceResolver", () => {
  it("rewrites canonical vault resources for display and restores exact originals", () => {
    const resourceUrl = vi.fn((path: string) => `app://vault/${encodeURI(path)}`);
    const resolver = new EditorResourceResolver(resourceUrl);
    const authoring = [
      '<figure><img src="assets/封面 image.png" alt="cover"></figure>',
      '<p><a href="notes/reference.md">local</a></p>',
      '<p><a href="https://example.com/read">external</a></p>'
    ].join("");

    const display = resolver.rewriteForDisplay(authoring);

    expect(display).toContain('src="app://vault/assets/%E5%B0%81%E9%9D%A2%20image.png"');
    expect(display).toContain('data-galley-original-src="assets/封面 image.png"');
    expect(display).toContain('href="app://vault/notes/reference.md"');
    expect(display).toContain('data-galley-original-href="notes/reference.md"');
    expect(display).toContain('href="https://example.com/read"');
    expect(resourceUrl).toHaveBeenCalledTimes(2);

    expect(resolver.restoreForSave(display)).toBe(authoring);
  });

  it("never trusts pre-existing markers or writes absolute system paths", () => {
    const resolver = new EditorResourceResolver((path) => `app://vault/${path}`);
    const hostile = [
      '<img src="app://vault/safe.png" data-galley-original-src="/Users/alice/secret.png">',
      '<a href="file:///Volumes/private/note.md" data-galley-original-href="../escape.md">bad</a>',
      '<img src="C:\\Users\\alice\\secret.png">',
      '<img src="/Volumes/private/secret.png">'
    ].join("");

    const restored = resolver.restoreForSave(hostile);

    expect(restored).not.toMatch(/data-galley-original/iu);
    expect(restored).not.toMatch(/(?:file:|\/Users\/|\/Volumes\/|[a-z]:\\)/iu);
    expect(restored).toBe("<img><a>bad</a><img><img>");
  });

  it("is idempotent and leaves fragments, data URLs, and web URLs untouched", () => {
    const resolver = new EditorResourceResolver((path) => `app://vault/${path}`);
    const html = [
      '<a href="#section">jump</a>',
      '<img src="data:image/png;base64,AA==">',
      '<img src="https://cdn.example/image.png">'
    ].join("");

    const once = resolver.rewriteForDisplay(html);
    expect(resolver.rewriteForDisplay(once)).toBe(once);
    expect(resolver.restoreForSave(once)).toBe(html);
  });
});
