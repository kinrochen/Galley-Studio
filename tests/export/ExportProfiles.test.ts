import { describe, expect, it } from "vitest";

import {
  PortableInlineProfile,
  StandardWebProfile,
  WechatProfile
} from "../../src/export/profiles";
import { validateWechatHtml } from "../../src/export/WechatValidator";

const AUTHORING = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Galley</title><style>.lead { color: #123456; font-weight: 700; }</style><link rel="stylesheet" href="https://cdn.example/x.css"><script>alert(1)</script></head><body><article data-galley-article="true"><div class="lead" id="intro">中文正文 <strong>重点</strong></div><p style="display:grid; color:#333">第二段</p></article></body></html>`;

const INPUT = Object.freeze({
  html: AUTHORING,
  provenance: Object.freeze({
    documentId: "123e4567-e89b-42d3-a456-426614174000",
    sourceHtmlHash: "a".repeat(64)
  })
});

describe("export profiles", () => {
  it("creates a safe complete Standard Web document without mutating Authoring bytes", async () => {
    const original = INPUT.html;
    const output = await new StandardWebProfile().transform(INPUT);

    expect(INPUT.html).toBe(original);
    expect(output.profileId).toBe("standard-web");
    expect(output.html).toMatch(/^<!DOCTYPE html><html/u);
    expect(output.html).not.toMatch(/<script|<iframe|<form|<base/i);
    expect(output.html).toContain("<article");
  });

  it("inlines author CSS and removes external CSS, font, and script dependencies for Portable", async () => {
    const output = await new PortableInlineProfile().transform(INPUT);
    const document = new DOMParser().parseFromString(output.html, "text/html");
    const lead = document.querySelector(".lead");

    expect(output.profileId).toBe("portable-inline");
    expect(lead?.getAttribute("style")).toContain("color: #123456");
    expect(lead?.getAttribute("style")).toContain("font-weight: 700");
    expect(document.querySelector("style,link,script")).toBeNull();
    expect(output.html).not.toMatch(/@font-face|\.woff|\.ttf|fonts\./i);
    expect(output.html).not.toMatch(/<!DOCTYPE|<\/?(?:html|head|body)(?:\s|>)/i);
    expect(output.html).not.toMatch(/data-galley-/i);
  });

  it("creates one WeChat section with inline styles and leaf spans", async () => {
    const output = await new WechatProfile().transform(INPUT);
    const template = document.createElement("template");
    template.innerHTML = output.html;

    expect(output.profileId).toBe("wechat");
    expect(template.content.children).toHaveLength(1);
    expect(template.content.firstElementChild?.localName).toBe("section");
    expect(output.html).not.toMatch(/<!DOCTYPE|<html|<head|<body|<style|<script|<div/i);
    expect(output.html).not.toMatch(/\s(?:class|id)=/i);
    expect(output.html).toContain('<span leaf="">中文正文 </span>');
    expect(validateWechatHtml(output.html).valid).toBe(true);
  });
});
