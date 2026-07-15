import { describe, expect, it, vi } from "vitest";

import {
  extractDocumentOutline,
  renderDocumentOutline
} from "../../src/workbench/DocumentOutline";

describe("DocumentOutline", () => {
  it("extracts rendered headings with source IDs in document order", () => {
    expect(
      extractDocumentOutline(
        "<article><h2 data-galley-source='heading-002'>Part <em>one</em></h2><h3>Ignored</h3><h1 data-galley-source='heading-001'>Title</h1></article>"
      )
    ).toEqual([
      { level: 2, sourceId: "heading-002", label: "Part one" },
      { level: 1, sourceId: "heading-001", label: "Title" }
    ]);
  });

  it("routes an outline click without changing content", () => {
    const host = document.createElement("div");
    const select = vi.fn();
    renderDocumentOutline(host, [
      { level: 2, sourceId: "heading-002", label: "Part" }
    ], select);
    (host.querySelector("button") as HTMLButtonElement).click();
    expect(select).toHaveBeenCalledWith("heading-002");
  });
});
