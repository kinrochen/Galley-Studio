import type { TFile, Vault } from "obsidian";
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

  it("fails closed when create mutates the path and then throws", async () => {
    const backing = new PersistentObsidianBacking();
    const writer = new ObsidianExportArtifactWriter(
      persistentObsidianVault(backing, {
        afterCreate(path) {
          if (path.endsWith(".html")) throw new Error("post-create failure");
        }
      })
    );

    await expect(writer.writeNew(input())).rejects.toMatchObject({
      name: "ExportArtifactWriteAmbiguousError",
      code: "export_artifact_write_ambiguous",
      path: "exports/article-portable-inline.html"
    });
    expect(backing.paths()).toEqual(["exports/article-portable-inline.html"]);
    expect(backing.read("exports/article-portable-inline.html")).toBe(
      "portable bytes"
    );
  });

  it("fails closed when the returned file no longer owns the created path", async () => {
    const backing = new PersistentObsidianBacking();
    const writer = new ObsidianExportArtifactWriter(
      persistentObsidianVault(backing, {
        afterCreate(path, current) {
          if (path.endsWith(".html")) current.replace(path, "racing bytes");
        }
      })
    );

    await expect(writer.writeNew(input())).rejects.toMatchObject({
      code: "export_artifact_write_ambiguous",
      path: "exports/article-portable-inline.html"
    });
    expect(backing.paths()).toEqual(["exports/article-portable-inline.html"]);
    expect(backing.read("exports/article-portable-inline.html")).toBe(
      "racing bytes"
    );
  });

  it("allows one racing exclusive create and marks the other outcome ambiguous without writing -2", async () => {
    const backing = new PersistentObsidianBacking({ "exports/.keep": "" });
    const base = persistentObsidianVault(backing);
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalCreate = base.create.bind(base);
    const vault = {
      ...base,
      async create(path: string, text: string): Promise<TFile> {
        if (path.endsWith(".html")) {
          arrivals += 1;
          if (arrivals === 2) release();
          await gate;
        }
        return originalCreate(path, text);
      }
    } as Vault;
    const first = new ObsidianExportArtifactWriter(vault).writeNew(input());
    const second = new ObsidianExportArtifactWriter(vault).writeNew(input());

    const outcomes = await Promise.allSettled([first, second]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "export_artifact_write_ambiguous",
          path: "exports/article-portable-inline.html"
        })
      })
    ]);
    expect(backing.paths()).toEqual([
      "exports/.keep",
      "exports/article-portable-inline.html"
    ]);
  });
});

function input() {
  return {
    sourcePath: "notes/article.galley.html",
    configuration: CONFIGURATION,
    profileId: "portable-inline" as const,
    html: "portable bytes"
  };
}
