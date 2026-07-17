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

  it("resolves dot-relative resources against the HTML document folder", () => {
    const resourceUrl = vi.fn((path: string) => `app://vault/${encodeURI(path)}`);
    const resolver = new EditorResourceResolver(resourceUrl);
    const authoring = [
      '<img src="./images/本地图片.png" alt="local">',
      '<img src="../shared/cover.png" alt="shared">'
    ].join("");

    const display = resolver.rewriteForDisplay(
      authoring,
      "个人知识库/文章/Galley Studio.html"
    );

    expect(display).toContain(
      'src="app://vault/%E4%B8%AA%E4%BA%BA%E7%9F%A5%E8%AF%86%E5%BA%93/%E6%96%87%E7%AB%A0/images/%E6%9C%AC%E5%9C%B0%E5%9B%BE%E7%89%87.png"'
    );
    expect(display).toContain(
      'data-galley-original-src="./images/本地图片.png"'
    );
    expect(display).toContain(
      'src="app://vault/%E4%B8%AA%E4%BA%BA%E7%9F%A5%E8%AF%86%E5%BA%93/shared/cover.png"'
    );
    expect(resolver.restoreForSave(
      display,
      "个人知识库/文章/Galley Studio.html"
    )).toBe(authoring);
  });

  it("rejects a relative resource that escapes above the vault root", () => {
    const resourceUrl = vi.fn((path: string) => `app://vault/${path}`);
    const resolver = new EditorResourceResolver(resourceUrl);
    const authoring = '<img src="../../private.png">';

    expect(resolver.rewriteForDisplay(authoring, "notes/article.html")).toBe(
      authoring
    );
    expect(resourceUrl).not.toHaveBeenCalled();
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

  it("retires a stale display marker when an editor replaces it with an allowed authoring URL", () => {
    const resolver = new EditorResourceResolver((path) => `app://vault/${path}`);
    const edited = [
      '<a href="notes/new.md" data-galley-original-href="notes/old.md">local</a>',
      '<a href="#heading" data-galley-original-href="notes/old.md">anchor</a>',
      '<a href="notes/new.md?mode=read#heading" data-galley-original-href="notes/old.md">local anchor</a>',
      '<a href="https://example.com/new" data-galley-original-href="notes/old.md">web</a>',
      '<img src="assets/new.png" data-galley-original-src="assets/old.png">',
      '<img src="https://cdn.example/new.png" data-galley-original-src="assets/old.png">'
    ].join("");

    expect(resolver.restoreForSave(edited)).toBe([
      '<a href="notes/new.md">local</a>',
      '<a href="#heading">anchor</a>',
      '<a href="notes/new.md?mode=read#heading">local anchor</a>',
      '<a href="https://example.com/new">web</a>',
      '<img src="assets/new.png">',
      '<img src="https://cdn.example/new.png">'
    ].join(""));
  });

  it("fails closed when a stale or forged marker is paired with another runtime URL", () => {
    const resolver = new EditorResourceResolver((path) => `app://vault/${path}`);

    expect(resolver.restoreForSave([
      '<a href="app://vault/notes/new.md" data-galley-original-href="notes/old.md">runtime</a>',
      '<img src="file:///tmp/new.png" data-galley-original-src="assets/old.png">'
    ].join(""))).toBe("<a>runtime</a><img>");
  });

  it("rejects unsafe replacements even when an old marker looks valid", () => {
    const resolver = new EditorResourceResolver((path) => `app://vault/${path}`);
    const restored = resolver.restoreForSave([
      '<a href="//evil.example/x" data-galley-original-href="notes/old.md">protocol relative</a>',
      '<a href="javascript:alert(1)" data-galley-original-href="notes/old.md">script</a>',
      '<a href="/Users/alice/private" data-galley-original-href="notes/old.md">system</a>'
    ].join(""));

    expect(restored).toBe("<a>protocol relative</a><a>script</a><a>system</a>");
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
