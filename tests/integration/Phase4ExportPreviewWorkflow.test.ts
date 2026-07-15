import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import type { ExportConfiguration } from "../../src/export/ExportConfiguration";
import { ExportService } from "../../src/export/ExportService";
import { ObsidianExportArtifactWriter } from "../../src/export/ObsidianExportArtifactWriter";
import { PortableInlineProfile, StandardWebProfile, WechatProfile } from "../../src/export/profiles";
import { validateWechatHtml } from "../../src/export/WechatValidator";
import { GalleyPreviewView } from "../../src/preview/GalleyPreviewView";
import {
  OBSIDIAN_SESSION_PATHS,
  makeObsidianDocumentSessionFixture
} from "../support/obsidianDocumentSessionFixtures";
import { persistentObsidianVault } from "../support/obsidianVaultFixtures";

describe("Phase 4 generated artifact workflow", () => {
  it("opens, edits, exports all three profiles, preserves Authoring bytes, and opens mobile-safe preview", async () => {
    const fixture = await makeObsidianDocumentSessionFixture("generated article");
    const vault = persistentObsidianVault(fixture.backing);
    const opener = new ObsidianDocumentSessionOpener(vault, {
      now: () => new Date("2026-07-15T03:04:05.000Z"),
      randomUUID: uuidSequence("523e4567-e89b-42d3-a456-426614174")
    });
    const session = await opener.open(OBSIDIAN_SESSION_PATHS.html);
    session.updateBody('<article data-galley-article="true"><p style="color:#333">edited generated article</p></article>');
    await session.save("explicit");
    const savedAuthoringBytes = fixture.backing.read(OBSIDIAN_SESSION_PATHS.html);
    const repair = vi.fn(async () => { throw new Error("unexpected model repair"); });
    const service = new ExportService({
      profiles: [new StandardWebProfile(), new PortableInlineProfile(), new WechatProfile()],
      writer: new ObsidianExportArtifactWriter(vault),
      recorder: { record: (record, signal) => session.recordExport(record, signal) },
      repairer: { repair },
      now: () => new Date("2026-07-15T03:04:06.000Z"),
      randomUUID: uuidSequence("623e4567-e89b-42d3-a456-426614174")
    });
    const results = [];
    for (const profileId of ["standard-web", "portable-inline", "wechat"] as const) {
      results.push(await service.export({
        source: {
          htmlPath: OBSIDIAN_SESSION_PATHS.html,
          documentId: session.documentId(),
          html: session.html()
        },
        configuration: configuration(profileId)
      }, new AbortController().signal));
    }

    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toBe(savedAuthoringBytes);
    expect(repair).not.toHaveBeenCalled();
    expect(results[0]?.html).toMatch(/^<!DOCTYPE html><html/u);
    expect(results[1]?.html).not.toMatch(/<!DOCTYPE|<\/?(?:html|head|body)(?:\s|>)/iu);
    expect(results[1]?.html).not.toMatch(/data-galley-/iu);
    expect(validateWechatHtml(results[2]?.html ?? "").valid).toBe(true);
    const sidecar = GalleySidecarV1Schema.parse(JSON.parse(
      fixture.backing.read(OBSIDIAN_SESSION_PATHS.sidecar) ?? ""
    ));
    expect(sidecar.exports).toHaveLength(3);
    expect(sidecar.exports.map(({ path }) => fixture.backing.read(path))).toEqual(
      results.map(({ html }) => html)
    );

    const preview = new GalleyPreviewView(new WorkspaceLeaf(), {
      openDocument: async (path) => ({ html: (await opener.open(path)).html() })
    });
    await preview.openPath(OBSIDIAN_SESSION_PATHS.html);
    const frame = preview.contentEl.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.srcdoc).toContain("edited generated article");
    expect(preview.contentEl.querySelector("textarea,[contenteditable=true]")).toBeNull();
  });
});

function configuration(profileId: "standard-web" | "portable-inline" | "wechat"): ExportConfiguration {
  return {
    id: profileId,
    name: profileId,
    profileId,
    outputFolder: "exports",
    fileNameTemplate: `{stem}.${profileId}.html`
  };
}

function uuidSequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}${(++index).toString(16).padStart(3, "0")}`;
}
