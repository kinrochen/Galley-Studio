import { describe, expect, it } from "vitest";

import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import { sha256Text } from "../../src/documents/GalleySidecar";
import {
  GalleyDocumentAmbiguousError,
  GalleyDocumentQuarantinedError,
  type OpenedGalleyDocumentSession
} from "../../src/documents/DocumentSessionOpener";
import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { ObsidianWorkbenchVault } from "../../src/documents/ObsidianWorkbenchVault";
import { persistentObsidianVault } from "../support/obsidianVaultFixtures";
import {
  OBSIDIAN_SESSION_DOCUMENT_ID,
  OBSIDIAN_SESSION_PATHS,
  makeObsidianDocumentSessionFixture
} from "../support/obsidianDocumentSessionFixtures";

describe("ObsidianDocumentSessionOpener production composition", () => {
  it("opens, edits, saves, lists/restores history, and reopens across plugin recreation", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const firstOpener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing),
      {
        now: () => new Date("2026-07-15T01:02:03.004Z"),
        historyOptions: {
          randomUUID: uuidSequence("223e4567-e89b-42d3-a456-426614174")
        }
      }
    );

    const session: OpenedGalleyDocumentSession = await firstOpener.open(
      OBSIDIAN_SESSION_PATHS.html
    );
    expect(session.paths()).toEqual(OBSIDIAN_SESSION_PATHS);
    expect(session.documentId()).toBe(OBSIDIAN_SESSION_DOCUMENT_ID);
    expect(session.recoveryState()).toEqual({ status: "ready" });

    session.updateBody(
      '<article data-galley-article="true"><p>edited</p></article>'
    );
    await session.save("explicit");
    expect(session.state()).toMatchObject({ dirty: false, conflict: false });

    const snapshots = await session.history();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.html).toBe(fixture.html);

    await session.restoreHistory(snapshots[0]!.path);
    expect(session.bodyHtml()).toContain("original");
    expect(session.state().dirty).toBe(true);
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toContain("edited");

    await session.save("explicit");
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toContain("original");

    const restartedOpener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    );
    const reopened = await restartedOpener.open(OBSIDIAN_SESSION_PATHS.html);
    expect(reopened.bodyHtml()).toContain("original");
    expect(await reopened.history()).toHaveLength(2);
  });

  it("recovers a committed production transaction before a fresh opener exposes it", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const crashAt = new Set<"after-commit">();
    let committedTransactions = 0;
    const crashingOpener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing),
      {
        vaultOptions: {
          crashAt,
          onCrashPoint(point) {
            if (point === "after-commit") {
              committedTransactions += 1;
              if (committedTransactions === 2) crashAt.add("after-commit");
            }
          }
        },
        historyOptions: {
          randomUUID: uuidSequence("323e4567-e89b-42d3-a456-426614174")
        }
      }
    );
    const session = await crashingOpener.open(OBSIDIAN_SESSION_PATHS.html);
    session.updateBody(
      '<article data-galley-article="true"><p>committed before restart</p></article>'
    );

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });

    const restarted = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    );
    const recovered = await restarted.open(OBSIDIAN_SESSION_PATHS.html);
    expect(recovered.bodyHtml()).toContain("committed before restart");
    expect((await recovered.history()).map(({ html }) => html)).toEqual([
      fixture.html
    ]);
    expect(recovered.recoveryState()).toEqual({ status: "ready" });
  });

  it("surfaces scoped quarantine without overwriting externally replaced bytes", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const externalSidecar = "external sidecar replacement";
    const crashingOpener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing),
      {
        vaultOptions: {
          crashAt: new Set(["after-html"]),
          onCrashPoint(point) {
            if (point === "after-html") {
              fixture.backing.replace(
                OBSIDIAN_SESSION_PATHS.sidecar,
                externalSidecar
              );
            }
          }
        },
        historyOptions: {
          randomUUID: uuidSequence("423e4567-e89b-42d3-a456-426614174")
        }
      }
    );
    const session = await crashingOpener.open(OBSIDIAN_SESSION_PATHS.html);
    session.updateBody(
      '<article data-galley-article="true"><p>interrupted</p></article>'
    );

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "document_commit_ambiguous"
    });
    expect(session.recoveryState()).toMatchObject({ status: "quarantined" });
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.sidecar)).toBe(
      externalSidecar
    );

    const restarted = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    );
    const inspection = await restarted.inspectRecovery(
      OBSIDIAN_SESSION_PATHS.html
    );
    expect(inspection).toMatchObject({
      paths: OBSIDIAN_SESSION_PATHS,
      pair: "unknown",
      recovery: { status: "quarantined" }
    });
    await expect(restarted.open(OBSIDIAN_SESSION_PATHS.html)).rejects.toBeInstanceOf(
      GalleyDocumentQuarantinedError
    );
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.sidecar)).toBe(
      externalSidecar
    );
  });

  it("surfaces open-time ambiguity as a typed non-renderable result and later reopens stably", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const nextHtml = fixture.html.replace("original", "interrupted open");
    const nextSidecar = JSON.parse(fixture.sidecarJson) as Record<string, unknown>;
    const crashingVault = new ObsidianWorkbenchVault(
      persistentObsidianVault(fixture.backing),
      {
        crashAt: new Set(["after-html"]),
        randomUUID: () => "723e4567-e89b-42d3-a456-426614174000"
      }
    );
    const observation = (await crashingVault.readPair(
      OBSIDIAN_SESSION_PATHS
    ))!.observation;
    await expect(crashingVault.replacePairTransactional(
      OBSIDIAN_SESSION_PATHS,
      observation,
      {
        html: nextHtml,
        sidecarJson: `${JSON.stringify({
          ...nextSidecar,
          htmlHash: await sha256Text(nextHtml)
        })}\n`
      }
    )).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });

    let interruptedCleanup = false;
    const ambiguousVault = persistentObsidianVault(fixture.backing, {
      afterModify(path) {
        if (
          !interruptedCleanup &&
          (path === OBSIDIAN_SESSION_PATHS.html ||
            path === OBSIDIAN_SESSION_PATHS.sidecar)
        ) {
          interruptedCleanup = true;
          throw new Error("rollback acknowledgement lost");
        }
      }
    });
    const ambiguousOpener = new ObsidianDocumentSessionOpener(ambiguousVault);
    const failure = await ambiguousOpener.open(OBSIDIAN_SESSION_PATHS.html).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(GalleyDocumentAmbiguousError);
    expect(failure).toMatchObject({
      code: "galley_document_ambiguous",
      paths: OBSIDIAN_SESSION_PATHS,
      recovery: { status: "ambiguous" }
    });

    const recovered = await new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    ).open(OBSIDIAN_SESSION_PATHS.html);
    expect(recovered.recoveryState()).toEqual({ status: "ready" });
    expect(recovered.bodyHtml()).toMatch(/original|interrupted open/u);
  });

  it("resets an ambiguous facade only after a later proof-bearing stable reload", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const saveAbort = new AbortController();
    let abortOnce = true;
    const opener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing),
      {
        vaultOptions: {
          onCrashPoint(point) {
            if (abortOnce && point === "after-html") {
              abortOnce = false;
              saveAbort.abort();
            }
          }
        },
        historyOptions: {
          randomUUID: uuidSequence("823e4567-e89b-42d3-a456-426614174")
        }
      }
    );
    const session = await opener.open(OBSIDIAN_SESSION_PATHS.html);
    session.updateBody(
      '<article data-galley-article="true"><p>ambiguous save</p></article>'
    );

    await expect(session.save("explicit", saveAbort.signal)).rejects.toMatchObject({
      code: "workbench_mutation_ambiguous"
    });
    expect(session.recoveryState()).toMatchObject({ status: "ambiguous" });

    await session.reload();
    expect(session.recoveryState()).toEqual({ status: "ready" });
    expect(session.bodyHtml()).toContain("original");
  });

  it("refreshes the facade history scope when reload adopts a new valid pair identity", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const opener = new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing),
      {
        historyOptions: {
          randomUUID: uuidSequence("523e4567-e89b-42d3-a456-426614174")
        }
      }
    );
    const session = await opener.open(OBSIDIAN_SESSION_PATHS.html);
    const replacementId = "623e4567-e89b-42d3-a456-426614174000";
    const sidecar = JSON.parse(fixture.sidecarJson) as Record<string, unknown>;
    fixture.backing.replace(
      OBSIDIAN_SESSION_PATHS.sidecar,
      `${JSON.stringify({ ...sidecar, documentId: replacementId })}\n`
    );

    await session.reload();
    expect(session.documentId()).toBe(replacementId);
    session.updateBody(
      '<article data-galley-article="true"><p>new identity</p></article>'
    );
    await session.save("explicit");
    expect(await session.history()).toHaveLength(1);
  });

  it("keeps the public session facade free of adapter and repository internals", async () => {
    const fixture = await makeObsidianDocumentSessionFixture();
    const session = await new ObsidianDocumentSessionOpener(
      persistentObsidianVault(fixture.backing)
    ).open(OBSIDIAN_SESSION_PATHS.html);

    expect(Object.keys(session).sort()).toEqual([]);
    expect("vault" in session).toBe(false);
    expect("repository" in session).toBe(false);
    expect("historyRepository" in session).toBe(false);
    expect(GalleyDocumentCodec.parse(session.html()).bodyHtml).toBe(
      session.bodyHtml()
    );
  });
});

function uuidSequence(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}${sequence.toString(16).padStart(3, "0")}`;
  };
}
