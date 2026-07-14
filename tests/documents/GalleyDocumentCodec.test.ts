import { describe, expect, it } from "vitest";
import {
  GalleyDocumentCodec,
  type GalleyDocument
} from "../../src/documents/GalleyDocumentCodec";
import { recoveryDependentFragments } from "../fixtures/htmlBoundaryCorpus";

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

  it("allows fake shell strings in fragment attributes, comments, and encoded text", () => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: "en",
      headHtml:
        '<meta name="x" content="</head><body>"><!-- </head><body> --><title>&lt;/head&gt;</title>',
      bodyHtml:
        '<p title="</body></html>">&lt;/body&gt;</p><!-- </body></html> -->'
    };

    const serialized = GalleyDocumentCodec.serialize(document);
    const roundTrip = GalleyDocumentCodec.parse(serialized);

    expect(roundTrip).toEqual(document);
  });

  it("normalizes shell-looking RCDATA text without treating it as document markup", () => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: "en",
      headHtml: "<title>safe &lt;/head&gt;&lt;body&gt;</title>",
      bodyHtml: "<article>body</article>"
    };

    const roundTrip = GalleyDocumentCodec.parse(
      GalleyDocumentCodec.serialize(document)
    );

    expect(roundTrip.headHtml).toBe(
      "<title>safe &lt;/head&gt;&lt;body&gt;</title>"
    );
    expect(roundTrip.bodyHtml).toBe("<article>body</article>");
  });

  it.each(recoveryDependentFragments)(
    "rejects recovery-dependent $label during fragment serialization",
    ({ fragment }) => {
      const document: GalleyDocument = {
        doctype: "<!DOCTYPE html>",
        lang: "en",
        headHtml: "<title>safe</title>",
        bodyHtml: fragment
      };

      expect(() => GalleyDocumentCodec.serialize(document)).toThrow(
        /fragment|shell|context|comment|raw|malformed|invalid|control|namespace|foreign/i
      );
    }
  );

  it("rejects head content that migrates into the body on document reparse", () => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: "en",
      headHtml: "<p>migrates</p><title>x</title>",
      bodyHtml: "<article>body</article>"
    };

    expect(() => GalleyDocumentCodec.serialize(document)).toThrow(
      /head|round.?trip|context/i
    );
  });

  it.each([
    ["head plaintext", "<plaintext>consume", "<article>body</article>"],
    ["body plaintext", "<title>x</title>", "<plaintext>consume"],
    ["unclosed head raw text", "<title>consume", "<article>body</article>"],
    ["unclosed body raw text", "<title>x</title>", "<script>consume"]
  ])("rejects %s during serialization", (_label, headHtml, bodyHtml) => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: "en",
      headHtml,
      bodyHtml
    };

    expect(() => GalleyDocumentCodec.serialize(document)).toThrow(
      /fragment|raw|round.?trip|shell|unterminated/i
    );
  });

  it.each([
    ["an abrupt comment close", "<!--><body>HIDDEN</body>-->"],
    ["a bang comment close", "<!--x--!><body>HIDDEN</body>-->"],
    [
      "a double quote in an unquoted attribute",
      '<p x=a">HIDDEN</body></html>" >'
    ],
    [
      "a single quote in an unquoted attribute",
      "<p x=a'>HIDDEN</body></html>' >"
    ]
  ])("rejects shell markup concealed by %s in a body fragment", (_label, bodyHtml) => {
    const document: GalleyDocument = {
      doctype: "<!DOCTYPE html>",
      lang: "en",
      headHtml: "<title>x</title>",
      bodyHtml
    };

    expect(() => GalleyDocumentCodec.serialize(document)).toThrow(
      /fragment|shell|context|comment/i
    );
  });

  it.each([
    "<article>fragment</article>",
    "<html><head></head><body>x</body></html>",
    "<!doctype html><head></head><body>x</body>",
    "<!doctype html><html><body>x</body></html>",
    "<!doctype html><html><head></head></html>",
    "<!doctype html><html><head></head><body>x</body></html><html><head></head><body>y</body></html>",
    "<!doctype html>OUTSIDE<html><head></head><body>x</body></html>",
    "<!doctype html><html><head></head><body>x</body>OUTSIDE</html>",
    '<!doctype html><html><head></head><body><p title="fake </body></html>',
    "<!doctype html><html><head></head><body><script>fake </body></html>",
    "<!doctype html><html><head></head><body>x<body>y</body></html>",
    "<!doctype html><html><head></head><body>x</head></body></html>",
    "<!doctype html><html><head></head><body><script><!--<script></script></body></html>",
    "<!doctype html><html><head></head><body><noscript><body>hidden</body></noscript></body></html>",
    "<!doctype html><html><head></head><!--><body>hidden</body>--><body>real</body></html>",
    '<!doctype html><html><head></head><body><p x=a">hidden</body></html>" ></body></html>'
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
