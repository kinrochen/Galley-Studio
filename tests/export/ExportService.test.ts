import { describe, expect, it, vi } from "vitest";

import {
  ExportRecordError,
  ExportService,
  type ExportArtifactWriter,
  type ExportRecordStore
} from "../../src/export/ExportService";
import type { ExportProfile } from "../../src/export/ExportProfile";

const SOURCE = Object.freeze({
  htmlPath: "notes/article.galley.html",
  documentId: "123e4567-e89b-42d3-a456-426614174000",
  html: "<!DOCTYPE html><html lang=\"zh-CN\"><head><title>x</title></head><body><article><p>中文</p></article></body></html>"
});

describe("ExportService", () => {
  it("exports all profiles without changing the Authoring bytes and never repairs Standard or Portable", async () => {
    const written: string[] = [];
    const writer: ExportArtifactWriter = {
      writeNew: vi.fn(async ({ html, profileId }) => {
        written.push(html);
        return { path: `exports/${profileId}.html` };
      })
    };
    const recorder: ExportRecordStore = { record: vi.fn(async () => undefined) };
    const repair = vi.fn();
    const service = new ExportService({
      profiles: [profile("standard-web"), profile("portable-inline"), profile("wechat")],
      writer,
      recorder,
      repairer: { repair },
      now: () => new Date("2026-07-15T01:02:03.000Z"),
      randomUUID: () => "223e4567-e89b-42d3-a456-426614174000"
    });
    const original = SOURCE.html;

    for (const profileId of ["standard-web", "portable-inline", "wechat"] as const) {
      await service.export({ source: SOURCE, configuration: configuration(profileId) }, new AbortController().signal);
    }

    expect(SOURCE.html).toBe(original);
    expect(repair).not.toHaveBeenCalled();
    expect(written).toHaveLength(3);
    expect(recorder.record).toHaveBeenCalledTimes(3);
  });

  it("repairs only an invalid WeChat copy for at most the repairer's result", async () => {
    const repair = vi.fn(async () => ({
      html: '<section><span leaf="">中文</span></section>',
      rounds: 2,
      skillFiles: ["SKILL.md", "references/theme-index.md", "assets/profiles/wechat.md"]
    }));
    const writer: ExportArtifactWriter = {
      writeNew: vi.fn(async () => ({ path: "exports/wechat.html" }))
    };
    const recorder: ExportRecordStore = { record: vi.fn(async () => undefined) };
    const service = new ExportService({
      profiles: [profile("wechat", "<section><p>中文</p></section>")],
      writer,
      recorder,
      repairer: { repair },
      now: () => new Date("2026-07-15T01:02:03.000Z"),
      randomUUID: () => "223e4567-e89b-42d3-a456-426614174000"
    });

    const result = await service.export(
      { source: SOURCE, configuration: configuration("wechat") },
      new AbortController().signal
    );

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.record.repairRounds).toBe(2);
    expect(result.html).toContain("data-galley-document-id");
    expect(result.html).toContain("data-galley-profile=\"wechat\"");
    expect(result.html).toContain('<span leaf="">中文</span>');
  });

  it("records only after a successful independent write and exposes an unrecorded written artifact", async () => {
    const recorder: ExportRecordStore = {
      record: vi.fn(async () => { throw new Error("pair conflict"); })
    };
    const service = new ExportService({
      profiles: [profile("standard-web")],
      writer: { writeNew: vi.fn(async () => ({ path: "exports/kept.html" })) },
      recorder,
      now: () => new Date("2026-07-15T01:02:03.000Z"),
      randomUUID: () => "223e4567-e89b-42d3-a456-426614174000"
    });

    const error = await service.export(
      { source: SOURCE, configuration: configuration("standard-web") },
      new AbortController().signal
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ExportRecordError);
    expect((error as ExportRecordError).artifactPath).toBe("exports/kept.html");
    expect((error as ExportRecordError).recorded).toBe(false);
  });

  it("does not record a failed or cancelled write", async () => {
    const recorder: ExportRecordStore = { record: vi.fn(async () => undefined) };
    const controller = new AbortController();
    controller.abort();
    const service = new ExportService({
      profiles: [profile("standard-web")],
      writer: { writeNew: vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }) },
      recorder
    });

    await expect(service.export(
      { source: SOURCE, configuration: configuration("standard-web") },
      controller.signal
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(recorder.record).not.toHaveBeenCalled();
  });
});

function profile(id: ExportProfile["id"], html = '<section><span leaf="">中文</span></section>'): ExportProfile {
  return Object.freeze({
    id,
    label: id,
    async transform() { return Object.freeze({ profileId: id, html, mediaType: "text/html" as const }); }
  });
}

function configuration(profileId: ExportProfile["id"]) {
  return Object.freeze({
    id: `${profileId}-config`,
    name: `${profileId} config`,
    profileId,
    outputFolder: "exports",
    fileNameTemplate: "{stem}-{profile}.html"
  });
}
