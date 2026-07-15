import { describe, expect, it } from "vitest";

import { ObsidianExportArtifactWriter } from "../../src/export/ObsidianExportArtifactWriter";
import type { ExportConfiguration } from "../../src/export/ExportConfiguration";
import { PersistentObsidianBacking, persistentObsidianVault } from "../support/obsidianVaultFixtures";

const CONFIGURATION: ExportConfiguration = {
  id: "portable-inline",
  name: "Portable",
  profileId: "portable-inline",
  outputFolder: "exports",
  fileNameTemplate: "{stem}-{profile}.html"
};

describe("ObsidianExportArtifactWriter", () => {
  it("writes a new standalone artifact and resolves collisions without overwrite", async () => {
    const backing = new PersistentObsidianBacking({
      "notes/article.galley.html": "authoring",
      "exports/article-portable-inline.html": "external"
    });
    const writer = new ObsidianExportArtifactWriter(persistentObsidianVault(backing));

    const result = await writer.writeNew({
      sourcePath: "notes/article.galley.html",
      configuration: CONFIGURATION,
      profileId: "portable-inline",
      html: "portable bytes"
    });

    expect(result.path).toBe("exports/article-portable-inline-2.html");
    expect(backing.read("exports/article-portable-inline.html")).toBe("external");
    expect(backing.read(result.path)).toBe("portable bytes");
  });

  it("rejects unsafe filename configuration before writing", async () => {
    const backing = new PersistentObsidianBacking();
    const writer = new ObsidianExportArtifactWriter(persistentObsidianVault(backing));

    await expect(writer.writeNew({
      sourcePath: "notes/article.galley.html",
      configuration: { ...CONFIGURATION, fileNameTemplate: "../escape.html" },
      profileId: "portable-inline",
      html: "x"
    })).rejects.toThrow(/configuration|filename/i);
    expect(backing.paths()).toEqual([]);
  });
});
