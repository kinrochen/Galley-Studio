import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPORT_CONFIGURATIONS } from "../../src/export/ExportConfiguration";
import {
  renderExportPanel,
  type ExportPanelState
} from "../../src/workbench/ExportPanel";

describe("ExportPanel", () => {
  it("offers three reusable profile configurations without assuming one publishing target", async () => {
    const host = document.createElement("div");
    const onExport = vi.fn();
    const onCopy = vi.fn();
    const onSave = vi.fn();
    renderExportPanel(host, state(), DEFAULT_EXPORT_CONFIGURATIONS, {
      onSelect: vi.fn(), onExport, onCopy, onSave
    });

    expect([...host.querySelectorAll("select[data-export-configuration] option")].map((item) => item.textContent))
      .toEqual(["Standard web", "Portable inline", "WeChat editor"]);
    expect([...host.querySelectorAll("select[data-export-profile] option")].map((item) => item.textContent))
      .toEqual(["Standard web", "Portable inline", "WeChat editor"]);
    expect(host.textContent).toContain("Export configuration");

    (host.querySelector("button[data-export-action=export]") as HTMLButtonElement).click();
    (host.querySelector("button[data-export-action=copy]") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledWith("standard-web");
    expect(onCopy).toHaveBeenCalledWith("standard-web");

    const name = host.querySelector("input[data-export-field=name]") as HTMLInputElement;
    name.value = "Client handoff";
    (host.querySelector("button[data-export-action=save-config]") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: "standard-web",
      name: "Client handoff",
      profileId: "standard-web"
    }));
  });

  it.each([
    ["exporting", "Exporting…"],
    ["copying", "Copying…"],
    ["success", "Exported"],
    ["copied", "Copied"],
    ["error", "Export failed"]
  ] as const)("renders explicit %s status", (status, text) => {
    const host = document.createElement("div");
    renderExportPanel(host, { ...state(), status, message: text }, DEFAULT_EXPORT_CONFIGURATIONS, {
      onSelect: vi.fn(), onExport: vi.fn(), onCopy: vi.fn(), onSave: vi.fn()
    });
    expect(host.querySelector("[data-export-status]")?.textContent).toContain(text);
  });

  it("contains rejected async button actions after the panel reports them", async () => {
    const host = document.createElement("div");
    const onExport = vi.fn(async () => { throw new Error("shown by owner"); });
    renderExportPanel(host, state(), DEFAULT_EXPORT_CONFIGURATIONS, {
      onSelect: vi.fn(), onExport, onCopy: vi.fn(), onSave: vi.fn()
    });

    expect(() => (host.querySelector("button[data-export-action=export]") as HTMLButtonElement).click())
      .not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("routes real synchronous form validation failures to an explicit owner error", async () => {
    const host = document.createElement("div");
    const onSave = vi.fn();
    const onValidationError = vi.fn();
    renderExportPanel(host, state(), DEFAULT_EXPORT_CONFIGURATIONS, {
      onSelect: vi.fn(),
      onExport: vi.fn(),
      onCopy: vi.fn(),
      onSave,
      onValidationError
    });
    const folder = host.querySelector(
      "input[data-export-field=output-folder]"
    ) as HTMLInputElement;
    folder.value = "../outside";

    expect(() => (
      host.querySelector("button[data-export-action=save-config]") as HTMLButtonElement
    ).click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSave).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith(
      "Export configuration is invalid"
    );
  });
});

function state(): ExportPanelState {
  return { selectedId: "standard-web", status: "idle", message: "Ready" };
}
