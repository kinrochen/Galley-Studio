import { describe, expect, it } from "vitest";
import { extractHtmlDocument } from "../../src/generation/HtmlResponseExtractor";

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

  it.each([
    ["prose only", "Here is an article, but it is not HTML."],
    ["a fragment", "<article><p>fragment</p></article>"],
    ["no doctype", "<html><head></head><body>x</body></html>"],
    ["no html root", "<!doctype html><head></head><body>x</body>"],
    ["no body", "<!doctype html><html><head></head></html>"],
    ["unclosed root", "<!doctype html><html><head></head><body>x</body>"],
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
    ]
  ])("rejects %s", (_label, value) => {
    expect(() => extractHtmlDocument(value)).toThrow(/complete|single|fence/i);
  });
});
