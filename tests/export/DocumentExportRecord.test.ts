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
});
