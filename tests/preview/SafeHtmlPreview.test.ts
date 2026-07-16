import { describe, expect, it } from "vitest";

import { createSafePreviewFrame } from "../../src/preview/SafeHtmlPreview";

describe("createSafePreviewFrame", () => {
  it("renders a scriptless document in an empty sandbox with restrictive metadata", () => {
    const host = document.createElement("div");
    const frame = createSafePreviewFrame(
      host,
      "<!DOCTYPE html><html lang='zh-CN'><head><title>x</title></head><body><p onclick='steal()'>Safe</p><script>steal()</script></body></html>"
    );

    expect(host.firstElementChild).toBe(frame);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).not.toContain("<script");
    expect(frame.srcdoc).not.toContain("onclick");
    expect(frame.srcdoc).toContain("Content-Security-Policy");
    expect(frame.srcdoc).toContain("Safe");
    expect(frame.srcdoc).toContain("html,body{min-height:100%;background:#fff}");
  });

  it("replaces existing preview children and never keeps a second live frame", () => {
    const host = document.createElement("div");
    createSafePreviewFrame(host, validHtml("one"));
    const second = createSafePreviewFrame(host, validHtml("two"));
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(second);
    expect(second.srcdoc).toContain("two");
  });

  it("wraps generated HTML fragments in a safe preview document", () => {
    const host = document.createElement("div");
    const frame = createSafePreviewFrame(
      host,
      '<section style="color: #dc2626"><p>fragment preview</p></section>'
    );

    expect(frame.srcdoc).toMatch(/^<!DOCTYPE html><html/);
    expect(frame.srcdoc).toContain("<body><section");
    expect(frame.srcdoc).toContain("fragment preview");
    expect(frame.srcdoc).toContain("color: #dc2626");
  });
});

function validHtml(text: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>x</title></head><body><p>${text}</p></body></html>`;
}
