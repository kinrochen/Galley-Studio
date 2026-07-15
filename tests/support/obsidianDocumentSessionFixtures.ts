import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import { sha256Text } from "../../src/documents/GalleySidecar";
import type { ArtifactPaths } from "../../src/documents/GalleyDocumentRepository";

import { PersistentObsidianBacking } from "./obsidianVaultFixtures";

export const OBSIDIAN_SESSION_PATHS: ArtifactPaths = {
  html: "notes/article.galley.html",
  sidecar: "notes/article.galley.json"
};

export const OBSIDIAN_SESSION_SOURCE_PATH = "notes/article.md";
export const OBSIDIAN_SESSION_SOURCE = "# source\n";
export const OBSIDIAN_SESSION_DOCUMENT_ID =
  "123e4567-e89b-42d3-a456-426614174000";

export interface ObsidianDocumentSessionFixture {
  readonly backing: PersistentObsidianBacking;
  readonly html: string;
  readonly sidecarJson: string;
}

export async function makeObsidianDocumentSessionFixture(
  body = "original"
): Promise<ObsidianDocumentSessionFixture> {
  const html = GalleyDocumentCodec.serialize({
    doctype: "<!DOCTYPE html>",
    lang: "zh-CN",
    headHtml:
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Article</title>',
    bodyHtml: `<article data-galley-article="true"><p>${body}</p></article>`
  });
  const sidecarJson = `${JSON.stringify({
    schemaVersion: 1,
    documentId: OBSIDIAN_SESSION_DOCUMENT_ID,
    sourcePath: OBSIDIAN_SESSION_SOURCE_PATH,
    sourceHash: await sha256Text(OBSIDIAN_SESSION_SOURCE),
    htmlHash: await sha256Text(html),
    themeId: "graphite-minimal",
    skillVersion: "test",
    skillLoadMode: "injected",
    skillFiles: ["SKILL.md", "references/theme-index.md"],
    model: "test-model",
    promptVersion: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    validation: { valid: true, issues: [] },
    exports: []
  })}\n`;
  return {
    backing: new PersistentObsidianBacking({
      [OBSIDIAN_SESSION_PATHS.html]: html,
      [OBSIDIAN_SESSION_PATHS.sidecar]: sidecarJson,
      [OBSIDIAN_SESSION_SOURCE_PATH]: OBSIDIAN_SESSION_SOURCE
    }),
    html,
    sidecarJson
  };
}
