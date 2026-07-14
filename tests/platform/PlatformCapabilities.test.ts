import { describe, expect, it } from "vitest";
import { derivePlatformCapabilities } from "../../src/platform/PlatformCapabilities";

describe("derivePlatformCapabilities", () => {
  it("allows full desktop features", () => {
    expect(derivePlatformCapabilities(false)).toEqual({
      canGenerate: true,
      canEdit: true,
      canImportSkill: true,
      canPreview: true
    });
  });

  it("limits mobile to preview", () => {
    expect(derivePlatformCapabilities(true)).toEqual({
      canGenerate: false,
      canEdit: false,
      canImportSkill: false,
      canPreview: true
    });
  });
});
