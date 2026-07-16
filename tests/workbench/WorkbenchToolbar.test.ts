import { describe, expect, it, vi } from "vitest";

import { renderWorkbenchToolbar } from "../../src/workbench/WorkbenchToolbar";
import { initialWorkbenchState } from "../../src/workbench/WorkbenchState";

describe("WorkbenchToolbar", () => {
  it("labels the visual authoring mode as Edit", () => {
    const host = document.createElement("div");
    renderWorkbenchToolbar(host, initialWorkbenchState(), {
      onMode: vi.fn(),
      onCopy: vi.fn(),
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
      onCopy: vi.fn(),
      onSave: vi.fn()
    });
    const status = host.querySelector("[data-save-status]");
    expect(status?.textContent).toBe(expected);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });
});
