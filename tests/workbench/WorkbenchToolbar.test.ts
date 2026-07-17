import { describe, expect, it, vi } from "vitest";

import { renderWorkbenchToolbar } from "../../src/workbench/WorkbenchToolbar";
import { initialWorkbenchState } from "../../src/workbench/WorkbenchState";

describe("WorkbenchToolbar", () => {
  it("labels the visual authoring mode as Edit", () => {
    const host = document.createElement("div");
    renderWorkbenchToolbar(host, initialWorkbenchState(), {
      onMode: vi.fn(),
      onCopyWechat: vi.fn(),
      onCopySource: vi.fn(),
      onSave: vi.fn()
    });

    expect(
      [...host.querySelectorAll("[data-mode]")].map(
        (button) => button.textContent
      )
    ).toEqual(["Preview", "Edit", "Source"]);
  });

  it.each([
    [{ dirty: true, saving: false, conflict: false }, "Unsaved"],
    [{ dirty: true, saving: true, conflict: false }, "Saving…"],
    [{ dirty: true, saving: false, conflict: true }, "Conflict"],
    [{ dirty: false, saving: false, conflict: false }, "Saved"]
  ])("renders a deterministic save status", (patch, expected) => {
    const host = document.createElement("div");
    renderWorkbenchToolbar(host, { ...initialWorkbenchState(), ...patch }, {
      onMode: vi.fn(),
      onCopyWechat: vi.fn(),
      onCopySource: vi.fn(),
      onSave: vi.fn()
    });
    const status = host.querySelector("[data-save-status]");
    expect(status?.textContent).toBe(expected);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("offers a WeChat rich-text copy separately from source copy", () => {
    const host = document.createElement("div");
    const onCopyWechat = vi.fn();
    const onCopySource = vi.fn();
    renderWorkbenchToolbar(host, {
      ...initialWorkbenchState(),
      documentPath: "article.html"
    }, {
      onMode: vi.fn(),
      onCopyWechat,
      onCopySource,
      onSave: vi.fn()
    });

    const wechat = host.querySelector<HTMLButtonElement>(
      '[data-action="copy-wechat"]'
    );
    const source = host.querySelector<HTMLButtonElement>(
      '[data-action="copy-source"]'
    );
    expect(wechat?.textContent).toBe("Copy for WeChat");
    expect(source?.textContent).toBe("Copy source");
    wechat?.click();
    source?.click();
    expect(onCopyWechat).toHaveBeenCalledOnce();
    expect(onCopySource).toHaveBeenCalledOnce();
  });
});
