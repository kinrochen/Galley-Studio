import { describe, expect, it } from "vitest";
import { sanitizeAuthoringDocument } from "../../src/security/AuthoringSanitizer";
import {
  recoveryDependentFragments,
  wrapBodyFragment
} from "../fixtures/htmlBoundaryCorpus";

describe("sanitizeAuthoringDocument", () => {
  it("removes executable content before rendering", () => {
    const result = sanitizeAuthoringDocument(
      "<!doctype html><html><body><p onclick='x()'>ok</p><script>alert(1)</script><a href='javascript:x()'>x</a></body></html>"
    );

    expect(result.html).not.toMatch(/script|onclick|javascript:/i);
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it("preserves the inert WeChat leaf marker while stripping executable markup", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head></head><body><section><span leaf="">中文</span><img src="javascript:alert(1)" onerror="alert(1)"></section></body></html>'
    );

    expect(result.html).toContain('<span leaf="">中文</span>');
    expect(result.html).not.toMatch(/onerror|javascript:/iu);
  });

  it("scans an ordinary script and reports its DOMPurify removal", () => {
    const result = sanitizeAuthoringDocument(
      "<!doctype html><html><head></head><body><script>alert(1)</script><p>safe</p></body></html>"
    );

    expect(result.html).toContain("<p>safe</p>");
    expect(result.html).not.toContain("<script");
    expect(result.removed).toContainEqual({
      kind: "element",
      name: "script"
    });
  });

  it("preserves semantic article content, safe styles, and Galley contracts", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>文章</title></head><body><article class="story" data-galley-role="story"><section data-galley-source="paragraph-001" data-galley-slot="content" style="color: #123; padding: 12px; position: fixed"><figure><img src="assets/封面.png" alt="封面" width="640"><figcaption><strong>说明</strong></figcaption></figure><table><tbody><tr><th>甲</th><td>乙</td></tr></tbody></table></section></article></body></html>'
    );

    expect(result.html).toContain('<html lang="zh-CN">');
    expect(result.html).toContain('data-galley-source="paragraph-001"');
    expect(result.html).toContain('data-galley-role="story"');
    expect(result.html).toContain('data-galley-slot="content"');
    expect(result.html).toContain('style="color: #123; padding: 12px"');
    expect(result.html).toContain('src="assets/封面.png"');
    expect(result.html).toContain("<figcaption><strong>说明</strong></figcaption>");
    expect(result.html).toContain("<table><tbody><tr><th>甲</th><td>乙</td></tr></tbody></table>");
    expect(result.removed).toContainEqual({
      kind: "attribute",
      name: "position"
    });
  });

  it("removes active document metadata and executable or interactive elements while keeping their article text", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head><base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example"><style>body{display:none}</style><title>Safe</title></head><body><form action="https://evil.example"><p>keep this</p><input value="secret"><button>and this</button></form><iframe srcdoc="<script>x()</script>"></iframe><object data="x"><p>fallback</p></object><embed src="x"><template><img src=x onerror=x()></template></body></html>'
    );

    expect(result.html).toContain("<title>Safe</title>");
    expect(result.html).toContain("<p>keep this</p>");
    expect(result.html).toContain("and this");
    expect(result.html).not.toMatch(
      /<base|<link|http-equiv|<style|<form|<input|<button|<iframe|<object|<embed|<template/i
    );
    expect(result.removed.map(({ kind }) => kind)).toContain("element");
  });

  it("removes unsafe URL schemes and preserves allowed link, local, resource, remote, and image-data URLs exactly", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head></head><body><a id="js" href=" \njavascript:alert(1)">bad</a><a id="vb" href="vbscript:alert(1)">bad</a><a id="file" href="file:///etc/passwd">bad</a><a id="relative" href="../notes/文章.html#段落">local</a><a id="anchor" href="#标题">anchor</a><a id="web" href="https://example.com/文章?q=1#x">web</a><a id="mail" href="mailto:a@example.com">mail</a><img id="app" src="app://local/resource?id=123"><img id="remote" src="https://cdn.example.com/封面.png"><img id="data" src="data:image/png;base64,AAAA"><img id="html-data" src="data:text/html;base64,AAAA"><video id="video" poster="data:image/webp;base64,AAAA" controls><source src="media/clip.mp4" type="video/mp4"></video></body></html>'
    );
    const parsed = new DOMParser().parseFromString(result.html, "text/html");

    expect(parsed.querySelector("#js")?.hasAttribute("href")).toBe(false);
    expect(parsed.querySelector("#vb")?.hasAttribute("href")).toBe(false);
    expect(parsed.querySelector("#file")?.hasAttribute("href")).toBe(false);
    expect(parsed.querySelector("#relative")?.getAttribute("href")).toBe(
      "../notes/文章.html#段落"
    );
    expect(parsed.querySelector("#anchor")?.getAttribute("href")).toBe("#标题");
    expect(parsed.querySelector("#web")?.getAttribute("href")).toBe(
      "https://example.com/文章?q=1#x"
    );
    expect(parsed.querySelector("#mail")?.getAttribute("href")).toBe(
      "mailto:a@example.com"
    );
    expect(parsed.querySelector("#app")?.getAttribute("src")).toBe(
      "app://local/resource?id=123"
    );
    expect(parsed.querySelector("#remote")?.getAttribute("src")).toBe(
      "https://cdn.example.com/封面.png"
    );
    expect(parsed.querySelector("#data")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(parsed.querySelector("#video")?.getAttribute("poster")).toBe(
      "data:image/webp;base64,AAAA"
    );
    expect(parsed.querySelector("#video source")?.getAttribute("src")).toBe(
      "media/clip.mp4"
    );
    expect(parsed.querySelector("#html-data")?.hasAttribute("src")).toBe(false);
    expect(result.removed.filter(({ kind }) => kind === "url").length).toBe(4);
  });

  it("allows only the three Galley data attributes and sanitizes every style attribute", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head></head><body><section data-galley-source="p-001" data-galley-role="callout" data-galley-slot="content" data-secret="no" aria-label="notice" style="font-size:16px; background-image:url(https://evil.example/x); transform:scale(2)">x</section></body></html>'
    );

    expect(result.html).toContain('data-galley-source="p-001"');
    expect(result.html).toContain('data-galley-role="callout"');
    expect(result.html).toContain('data-galley-slot="content"');
    expect(result.html).toContain('aria-label="notice"');
    expect(result.html).not.toContain("data-secret");
    expect(result.html).toContain('style="font-size: 16px"');
    expect(result.html).not.toMatch(/url\(|transform/i);
    expect(result.removed).toEqual(
      expect.arrayContaining([
        { kind: "attribute", name: "background-image" },
        { kind: "attribute", name: "transform" },
        { kind: "attribute", name: "data-secret" }
      ])
    );
  });

  it("classifies percent-decoded URL views without rewriting safe encoded paths", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head></head><body><a id="encoded-colon" href="javascript%3Aalert(1)">x</a><a id="encoded-name" href="jav%61script:alert(1)">x</a><a id="encoded-control" href="%0Ajavascript:alert(1)">x</a><a id="encoded-network" href="%2f%2fevil.example/x">x</a><img id="double-encoded" src="%252f%252fevil.example/x"><a id="malformed-encoding" href="images/bad%2">x</a><a id="too-deep" href="%252525252F%252525252Fevil.example/x">x</a><img id="safe-encoded" src="images/a%20b.png"><img id="safe-percent" src="images/100%25.png"></body></html>'
    );
    const parsed = new DOMParser().parseFromString(result.html, "text/html");

    for (const id of [
      "encoded-colon",
      "encoded-name",
      "encoded-control",
      "encoded-network",
      "malformed-encoding",
      "too-deep"
    ]) {
      expect(parsed.querySelector(`#${id}`)?.hasAttribute("href")).toBe(false);
    }
    expect(parsed.querySelector("#double-encoded")?.hasAttribute("src")).toBe(
      false
    );
    expect(parsed.querySelector("#safe-encoded")?.getAttribute("src")).toBe(
      "images/a%20b.png"
    );
    expect(parsed.querySelector("#safe-percent")?.getAttribute("src")).toBe(
      "images/100%25.png"
    );
    expect(result.removed.filter(({ kind }) => kind === "url")).toEqual([
      { kind: "url", name: "href" },
      { kind: "url", name: "href" },
      { kind: "url", name: "href" },
      { kind: "url", name: "href" },
      { kind: "url", name: "src" },
      { kind: "url", name: "href" },
      { kind: "url", name: "href" }
    ]);
  });

  it("reports invalid link targets while retaining blank-target hardening", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head></head><body><a id="top" href="#x" target="_top">top</a><a id="blank" href="#x" target="_blank" rel="external">blank</a></body></html>'
    );
    const parsed = new DOMParser().parseFromString(result.html, "text/html");

    expect(parsed.querySelector("#top")?.hasAttribute("target")).toBe(false);
    expect(result.removed).toContainEqual({
      kind: "attribute",
      name: "target"
    });
    expect(parsed.querySelector("#blank")?.getAttribute("target")).toBe(
      "_blank"
    );
    expect(parsed.querySelector("#blank")?.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["external", "noopener", "noreferrer"])
    );
  });

  it("allows fake shell markup in comments and quoted attributes", () => {
    const result = sanitizeAuthoringDocument(
      '<!doctype html><html><head><meta name="x" content="</head><body>"><!-- </head><body> --></head><body><p title="</body></html>">safe</p><!-- </body></html> --></body></html>'
    );

    expect(result.html).toContain('content="</head><body>"');
    expect(result.html).toContain('title="</body></html>"');
  });

  it.each(recoveryDependentFragments)(
    "rejects recovery-dependent $label before DOMPurify",
    ({ fragment }) => {
      expect(() =>
        sanitizeAuthoringDocument(wrapBodyFragment(fragment))
      ).toThrow(/document|doctype|body|shell|malformed|invalid/i);
    }
  );

  it.each([
    "<p>fragment</p>",
    "<!doctype html><html><head></head></html>",
    "<html><head></head><body>x</body></html>",
    "<!doctype html>OUTSIDE<html><head></head><body>x</body></html>",
    "<!doctype html><html><head></head><body>x</body>OUTSIDE</html>",
    '<!doctype html><html><head></head><body><p title="fake </body></html>',
    "<!doctype html><html><head></head><body><style>fake </body></html>",
    "<!doctype html><html><head></head><body>x<body>y</body></html>",
    "<!doctype html><html><head></head><body>x</head></body></html>",
    "<!doctype html><html><head></head><body><script><!--<script></script></body></html>",
    "<!doctype html><html><head></head><body><noscript><body>hidden</body></noscript></body></html>",
    "<!doctype html><html><head></head><!--><body>hidden</body>--><body>real</body></html>",
    "<!doctype html><html><head></head><!---><body>hidden</body>--><body>real</body></html>",
    '<!doctype html><html><head></head><body><p x=a">hidden</body></html>" ></body></html>',
    "<!doctype html><html><head></head><body><p x=a'>hidden</body></html>' ></body></html>"
  ])("rejects input without a complete standalone document shell", (html) => {
    expect(() => sanitizeAuthoringDocument(html)).toThrow(/document|doctype|body/i);
  });
});
