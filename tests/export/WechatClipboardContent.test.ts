import { describe, expect, it } from "vitest";

import { prepareWechatClipboardContent } from "../../src/export/WechatClipboardContent";

describe("prepareWechatClipboardContent", () => {
  it("keeps a generated WeChat fragment exactly as authored", () => {
    const fragment = [
      '<section style="max-width:677px;margin:0 auto;background:#fff">',
      '<p style="font-size:16px;line-height:1.8"><span leaf="">正文</span></p>',
      "</section>"
    ].join("\n");

    expect(prepareWechatClipboardContent(`\n${fragment}\n`)).toBe(fragment);
  });

  it("extracts the article from a complete authoring document", () => {
    const document = [
      '<!DOCTYPE html><html lang="zh-CN"><head><title>x</title></head><body>',
      '<article style="max-width:677px"><p>正文</p></article>',
      "</body></html>"
    ].join("");

    const result = prepareWechatClipboardContent(document);

    expect(result).toMatch(/^<section/u);
    expect(result).toContain("max-width: 677px");
    expect(result).toContain("<p>正文</p>");
    expect(result).not.toMatch(/<!DOCTYPE|<html|<body|<article/iu);
  });
});
