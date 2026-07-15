import { describe, expect, it } from "vitest";

import {
  GalleyDocumentPathError,
  galleyArtifactPaths
} from "../../src/documents/DocumentSessionOpener";
import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { persistentObsidianVault } from "../support/obsidianVaultFixtures";
import {
  OBSIDIAN_SESSION_PATHS,
  makeObsidianDocumentSessionFixture
} from "../support/obsidianDocumentSessionFixtures";

describe("DocumentSessionOpener path boundary", () => {
  it("derives only a canonical same-stem sidecar from an exact .galley.html path", () => {
    expect(galleyArtifactPaths("notes/article.galley.html")).toEqual(
      OBSIDIAN_SESSION_PATHS
    );
    expect(galleyArtifactPaths("article.unverified.galley.html")).toEqual({
      html: "article.unverified.galley.html",
      sidecar: "article.unverified.galley.json"
    });
  });

  it.each([
    "notes/article.html",
    "notes/article.galley.json",
    "/notes/article.galley.html",
    "notes/../article.galley.html",
    "notes\\article.galley.html",
    "notes/.galley.html",
    ".galley.html",
    "notes//article.galley.html",
    "https://example.test/article.galley.html"
  ])("rejects a non-Galley or non-canonical path: %s", (path) => {
    expect(() => galleyArtifactPaths(path)).toThrow(GalleyDocumentPathError);
  });

  it("reports a missing pair without manufacturing a session", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    fixture.backing.remove(OBSIDIAN_SESSION_PATHS.html);
    fixture.backing.remove(OBSIDIAN_SESSION_PATHS.sidecar);
    const opener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    );

    await expect(
      opener.inspectRecovery(OBSIDIAN_SESSION_PATHS.html)
    ).resolves.toEqual({
      paths: OBSIDIAN_SESSION_PATHS,
      pair: "missing",
      recovery: { status: "ready" }
    });
    await expect(opener.open(OBSIDIAN_SESSION_PATHS.html)).rejects.toMatchObject({
      code: "galley_document_missing",
      paths: OBSIDIAN_SESSION_PATHS
    });
  });
});
