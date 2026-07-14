import { describe, expect, it } from "vitest";
import {
  GalleyDocumentCodec,
  type GalleyDocument
} from "../../src/documents/GalleyDocumentCodec";

describe("GalleyDocumentCodec", () => {
  it("parses and deterministically serializes the independent document shell", () => {
    const input =
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>文章</title></head><body><article data-galley-role="story"><h1 data-galley-source="heading-001" style="color:#123">标题</h1></article></body></html>';

    const document = GalleyDocumentCodec.parse(input);

    expect(document).toEqual({
      doctype: "<!DOCTYPE html>",
      lang: "zh-CN",
      headHtml:
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>文章</title>',
      bodyHtml:
        '<article data-galley-role="story"><h1 data-galley-source="heading-001" style="color:#123">标题</h1></article>'
    });
    expect(GalleyDocumentCodec.serialize(document)).toBe(
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>文章</title></head><body><article data-galley-role="story"><h1 data-galley-source="heading-001" style="color:#123">标题</h1></article></body></html>'
    );
  });

  it("canonicalizes parsed markup without coupling it to Markdown", () => {
    const once = GalleyDocumentCodec.serialize(
      GalleyDocumentCodec.parse(
        "<!DOCTYPE HTML><HTML lang='en'><HEAD><TITLE>x</TITLE></HEAD><BODY><P>body</P></BODY></HTML>"
      )
    );

    expect(GalleyDocumentCodec.serialize(GalleyDocumentCodec.parse(once))).toBe(
      once
    );
    expect(once).not.toContain("markdown");
  });

  it.each([
    "<article>fragment</article>",
    "<html><head></head><body>x</body></html>",
    "<!doctype html><head></head><body>x</body>",
    "<!doctype html><html><body>x</body></html>",
    "<!doctype html><html><head></head></html>",
    "<!doctype html><html><head></head><body>x</body></html><html><head></head><body>y</body></html>"
  ])("rejects a missing, malformed, or repeated shell: %s", (html) => {
    expect(() => GalleyDocumentCodec.parse(html)).toThrow(/document|doctype|shell/i);
  });

  it("rejects data that could escape a serialized language attribute", () => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: 'en\" onclick="alert(1)',
      headHtml: "<title>x</title>",
      bodyHtml: "<article>x</article>"
    };

    expect(() => GalleyDocumentCodec.serialize(document)).toThrow(/language/i);
  });
});
