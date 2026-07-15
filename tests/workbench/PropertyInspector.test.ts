import { describe, expect, it, vi } from "vitest";

import {
  applyElementProperty,
  renderPropertyInspector
} from "../../src/workbench/PropertyInspector";

describe("PropertyInspector", () => {
  it("applies safe paragraph alignment, colors, and spacing", () => {
    const document = new DOMParser().parseFromString(
      "<p data-galley-source='p-1'>Text</p>",
      "text/html"
    );
    const paragraph = document.body.firstElementChild as HTMLElement;
    applyElementProperty(paragraph, { type: "alignment", value: "center" });
    applyElementProperty(paragraph, { type: "text-color", value: "#123456" });
    applyElementProperty(paragraph, { type: "spacing", value: 18 });
    expect(paragraph.style.textAlign).toBe("center");
    expect(paragraph.style.color).toBe("rgb(18, 52, 86)");
    expect(paragraph.style.marginBlockEnd).toBe("18px");
    expect(() =>
      applyElementProperty(paragraph, { type: "text-color", value: "url(javascript:x)" })
    ).toThrow();
  });

  it("edits image and link metadata without accepting unsafe links", () => {
    const document = new DOMParser().parseFromString(
      "<figure><img src='images/a.png'><figcaption>old</figcaption></figure><a href='https://example.com'>link</a>",
      "text/html"
    );
    const image = document.querySelector("img") as HTMLImageElement;
    const link = document.querySelector("a") as HTMLAnchorElement;
    applyElementProperty(image, { type: "image-alt", value: "Diagram" });
    applyElementProperty(image, { type: "image-caption", value: "New caption" });
    applyElementProperty(link, { type: "link-url", value: "notes/local.html" });
    applyElementProperty(link, { type: "link-title", value: "Read" });
    expect(image.alt).toBe("Diagram");
    expect(document.querySelector("figcaption")?.textContent).toBe("New caption");
    expect(link.getAttribute("href")).toBe("notes/local.html");
    expect(link.title).toBe("Read");
    expect(() =>
      applyElementProperty(link, { type: "link-url", value: "javascript:steal()" })
    ).toThrow();
  });

  it("renders role choices and disables roles missing from the current theme", () => {
    const host = document.createElement("div");
    const onChange = vi.fn();
    renderPropertyInspector(host, null, ["quote", "callout"], onChange);
    const role = host.querySelector("select[data-control='role']") as HTMLSelectElement;
    expect([...role.options].map((option) => option.value)).toEqual(["", "quote", "callout"]);
    expect(role.disabled).toBe(false);
  });

  it("exposes paragraph, image, link, and table controls for the selected content", () => {
    const host = document.createElement("div");
    const documentWithContent = new DOMParser().parseFromString(
      "<figure><img src='images/a.png'><figcaption>caption</figcaption><a href='notes/a.md'>link</a><table><tbody><tr><td>x</td></tr></tbody></table></figure>",
      "text/html"
    );
    const selected = documentWithContent.body.firstElementChild as HTMLElement;
    renderPropertyInspector(host, selected, ["figure"], vi.fn());

    expect(host.querySelector("[data-control='spacing']")).not.toBeNull();
    expect(host.querySelector("[data-control='image-alt']")).not.toBeNull();
    expect(host.querySelector("[data-control='image-caption']")).not.toBeNull();
    expect(host.querySelector("[data-control='image-alignment']")).not.toBeNull();
    expect(host.querySelector("[data-control='link-url']")).not.toBeNull();
    expect(host.querySelector("[data-control='link-title']")).not.toBeNull();
    expect(host.querySelector("[data-control='table-row-add']")).not.toBeNull();
    expect(host.querySelector("[data-control='table-row-remove']")).not.toBeNull();
    expect(host.querySelector("[data-control='table-column-add']")).not.toBeNull();
    expect(host.querySelector("[data-control='table-column-remove']")).not.toBeNull();
  });

  it("handles elements selected from an iframe realm", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument!;
    inner.body.innerHTML = "<figure><img src='images/a.png'></figure><table><tbody><tr><td>x</td></tr></tbody></table>";
    const image = inner.querySelector("img") as unknown as HTMLElement;
    const table = inner.querySelector("table") as unknown as HTMLElement;

    applyElementProperty(image, { type: "image-alt", value: "Cross realm" });
    applyElementProperty(table, { type: "table-column", value: "add" });

    expect(inner.querySelector("img")?.getAttribute("alt")).toBe("Cross realm");
    expect(inner.querySelectorAll("td")).toHaveLength(2);
    frame.remove();
  });
});
