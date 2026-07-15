import { describe, expect, it, vi } from "vitest";

import { renderWorkbenchToolbar } from "../../src/workbench/WorkbenchToolbar";
import { initialWorkbenchState } from "../../src/workbench/WorkbenchState";

describe("WorkbenchToolbar", () => {
  it.each([
    [{ dirty: true, saving: false, conflict: false }, "Unsaved"],
    [{ dirty: true, saving: true, conflict: false }, "Saving…"],
    [{ dirty: true, saving: false, conflict: true }, "Conflict"],
    [{ dirty: false, saving: false, conflict: false }, "Saved"]
  ])("renders a deterministic save status", (patch, expected) => {
    const host = document.createElement("div");
    renderWorkbenchToolbar(host, { ...initialWorkbenchState(), ...patch }, {
      onMode: vi.fn(),
      onSave: vi.fn()
    });
    expect(host.querySelector("[data-save-status]")?.textContent).toBe(expected);
  });
});
