import { describe, expect, it } from "vitest";
import { extractHtmlDocument } from "../../src/generation/HtmlResponseExtractor";
import {
  recoveryDependentFragments,
  wrapBodyFragment
} from "../fixtures/htmlBoundaryCorpus";

describe("extractHtmlDocument", () => {
  it("extracts one fenced full document without keeping prose", () => {
    const text =
      "Here is the result:\n```html\n<!doctype html><html><body><p>x</p></body></html>\n```";

    expect(extractHtmlDocument(text)).toBe(
      "<!doctype html><html><body><p>x</p></body></html>"
    );
  });

  it("isolates one raw document while preserving its bytes", () => {
    const html =
      '<!DOCTYPE html><html lang="zh-CN"><head><title>文章</title></head><body><article>正文</article></body></html>';

    expect(extractHtmlDocument(`Result follows:\n${html}\nEnd.`)).toBe(html);
  });

  it("ignores fake shell markup in surrounding comments and quoted attributes", () => {
    const html = "<!doctype html><html><body><p>x</p></body></html>";
    const response =
      '<!-- fake <html><body></body></html> --><span title="<html></html>">prose</span>' +
      html;

    expect(extractHtmlDocument(response)).toBe(html);
  });

  it("keeps ordinary script text before its exact closing tag", () => {
    const html =
      "<!doctype html><html><body><script>alert(1)</script><p>x</p></body></html>";

    expect(extractHtmlDocument(html)).toBe(html);
  });

  it("keeps entity-encoded less-than text outside raw tokenizer substates", () => {
    const html =
      "<!doctype html><html><body><title>&lt;/body&gt;</title><p>x</p></body></html>";

    expect(extractHtmlDocument(html)).toBe(html);
  });

  it.each(recoveryDependentFragments)(
    "rejects recovery-dependent $label",
    ({ fragment }) => {
      expect(() => extractHtmlDocument(wrapBodyFragment(fragment))).toThrow(
        /complete|single|fence|shell|invalid|malformed/i
      );
    }
  );

  it.each([
    ["prose only", "Here is an article, but it is not HTML."],
    ["a fragment", "<article><p>fragment</p></article>"],
    ["no doctype", "<html><head></head><body>x</body></html>"],
    ["no html root", "<!doctype html><head></head><body>x</body>"],
    ["no body", "<!doctype html><html><head></head></html>"],
    ["unclosed root", "<!doctype html><html><head></head><body>x</body>"],
    [
      "text between the doctype and root",
      "<!doctype html>OUTSIDE<html><body>x</body></html>"
    ],
    [
      "text after the body but inside the root",
      "<!doctype html><html><body>x</body>OUTSIDE</html>"
    ],
    [
      "an unterminated quoted attribute containing fake shell closings",
      '<!doctype html><html><body><p title="fake </body></html>'
    ],
    [
      "two documents",
      "<!doctype html><html><body>one</body></html>\n<!doctype html><html><body>two</body></html>"
    ],
    [
      "two fenced candidates",
      "```html\n<!doctype html><html><body>one</body></html>\n```\n```html\n<!doctype html><html><body>two</body></html>\n```"
    ],
    [
      "a raw document beside a fenced candidate",
      "<!doctype html><html><body>outside</body></html>\n```html\n<!doctype html><html><body>inside</body></html>\n```"
    ],
    [
      "an unlabeled fence",
      "```\n<!doctype html><html><body>x</body></html>\n```"
    ],
    [
      "an unclosed fence",
      "```html\n<!doctype html><html><body>x</body></html>"
    ],
    [
      "invalid shell text inside a fence",
      "```html\n<!doctype html>OUTSIDE<html><body>x</body></html>\n```"
    ],
    [
      "a duplicate body start tag",
      "<!doctype html><html><body>one<body>two</body></html>"
    ],
    [
      "a stray shell end tag",
      "<!doctype html><html><body>x</head></body></html>"
    ],
    [
      "a script double-escape sequence that consumes the apparent shell",
      "<!doctype html><html><head></head><body><script><!--<script></script></body></html>"
    ],
    [
      "shell tags hidden by scripting-disabled noscript handling",
      "<!doctype html><html><head></head><body><noscript><body>hidden</body></noscript></body></html>"
    ],
    [
      "shell tags after an abruptly closed comment",
      "<!doctype html><html><head></head><!--><body>hidden</body>--><body>real</body></html>"
    ],
    [
      "shell tags after a bang-closed comment",
      "<!doctype html><html><head></head><!--x--!><body>hidden</body>--><body>real</body></html>"
    ],
    [
      "shell tags concealed by a quote in an unquoted attribute value",
      '<!doctype html><html><head></head><body><p x=a">hidden</body></html>" ></body></html>'
    ],
    [
      "shell tags concealed by a single quote in an unquoted attribute value",
      "<!doctype html><html><head></head><body><p x=a'>hidden</body></html>' ></body></html>"
    ]
  ])("rejects %s", (_label, value) => {
    expect(() => extractHtmlDocument(value)).toThrow(/complete|single|fence/i);
  });

  it.each(["script", "style", "title", "textarea", "plaintext"])(
    "rejects an unclosed %s element that consumes shell closings",
    (tag) => {
      const html = `<!doctype html><html><body><${tag}>fake </body></html>`;

      expect(() => extractHtmlDocument(html)).toThrow(/complete|shell|unterminated/i);
    }
  );
});
