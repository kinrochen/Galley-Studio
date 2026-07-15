import { describe, expect, it } from "vitest";

import {
  DocumentExportDirtyError,
  DocumentSession
} from "../../src/documents/DocumentSession";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import type { GalleyExportRecordV1 } from "../../src/export/ExportRecord";
import { makeSessionDeps, TEST_PATHS } from "../support/workbenchFixtures";

const RECORD: GalleyExportRecordV1 = {
  id: "423e4567-e89b-42d3-a456-426614174000",
  configurationId: "standard-web",
  profileId: "standard-web",
  path: "notes/article.standard-web.html",
  exportedAt: "2026-07-15T02:03:04.000Z",
  sourceHtmlHash: "a".repeat(64),
  outputHash: "b".repeat(64),
  repairRounds: 0,
  skillFiles: []
};

describe("DocumentSession export records", () => {
  it("transactionally appends a successful export while preserving main HTML bytes", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    const record = { ...RECORD, sourceHtmlHash: fixture.sidecar.htmlHash };

    await session.recordExport(record);

    expect(fixture.backing.rawRead(TEST_PATHS.html)).toBe(fixture.html);
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.backing.rawRead(TEST_PATHS.sidecar) ?? "")
    );
    expect(sidecar.htmlHash).toBe(fixture.sidecar.htmlHash);
    expect(sidecar.exports).toEqual([record]);
    expect(session.state()).toMatchObject({ dirty: false, conflict: false });
  });

  it("rejects export recording while local edits are dirty", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>dirty</p></article>");

    await expect(session.recordExport(RECORD)).rejects.toBeInstanceOf(DocumentExportDirtyError);
    expect(fixture.backing.rawRead(TEST_PATHS.sidecar)).toContain('"exports": []');
  });

  it("surfaces an external pair change as conflict instead of mixing a record into it", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    await fixture.replacePairExternally("<article><p>external</p></article>");

    await expect(session.recordExport({ ...RECORD, sourceHtmlHash: fixture.sidecar.htmlHash }))
      .rejects.toMatchObject({ code: "document_conflict" });
    expect(session.state().conflict).toBe(true);
  });

  it("clears inherited export history when saveCopy assigns a new document identity", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    await session.recordExport({
      ...RECORD,
      sourceHtmlHash: fixture.sidecar.htmlHash
    });

    const copied = await session.saveCopy();
    const sidecar = GalleySidecarV1Schema.parse(JSON.parse(
      fixture.backing.rawRead(copied.sidecar) ?? ""
    ));

    expect(sidecar.documentId).not.toBe(fixture.sidecar.documentId);
    expect(sidecar.htmlHash).toBe(fixture.sidecar.htmlHash);
    expect(sidecar.exports).toEqual([]);
  });

  it("rejects a proved post-commit abort while reporting that the record is durable", async () => {
    const controller = new AbortController();
    const fixture = await makeSessionDeps({
      hooks: { afterReplaceCommitted: () => controller.abort() }
    });
    const session = await DocumentSession.open(fixture.dependencies);

    await expect(session.recordExport({
      ...RECORD,
      sourceHtmlHash: fixture.sidecar.htmlHash
    }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      recordOutcome: "recorded"
    });

    const sidecar = GalleySidecarV1Schema.parse(JSON.parse(
      fixture.backing.rawRead(TEST_PATHS.sidecar) ?? ""
    ));
    expect(sidecar.exports).toHaveLength(1);
    expect(session.exportPaths()).toEqual([RECORD.path]);
  });

  it("marks an unproved record transaction ambiguous and lets recovery expose the durable result", async () => {
    const fixture = await makeSessionDeps({
      hooks: { crashStages: new Set(["replace_after_commit_marker"]) }
    });
    const session = await DocumentSession.open(fixture.dependencies);

    await expect(session.recordExport({
      ...RECORD,
      sourceHtmlHash: fixture.sidecar.htmlHash
    })).rejects.toMatchObject({ recordOutcome: "ambiguous" });

    const recovered = await DocumentSession.open(fixture.dependencies);
    expect(recovered.exportPaths()).toEqual([RECORD.path]);
  });

  it("classifies same-session concurrent recording as known not-recorded", async () => {
    let entered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const fixture = await makeSessionDeps({
      hooks: {
        async beforeReplace() {
          calls += 1;
          if (calls === 1) {
            entered();
            await gate;
          }
        }
      }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    const first = session.recordExport({
      ...RECORD,
      sourceHtmlHash: fixture.sidecar.htmlHash
    });
    await firstEntered;

    await expect(session.recordExport({
      ...RECORD,
      id: "523e4567-e89b-42d3-a456-426614174000",
      path: "notes/article.second.html",
      sourceHtmlHash: fixture.sidecar.htmlHash
    })).rejects.toMatchObject({ recordOutcome: "not-recorded" });
    release();
    await first;
  });

  it("classifies a second-session observation conflict, then records uniquely after recovery reload", async () => {
    const fixture = await makeSessionDeps();
    const first = await DocumentSession.open(fixture.dependencies);
    const second = await DocumentSession.open(fixture.dependencies);
    const firstRecord = {
      ...RECORD,
      sourceHtmlHash: fixture.sidecar.htmlHash
    };
    const secondRecord = {
      ...firstRecord,
      id: "523e4567-e89b-42d3-a456-426614174000",
      path: "notes/article.second.html"
    };

    await first.recordExport(firstRecord);
    await expect(second.recordExport(secondRecord)).rejects.toMatchObject({
      code: "document_conflict",
      recordOutcome: "not-recorded"
    });
    await second.reload();
    expect(second.exportPaths()).toEqual([firstRecord.path]);
    await second.recordExport(secondRecord);
    expect(second.exportPaths()).toEqual([firstRecord.path, secondRecord.path]);
  });
});
