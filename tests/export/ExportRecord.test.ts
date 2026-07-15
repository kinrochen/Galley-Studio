import { describe, expect, it } from "vitest";

import { GalleyExportRecordV1Schema } from "../../src/export/ExportRecord";

const VALID = {
  id: "423e4567-e89b-42d3-a456-426614174000",
  configurationId: "wechat",
  profileId: "wechat",
  path: "exports/article.wechat.html",
  exportedAt: "2026-07-15T02:03:04.000Z",
  sourceHtmlHash: "a".repeat(64),
  outputHash: "b".repeat(64),
  repairRounds: 2,
  skillFiles: ["SKILL.md", "references/theme-index.md", "assets/profiles/wechat.md"]
};

describe("GalleyExportRecordV1Schema", () => {
  it("accepts normalized traceability data", () => {
    expect(GalleyExportRecordV1Schema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    "https:evil",
    "file:secret",
    "C:secret",
    "/absolute.html",
    "exports//a.html",
    "exports/../a.html",
    "exports\\a.html"
  ])("rejects unsafe export path %s", (path) => {
    expect(() => GalleyExportRecordV1Schema.parse({ ...VALID, path })).toThrow();
  });

  it("rejects duplicate or non-normalized Skill audit paths", () => {
    expect(() => GalleyExportRecordV1Schema.parse({
      ...VALID,
      skillFiles: ["SKILL.md", "SKILL.md"]
    })).toThrow();
    expect(() => GalleyExportRecordV1Schema.parse({
      ...VALID,
      skillFiles: ["../SKILL.md"]
    })).toThrow();
  });
});
