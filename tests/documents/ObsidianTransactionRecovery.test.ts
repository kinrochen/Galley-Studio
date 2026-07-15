import { describe, expect, it } from "vitest";

import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import { sha256Text } from "../../src/documents/GalleySidecar";
import { HistoryRepository } from "../../src/documents/HistoryRepository";
import {
  ObsidianWorkbenchVault,
  type ObsidianWorkbenchCrashPoint
} from "../../src/documents/ObsidianWorkbenchVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault,
  type PersistentObsidianHooks
} from "../support/obsidianVaultFixtures";

const PATHS = {
  html: "notes/article.galley.html",
  sidecar: "notes/article.galley.json"
} as const;
const UNRELATED_PATHS = {
  html: "notes/unrelated.galley.html",
  sidecar: "notes/unrelated.galley.json"
} as const;

describe("Obsidian workbench transaction recovery", () => {
  it("restarts after the HTML mutation with the exact old pair, never a mixed pair", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      randomUUID: () => "523e4567-e89b-42d3-a456-426614174000",
      crashAt: new Set<ObsidianWorkbenchCrashPoint>(["after-html"])
    });
    const observed = await crashing.readPair(PATHS);

    await expect(
      crashing.replacePairTransactional(PATHS, observed!.observation, nextPair)
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    expect(backing.read(PATHS.html)).toBe(nextPair.html);
    expect(backing.read(PATHS.sidecar)).toBe(oldPair.sidecarJson);

    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readPair(PATHS)).resolves.toMatchObject(oldPair);
    expect(backing.read(PATHS.html)).toBe(oldPair.html);
    expect(backing.read(PATHS.sidecar)).toBe(oldPair.sidecarJson);
  });

  it("routes readText through the exact pair scope before returning one member", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      crashAt: new Set(["after-html"])
    });
    const observed = (await crashing.readPair(PATHS))!;
    await expect(
      crashing.replacePairTransactional(PATHS, observed.observation, nextPair)
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readText(PATHS.html)).resolves.toBe(oldPair.html);
    expect(backing.read(PATHS.sidecar)).toBe(oldPair.sidecarJson);
  });

  it("preserves a same-byte replacement of a one-sided created member", async () => {
    const contents = await pair("created");
    const other = await pair("unrelated");
    const otherPaths = {
      html: "notes/unrelated.galley.html",
      sidecar: "notes/unrelated.galley.json"
    } as const;
    const backing = new PersistentObsidianBacking({
      [otherPaths.html]: other.html,
      [otherPaths.sidecar]: other.sidecarJson
    });
    const obsidianVault = persistentObsidianVault(backing);
    const crashing = new ObsidianWorkbenchVault(obsidianVault, {
      crashAt: new Set(["after-html"])
    });
    await expect(crashing.createPairTransactional(PATHS, contents)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    backing.replace(PATHS.html, contents.html);

    const reopened = new ObsidianWorkbenchVault(obsidianVault);
    await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(PATHS.html)).toBe(contents.html);
    await expect(reopened.readPair(otherPaths)).resolves.toMatchObject(other);
  });

  it("quarantines a one-sided create when process restart loses identity provenance", async () => {
    const contents = await pair("created");
    const backing = new PersistentObsidianBacking();
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      crashAt: new Set(["after-html"])
    });
    await expect(crashing.createPairTransactional(PATHS, contents)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });

    const restarted = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(restarted.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(PATHS.html)).toBe(contents.html);
  });

  it("cleans an original one-sided create when the same Vault retains provenance", async () => {
    const contents = await pair("created");
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const crashing = new ObsidianWorkbenchVault(obsidianVault, {
      crashAt: new Set(["after-html"])
    });
    await expect(crashing.createPairTransactional(PATHS, contents)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });

    await expect(new ObsidianWorkbenchVault(obsidianVault).readPair(PATHS)).resolves.toBeNull();
    expect(backing.read(PATHS.html)).toBeNull();
  });

  it("preserves a same-byte replacement of a pending history preparation", async () => {
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const pendingPath = `.galley/history/${DOCUMENT_ID}/0001752480550123-323e4567-e89b-42d3-a456-426614174000-00000001.pending`;
    const crashing = new ObsidianWorkbenchVault(obsidianVault, {
      crashAt: new Set(["after-history-promote"])
    });
    await expect(crashing.createFileExclusive(pendingPath, "pending")).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    backing.replace(pendingPath, "pending");

    const reopened = new ObsidianWorkbenchVault(obsidianVault);
    await expect(reopened.listFiles(`.galley/history/${DOCUMENT_ID}`)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(pendingPath)).toBe("pending");
  });

  it("preserves same-byte pair replacements during restarted owned cleanup", async () => {
    const contents = await pair("created");
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
    const vault = new ObsidianWorkbenchVault(obsidianVault, { crashAt });
    const created = await vault.createPairTransactional(PATHS, contents);
    if (created.status !== "created") throw new Error("expected created pair");
    crashAt.add("after-intent");
    await expect(vault.cleanupCreatedMembers(created.ownership)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    backing.replace(PATHS.html, contents.html);
    backing.replace(PATHS.sidecar, contents.sidecarJson);

    const reopened = new ObsidianWorkbenchVault(obsidianVault);
    await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(PATHS.html)).toBe(contents.html);
    expect(backing.read(PATHS.sidecar)).toBe(contents.sidecarJson);
  });

  for (const point of [
    "after-intent",
    "after-applying",
    "after-html",
    "after-sidecar",
    "after-commit",
    "after-receipt",
    "after-completed"
  ] as const) {
    it(`recovers pair replacement after ${point} to one complete side`, async () => {
      const oldPair = await pair("old");
      const nextPair = await pair("next");
      const backing = new PersistentObsidianBacking({
        [PATHS.html]: oldPair.html,
        [PATHS.sidecar]: oldPair.sidecarJson
      });
      const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
        crashAt: new Set([point])
      });
      const observed = (await crashing.readPair(PATHS))!;
      await expect(
        crashing.replacePairTransactional(PATHS, observed.observation, nextPair)
      ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

      const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
      const recovered = await reopened.readPair(PATHS);
      const expected = ["after-commit", "after-receipt", "after-completed"].includes(point)
        ? nextPair
        : oldPair;
      expect(recovered).toMatchObject(expected);
      expect(backing.read(PATHS.html)).toBe(expected.html);
      expect(backing.read(PATHS.sidecar)).toBe(expected.sidecarJson);
      expect(await new ObsidianWorkbenchVault(persistentObsidianVault(backing)).readPair(PATHS))
        .toMatchObject(expected);
    });
  }

  it("finalizes combined history after committed reconciliation and releases its locks", async () => {
    const fixture = await combinedFixture("after-completed");
    await expect(
      fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      )
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    await expect(
      fixture.vault.reconcilePairWithHistoryTransaction(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      )
    ).resolves.toMatchObject({ status: "committed" });

    await expect(fixture.history.commit(fixture.prepared)).resolves.toMatchObject({
      html: fixture.oldPair.html
    });
    expect(fixture.backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
    expect(
      fixture.backing
        .paths()
        .filter(
          (path) =>
            path.startsWith(".galley/transactions/") &&
            (path.endsWith(".json") || path.endsWith(".txt"))
        )
    ).toEqual([]);
  });

  it("keeps closing proof when a live combined acknowledgement drifts during WAL cleanup", async () => {
    let transactionFolder = "";
    let deleted = 0;
    const fixture = await completedCombinedFixture(1, {
      afterDelete(path, backing) {
        if (!transactionFolder || !path.startsWith(`${transactionFolder}/`)) return;
        deleted += 1;
        if (deleted === 1) backing.replace(PATHS.html, "external-live-ack");
      }
    });
    await fixture.vault.replacePairWithHistoryTransactional(
      PATHS,
      fixture.observed.observation,
      fixture.nextPair,
      fixture.plan
    );
    const receiptPath = fixture.backing.paths().find((path) => path.endsWith("/receipt.json"));
    if (!receiptPath) throw new Error("missing combined receipt");
    transactionFolder = receiptPath.slice(0, receiptPath.lastIndexOf("/"));

    await expect(fixture.history.commit(fixture.prepared)).resolves.toMatchObject({
      html: fixture.oldPair.html
    });
    expect(fixture.backing.read(PATHS.html)).toBe("external-live-ack");
    expect(
      fixture.backing.paths().some((path) => path.endsWith(".quarantine.json"))
    ).toBe(true);
    expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);
    await expect(
      new HistoryRepository(
        new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
        20
      ).list(DOCUMENT_ID)
    ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
    await expect(
      new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)).readPair(
        UNRELATED_PATHS
      )
    ).resolves.toMatchObject(fixture.unrelatedPair);
  });

  it("compacts an orphan completed combined receipt before fresh history work", async () => {
    const fixture = await completedCombinedFixture(20);
    await expect(
      fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      )
    ).resolves.toMatchObject({ status: "committed" });
    expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);

    const restartedVault = new ObsidianWorkbenchVault(
      persistentObsidianVault(fixture.backing)
    );
    const restartedHistory = new HistoryRepository(restartedVault, 20, {
      randomUUID: () => "723e4567-e89b-42d3-a456-426614174000"
    });
    await expect(
      restartedHistory.store(
        DOCUMENT_ID,
        "post-restart",
        new Date("2026-07-14T08:10:01.000Z")
      )
    ).resolves.toMatchObject({ html: "post-restart" });

    await expect(restartedVault.readPair(PATHS)).resolves.toMatchObject(
      fixture.nextPair
    );
    const snapshots = await restartedHistory.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.filter(({ html }) => html === fixture.oldPair.html)).toHaveLength(1);
    expect(snapshots.filter(({ html }) => html === "post-restart")).toHaveLength(1);
    expect(fixture.backing.read(fixture.plan.finalPath)).toBe(fixture.oldPair.html);
    expect(new Set(snapshots.map(({ path }) => path)).size).toBe(20);
    expect(transactionProofFiles(fixture.backing)).toEqual([]);
  });

  for (const point of [
    "after-recovery-wal-cleanup",
    "after-recovery-lock-cleanup",
    "after-recovery-index-cleanup",
    "after-recovery-proof-cleanup"
  ] as const) {
    it(`replays orphan combined compaction after ${point}`, async () => {
      const fixture = await completedCombinedFixture(1);
      await fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      );

      const crashing = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing),
        { crashAt: new Set([point]) }
      );
      await expect(new HistoryRepository(crashing, 20).list(DOCUMENT_ID)).rejects.toMatchObject({
        code: "workbench_simulated_crash",
        point
      });

      const restartedVault = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing)
      );
      const restartedHistory = new HistoryRepository(restartedVault, 20, {
        randomUUID: () => "823e4567-e89b-42d3-a456-426614174000"
      });
      await expect(
        restartedHistory.store(
          DOCUMENT_ID,
          `after-${point}`,
          new Date("2026-07-14T08:10:02.000Z")
        )
      ).resolves.toMatchObject({ html: `after-${point}` });
      await expect(restartedVault.readPair(PATHS)).resolves.toMatchObject(
        fixture.nextPair
      );
      expect(fixture.backing.read(fixture.plan.finalPath)).toBe(fixture.oldPair.html);
      expect(transactionProofFiles(fixture.backing)).toEqual([]);
    });
  }

  for (const mutation of ["tampered", "missing"] as const) {
    it(`does not compact a ${mutation} closing proof after WAL cleanup`, async () => {
      const fixture = await completedCombinedFixture(1);
      await fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      );
      const crashing = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing),
        { crashAt: new Set(["after-recovery-wal-cleanup"]) }
      );
      await expect(new HistoryRepository(crashing, 20).list(DOCUMENT_ID)).rejects.toMatchObject({
        code: "workbench_simulated_crash"
      });
      const proofPath = fixture.backing
        .paths()
        .find(
          (path) =>
            path.startsWith(".galley/transactions/closing/") &&
            !path.endsWith(".quarantine.json")
        );
      if (!proofPath) throw new Error("missing closing proof");
      if (mutation === "tampered") fixture.backing.replace(proofPath, "{}\n");
      else fixture.backing.remove(proofPath);

      await expect(
        new HistoryRepository(
          new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
          20
        ).list(DOCUMENT_ID)
      ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
      expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);
      expect(
        fixture.backing.paths().some((path) => path.includes("/scopes/"))
      ).toBe(true);
    });
  }

  for (const scope of ["pair", "history"] as const) {
    for (const mutation of ["missing", "malformed"] as const) {
      it(`routes a post-WAL ${scope} recovery through closing proof when its index is ${mutation}`, async () => {
        const fixture = await completedCombinedFixture(1);
        await fixture.vault.replacePairWithHistoryTransactional(
          PATHS,
          fixture.observed.observation,
          fixture.nextPair,
          fixture.plan
        );
        const crashing = new ObsidianWorkbenchVault(
          persistentObsidianVault(fixture.backing),
          { crashAt: new Set(["after-recovery-wal-cleanup"]) }
        );
        await expect(
          new HistoryRepository(crashing, 20).list(DOCUMENT_ID)
        ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

        const proofPath = fixture.backing
          .paths()
          .find(
            (path) =>
              path.startsWith(".galley/transactions/closing/") &&
              !path.endsWith(".quarantine.json")
          );
        if (!proofPath) throw new Error("missing closing proof");
        const transactionId = proofPath.slice(
          proofPath.lastIndexOf("/") + 1,
          -".json".length
        );
        const indexPath = fixture.backing
          .paths()
          .find(
            (path) =>
              path.startsWith(`.galley/transactions/scopes/${scope}-`) &&
              path.endsWith(`/${transactionId}.json`)
          );
        if (!indexPath) throw new Error(`missing ${scope} scope index`);
        if (mutation === "missing") fixture.backing.remove(indexPath);
        else fixture.backing.replace(indexPath, "{}\n");

        const targetPath = scope === "pair" ? PATHS.html : fixture.plan.finalPath;
        const external = `external-post-wal-${scope}-${mutation}`;
        fixture.backing.replace(targetPath, external);
        const restarted = new ObsidianWorkbenchVault(
          persistentObsidianVault(fixture.backing)
        );
        if (scope === "pair") {
          await expect(restarted.readPair(PATHS)).rejects.toMatchObject({
            code: "transaction_recovery_conflict"
          });
        } else {
          await expect(
            new HistoryRepository(restarted, 20).list(DOCUMENT_ID)
          ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
        }
        expect(fixture.backing.read(targetPath)).toBe(external);
        await expect(
          new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)).readPair(
            UNRELATED_PATHS
          )
        ).resolves.toMatchObject(fixture.unrelatedPair);
      });
    }
  }

  it("does not compact a fresh combined transaction with a tampered receipt", async () => {
    const fixture = await completedCombinedFixture(1);
    await fixture.vault.replacePairWithHistoryTransactional(
      PATHS,
      fixture.observed.observation,
      fixture.nextPair,
      fixture.plan
    );
    const receiptPath = fixture.backing.paths().find((path) => path.endsWith("/receipt.json"));
    if (!receiptPath) throw new Error("missing receipt");
    fixture.backing.replace(receiptPath, "{}\n");

    const restarted = new HistoryRepository(
      new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
      20
    );
    await expect(restarted.list(DOCUMENT_ID)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(fixture.backing.read(PATHS.html)).toBe(fixture.nextPair.html);
    expect(fixture.backing.read(fixture.plan.finalPath)).toBe(fixture.oldPair.html);
    expect(fixture.backing.read(receiptPath)).toBe("{}\n");
    expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);
  });

  it("quarantines external drift instead of compacting fresh combined proof", async () => {
    const fixture = await completedCombinedFixture(1);
    await fixture.vault.replacePairWithHistoryTransactional(
      PATHS,
      fixture.observed.observation,
      fixture.nextPair,
      fixture.plan
    );
    fixture.backing.replace(PATHS.html, "external-drift");

    const restarted = new HistoryRepository(
      new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
      20
    );
    await expect(restarted.list(DOCUMENT_ID)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(fixture.backing.read(PATHS.html)).toBe("external-drift");
    expect(fixture.backing.read(fixture.plan.finalPath)).toBe(fixture.oldPair.html);
    expect(
      fixture.backing.paths().some((path) => path.endsWith("/quarantine.json"))
    ).toBe(true);
    expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);
  });

  it("preserves a later history final outside the closing plan", async () => {
    const fixture = await completedCombinedFixture(1);
    await fixture.vault.replacePairWithHistoryTransactional(
      PATHS,
      fixture.observed.observation,
      fixture.nextPair,
      fixture.plan
    );
    const laterPath = `.galley/history/${DOCUMENT_ID}/0001784016601000-923e4567-e89b-42d3-a456-426614174000-00000001.html`;
    fixture.backing.replace(laterPath, "later-independent");

    const restarted = new HistoryRepository(
      new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
      20
    );
    await expect(restarted.list(DOCUMENT_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: laterPath, html: "later-independent" }),
        expect.objectContaining({ path: fixture.plan.finalPath, html: fixture.oldPair.html })
      ])
    );
    expect(fixture.backing.read(laterPath)).toBe("later-independent");
    expect(transactionProofFiles(fixture.backing)).toEqual([]);
  });

  for (const deletion of ["first", "middle", "last"] as const) {
    for (const target of ["pair", "history"] as const) {
      it(`retains closing proof when ${target} drifts after the ${deletion} WAL deletion`, async () => {
        const fixture = await completedCombinedFixture(1);
        await fixture.vault.replacePairWithHistoryTransactional(
          PATHS,
          fixture.observed.observation,
          fixture.nextPair,
          fixture.plan
        );
        const receiptPath = fixture.backing
          .paths()
          .find((path) => path.endsWith("/receipt.json"));
        if (!receiptPath) throw new Error("missing combined receipt");
        const transactionFolder = receiptPath.slice(0, receiptPath.lastIndexOf("/"));
        const transactionId = transactionFolder.slice(transactionFolder.lastIndexOf("/") + 1);
        const members = fixture.backing
          .paths()
          .filter((path) => path.startsWith(`${transactionFolder}/`));
        const deletionNumber =
          deletion === "first"
            ? 1
            : deletion === "middle"
              ? Math.ceil(members.length / 2)
              : members.length;
        const targetPath = target === "pair" ? PATHS.html : fixture.plan.finalPath;
        const external = `external-${target}-${deletion}`;
        let deleted = 0;
        const recoveringVault = new ObsidianWorkbenchVault(
          persistentObsidianVault(fixture.backing, {
            afterDelete(path) {
              if (!path.startsWith(`${transactionFolder}/`)) return;
              deleted += 1;
              if (deleted === deletionNumber) {
                fixture.backing.replace(targetPath, external);
              }
            }
          })
        );

        await expect(
          new HistoryRepository(recoveringVault, 20).list(DOCUMENT_ID)
        ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
        expect(fixture.backing.read(targetPath)).toBe(external);
        expect(
          fixture.backing
            .paths()
            .some((path) => path.endsWith(`/${transactionId}.json`))
        ).toBe(true);
        expect(fixture.backing.paths().some((path) => path.endsWith(".lock"))).toBe(true);
        await expect(
          new HistoryRepository(
            new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
            20
          ).list(DOCUMENT_ID)
        ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
        await expect(
          new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)).readPair(
            UNRELATED_PATHS
          )
        ).resolves.toMatchObject(fixture.unrelatedPair);
      });
    }
  }

  for (const interruption of ["first", "middle", "last"] as const) {
    it(`resumes exact combined WAL cleanup after the ${interruption} member deletion throws`, async () => {
      const fixture = await completedCombinedFixture(1);
      await fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      );
      const receiptPath = fixture.backing
        .paths()
        .find((path) => path.endsWith("/receipt.json"));
      if (!receiptPath) throw new Error("missing combined receipt");
      const transactionFolder = receiptPath.slice(0, receiptPath.lastIndexOf("/"));
      const members = fixture.backing
        .paths()
        .filter((path) => path.startsWith(`${transactionFolder}/`));
      const interruptionNumber =
        interruption === "first"
          ? 1
          : interruption === "middle"
            ? Math.ceil(members.length / 2)
            : members.length;
      let deleted = 0;
      const interrupted = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing, {
          afterDelete(path) {
            if (!path.startsWith(`${transactionFolder}/`)) return;
            deleted += 1;
            if (deleted === interruptionNumber) {
              throw new Error(`interrupt after ${interruption} WAL member`);
            }
          }
        })
      );

      await expect(
        new HistoryRepository(interrupted, 20).list(DOCUMENT_ID)
      ).rejects.toBeDefined();
      const fresh = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing)
      );
      await expect(new HistoryRepository(fresh, 20).list(DOCUMENT_ID)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: fixture.plan.finalPath,
            html: fixture.oldPair.html
          })
        ])
      );
      await expect(fresh.readPair(PATHS)).resolves.toMatchObject(fixture.nextPair);
      await expect(
        new HistoryRepository(
          new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
          20
        ).list(DOCUMENT_ID)
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: fixture.plan.finalPath,
            html: fixture.oldPair.html
          })
        ])
      );
      expect(transactionProofFiles(fixture.backing)).toEqual([]);
    });
  }

  for (const point of [
    "after-intent",
    "after-applying",
    "after-html",
    "after-sidecar",
    "after-commit",
    "after-receipt",
    "after-completed"
  ] as const) {
    it(`recovers pair creation after ${point} without exposing a one-sided pair`, async () => {
      const contents = await pair("created");
      const backing = new PersistentObsidianBacking();
      const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
        crashAt: new Set([point])
      });
      await expect(crashing.createPairTransactional(PATHS, contents)).rejects.toMatchObject({
        code: "workbench_simulated_crash"
      });

      const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
      const committed = [
        "after-sidecar",
        "after-commit",
        "after-receipt",
        "after-completed"
      ].includes(point);
      if (point === "after-html") {
        await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
          code: "transaction_recovery_conflict"
        });
        expect(backing.read(PATHS.html)).toBe(contents.html);
      } else if (committed) {
        await expect(reopened.readPair(PATHS)).resolves.toMatchObject(contents);
      } else {
        await expect(reopened.readPair(PATHS)).resolves.toBeNull();
      }
      if (point !== "after-html") {
        expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
      }
    });
  }

  it("replays partial owned cleanup while preserving a same-path replacement", async () => {
    const contents = await pair("created");
    const backing = new PersistentObsidianBacking();
    const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing), { crashAt });
    const created = await vault.createPairTransactional(PATHS, contents);
    if (created.status !== "created") throw new Error("expected created pair");
    crashAt.add("after-html");
    await expect(vault.cleanupCreatedMembers(created.ownership)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    backing.replace(PATHS.html, "external");

    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(PATHS.html)).toBe("external");
    expect(backing.read(PATHS.sidecar)).toBe(contents.sidecarJson);
  });

  it("rolls back a one-sided crashed create without deleting an external replacement", async () => {
    const contents = await pair("copy");
    const backing = new PersistentObsidianBacking();
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      crashAt: new Set(["after-html"])
    });
    await expect(crashing.createPairTransactional(PATHS, contents)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    backing.replace(PATHS.html, "external");

    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    expect(backing.read(PATHS.html)).toBe("external");
    expect(backing.read(PATHS.sidecar)).toBeNull();
  });

  it("quarantines target drift only for the affected scope", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const otherPair = await pair("other");
    const otherPaths = {
      html: "notes/other.galley.html",
      sidecar: "notes/other.galley.json"
    } as const;
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson,
      [otherPaths.html]: otherPair.html,
      [otherPaths.sidecar]: otherPair.sidecarJson
    });
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      crashAt: new Set(["after-html"]),
      onCrashPoint(point) {
        if (point === "after-html") backing.replace(PATHS.sidecar, "external-sidecar");
      }
    });
    const observed = (await crashing.readPair(PATHS))!;
    await expect(
      crashing.replacePairTransactional(PATHS, observed.observation, nextPair)
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    await expect(reopened.readPair(otherPaths)).resolves.toMatchObject(otherPair);
    expect(backing.read(PATHS.html)).toBe(nextPair.html);
    expect(backing.read(PATHS.sidecar)).toBe("external-sidecar");
    expect(backing.paths().some((path) => path.endsWith("/quarantine.json"))).toBe(true);
  });

  for (const target of ["manifest.json", "blob-pair-html-after.txt"] as const) {
    it(`fails closed for a tampered ${target} while unrelated scope remains readable`, async () => {
      const oldPair = await pair("old");
      const nextPair = await pair("next");
      const otherPair = await pair("other");
      const otherPaths = {
        html: "notes/other.galley.html",
        sidecar: "notes/other.galley.json"
      } as const;
      const backing = new PersistentObsidianBacking({
        [PATHS.html]: oldPair.html,
        [PATHS.sidecar]: oldPair.sidecarJson,
        [otherPaths.html]: otherPair.html,
        [otherPaths.sidecar]: otherPair.sidecarJson
      });
      const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
        crashAt: new Set(["after-intent"])
      });
      const observed = (await crashing.readPair(PATHS))!;
      await expect(
        crashing.replacePairTransactional(PATHS, observed.observation, nextPair)
      ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
      const targetPath = backing.paths().find((path) => path.endsWith(`/${target}`));
      if (!targetPath) throw new Error(`missing ${target}`);
      backing.replace(targetPath, "tampered");

      const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
      await expect(reopened.readPair(PATHS)).rejects.toMatchObject({
        code: "transaction_recovery_conflict"
      });
      await expect(reopened.readPair(otherPaths)).resolves.toMatchObject(otherPair);
      expect(backing.read(PATHS.html)).toBe(oldPair.html);
      expect(backing.read(PATHS.sidecar)).toBe(oldPair.sidecarJson);
      expect(backing.read(targetPath)).toBe("tampered");
    });
  }

  it("keeps a tampered quarantine scoped and never retries target mutation", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const crashing = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      crashAt: new Set(["after-html"]),
      onCrashPoint(point) {
        if (point === "after-html") backing.replace(PATHS.sidecar, "external");
      }
    });
    const observed = (await crashing.readPair(PATHS))!;
    await expect(
      crashing.replacePairTransactional(PATHS, observed.observation, nextPair)
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    const recovering = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(recovering.readPair(PATHS)).rejects.toMatchObject({
      code: "transaction_recovery_conflict"
    });
    const quarantine = backing.paths().find((path) => path.endsWith("/quarantine.json"));
    if (!quarantine) throw new Error("missing quarantine");
    backing.replace(quarantine, "{}\n");
    const before = [backing.read(PATHS.html), backing.read(PATHS.sidecar)];

    await expect(
      new ObsidianWorkbenchVault(persistentObsidianVault(backing)).readPair(PATHS)
    ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
    expect([backing.read(PATHS.html), backing.read(PATHS.sidecar)]).toEqual(before);
    expect(backing.read(quarantine)).toBe("{}\n");
  });

  for (const point of [
    "after-intent",
    "after-html",
    "after-sidecar",
    "after-history-promote",
    "after-history-removal",
    "after-commit",
    "after-receipt",
    "after-completed"
  ] as const) {
    it(`recovers and reconciles one combined pair/history save after ${point}`, async () => {
      const fixture = await combinedFixture(point);
      await expect(
        fixture.vault.replacePairWithHistoryTransactional(
          PATHS,
          fixture.observed.observation,
          fixture.nextPair,
          fixture.plan
        )
      ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

      const reconciliation = await fixture.vault.reconcilePairWithHistoryTransaction(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      );
      const committed = ["after-commit", "after-receipt", "after-completed"].includes(point);
      expect(reconciliation.status).toBe(committed ? "committed" : "precommit");
      const reopened = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing)
      );
      await expect(reopened.readPair(PATHS)).resolves.toMatchObject(
        committed ? fixture.nextPair : fixture.oldPair
      );
      const history = new HistoryRepository(reopened, 1);
      const snapshots = await history.list(DOCUMENT_ID);
      expect(snapshots.map(({ html }) => html)).toEqual([
        committed ? fixture.oldPair.html : "older"
      ]);
      const repeated = await new HistoryRepository(
        new ObsidianWorkbenchVault(persistentObsidianVault(fixture.backing)),
        1
      ).list(DOCUMENT_ID);
      expect(repeated.map(({ html }) => html)).toEqual(snapshots.map(({ html }) => html));
    });
  }

  for (const point of [
    "after-history-promote",
    "after-history-removal",
    "after-commit",
    "after-receipt",
    "after-completed"
  ] as const) {
    it(`recovers a history-only retention transaction after ${point}`, async () => {
      const fixture = await historyFixture(point);
      await expect(
        fixture.vault.applyRetentionTransaction(
          fixture.plan.provisional,
          fixture.plan.finalPath,
          fixture.plan.observedFiles,
          fixture.plan.removals
        )
      ).rejects.toMatchObject({ code: "workbench_simulated_crash" });

      const reopened = new ObsidianWorkbenchVault(
        persistentObsidianVault(fixture.backing)
      );
      const committed = ["after-commit", "after-receipt", "after-completed"].includes(point);
      if (!committed) {
        await expect(new HistoryRepository(reopened, 1).list(DOCUMENT_ID)).rejects.toMatchObject(
          { code: "transaction_recovery_conflict" }
        );
        expect(fixture.backing.read(fixture.plan.finalPath)).toBe("newer");
        return;
      }
      const snapshots = await new HistoryRepository(reopened, 1).list(DOCUMENT_ID);
      expect(snapshots.map(({ html }) => html)).toEqual([
        "newer"
      ]);
      expect(
        fixture.backing.paths().some((path) => path.includes(".history-scope.galley"))
      ).toBe(false);
    });
  }

  it("preserves a same-byte replacement of a promoted history final", async () => {
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
    const vault = new ObsidianWorkbenchVault(obsidianVault, { crashAt });
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const prepared = await history.prepare(
      DOCUMENT_ID,
      "newer",
      new Date("2026-07-14T08:09:10.000Z")
    );
    const plan = await history.plan(prepared);
    crashAt.add("after-history-promote");
    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        plan.finalPath,
        plan.observedFiles,
        plan.removals
      )
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    backing.replace(plan.finalPath, "newer");

    await expect(
      new ObsidianWorkbenchVault(obsidianVault).listFiles(
        `.galley/history/${DOCUMENT_ID}`
      )
    ).rejects.toMatchObject({ code: "transaction_recovery_conflict" });
    expect(backing.read(plan.finalPath)).toBe("newer");
  });

  it("preserves a same-byte provisional replacement before history deletion", async () => {
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    let provisionalPath = "";
    const vault = new ObsidianWorkbenchVault(obsidianVault, {
      onCrashPoint(point) {
        if (point === "after-applying") {
          backing.replace(provisionalPath, "newer");
        }
      }
    });
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const prepared = await history.prepare(
      DOCUMENT_ID,
      "newer",
      new Date("2026-07-14T08:09:10.000Z")
    );
    const plan = await history.plan(prepared);
    provisionalPath = plan.provisional.path;

    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        plan.finalPath,
        plan.observedFiles,
        plan.removals
      )
    ).rejects.toMatchObject({ code: "workbench_mutation_ambiguous" });
    expect(backing.read(provisionalPath)).toBe("newer");
  });

  it("retries the exact completed history plan and acknowledges it idempotently", async () => {
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
    const vault = new ObsidianWorkbenchVault(obsidianVault, { crashAt });
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const prepared = await history.prepare(
      DOCUMENT_ID,
      "newer",
      new Date("2026-07-14T08:09:10.000Z")
    );
    const plan = await history.plan(prepared);
    crashAt.add("after-completed");
    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        plan.finalPath,
        plan.observedFiles,
        plan.removals
      )
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    crashAt.clear();

    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        plan.finalPath,
        plan.observedFiles,
        plan.removals
      )
    ).resolves.toMatchObject({ status: "created", file: { path: plan.finalPath } });
    const differentFinalPath = plan.finalPath.replace(/-[0-9]{8,}\.html$/u, "-99999999.html");
    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        differentFinalPath,
        plan.observedFiles,
        plan.removals
      )
    ).resolves.toMatchObject({
      status: "created",
      file: { path: plan.finalPath, html: "newer" }
    });
    await vault.acknowledgeRetention(plan.provisional);
    await vault.acknowledgeRetention(plan.provisional);
    expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
    expect(backing.read(plan.finalPath)).toBe("newer");
  });

  it("retries an after-completed history commit through the real repository", async () => {
    const backing = new PersistentObsidianBacking();
    const obsidianVault = persistentObsidianVault(backing);
    const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
    const vault = new ObsidianWorkbenchVault(obsidianVault, { crashAt });
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const prepared = await history.prepare(
      DOCUMENT_ID,
      "newer",
      new Date("2026-07-14T08:09:10.000Z")
    );
    crashAt.add("after-completed");
    await expect(history.commit(prepared)).rejects.toMatchObject({
      code: "workbench_simulated_crash"
    });
    crashAt.clear();

    const committed = await history.commit(prepared);
    expect(committed.html).toBe("newer");
    await expect(history.commit(prepared)).resolves.toEqual(committed);
    await expect(history.list(DOCUMENT_ID)).resolves.toEqual([committed]);
    expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
    expect(transactionProofFiles(backing)).toEqual([]);
  });

  it("returns unknown and preserves bytes when a combined receipt is replaced", async () => {
    const fixture = await combinedFixture("after-completed");
    await expect(
      fixture.vault.replacePairWithHistoryTransactional(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      )
    ).rejects.toMatchObject({ code: "workbench_simulated_crash" });
    const receiptPath = fixture.backing.paths().find((path) => path.endsWith("/receipt.json"));
    if (!receiptPath) throw new Error("missing receipt");
    fixture.backing.replace(receiptPath, "{}\n");

    await expect(
      fixture.vault.reconcilePairWithHistoryTransaction(
        PATHS,
        fixture.observed.observation,
        fixture.nextPair,
        fixture.plan
      )
    ).resolves.toEqual({ status: "unknown" });
    expect(fixture.backing.read(PATHS.html)).toBe(fixture.nextPair.html);
    expect(fixture.backing.read(PATHS.sidecar)).toBe(fixture.nextPair.sidecarJson);
    expect(fixture.backing.read(receiptPath)).toBe("{}\n");
  });

  it("aborts before intent without WAL and recovers an abort after HTML mutation", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const before = new AbortController();
    before.abort();
    const clean = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const observation = (await clean.readPair(PATHS))!.observation;
    await expect(
      clean.replacePairTransactional(PATHS, observation, nextPair, before.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(backing.paths().filter((path) => path.includes(".galley/transactions"))).toEqual([]);

    const after = new AbortController();
    const aborting = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      onCrashPoint(point) {
        if (point === "after-html") after.abort();
      }
    });
    const current = (await aborting.readPair(PATHS))!.observation;
    await expect(
      aborting.replacePairTransactional(PATHS, current, nextPair, after.signal)
    ).rejects.toMatchObject({ code: "workbench_mutation_ambiguous" });
    const reopened = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    await expect(reopened.readPair(PATHS)).resolves.toMatchObject(oldPair);
  });
});

const DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";

async function combinedFixture(point: ObsidianWorkbenchCrashPoint) {
  const oldPair = await pair("old");
  const nextPair = await pair("next");
  const backing = new PersistentObsidianBacking({
    [PATHS.html]: oldPair.html,
    [PATHS.sidecar]: oldPair.sidecarJson
  });
  const clean = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
  const initialHistory = new HistoryRepository(clean, 1, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  await initialHistory.store(DOCUMENT_ID, "older", new Date("2026-07-14T08:09:09.000Z"));

  const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
  const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing), { crashAt });
  const history = new HistoryRepository(vault, 1, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  const prepared = await history.prepare(
    DOCUMENT_ID,
    oldPair.html,
    new Date("2026-07-14T08:09:10.000Z")
  );
  const plan = await history.plan(prepared);
  const observed = (await vault.readPair(PATHS))!;
  crashAt.add(point);
  return { oldPair, nextPair, backing, vault, history, prepared, plan, observed };
}

async function historyFixture(point: ObsidianWorkbenchCrashPoint) {
  const backing = new PersistentObsidianBacking();
  const clean = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
  const initial = new HistoryRepository(clean, 1, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  await initial.store(DOCUMENT_ID, "older", new Date("2026-07-14T08:09:09.000Z"));
  const crashAt = new Set<ObsidianWorkbenchCrashPoint>();
  const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing), { crashAt });
  const history = new HistoryRepository(vault, 1, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  const prepared = await history.prepare(
    DOCUMENT_ID,
    "newer",
    new Date("2026-07-14T08:09:10.000Z")
  );
  const plan = await history.plan(prepared);
  crashAt.add(point);
  return { backing, vault, plan };
}

async function completedCombinedFixture(
  seedCount: number,
  liveHooks: PersistentObsidianHooks = {}
) {
  const oldPair = await pair("old");
  const nextPair = await pair("next");
  const unrelatedPair = await pair("unrelated");
  const backing = new PersistentObsidianBacking({
    [PATHS.html]: oldPair.html,
    [PATHS.sidecar]: oldPair.sidecarJson,
    [UNRELATED_PATHS.html]: unrelatedPair.html,
    [UNRELATED_PATHS.sidecar]: unrelatedPair.sidecarJson
  });
  const seedingVault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
  const seedingHistory = new HistoryRepository(seedingVault, 20, {
    randomUUID: () => "623e4567-e89b-42d3-a456-426614174000"
  });
  for (let index = 0; index < seedCount; index += 1) {
    await seedingHistory.store(
      DOCUMENT_ID,
      `seed-${index}`,
      new Date(Date.parse("2026-07-14T08:09:00.000Z") + index)
    );
  }

  const vault = new ObsidianWorkbenchVault(
    persistentObsidianVault(backing, liveHooks)
  );
  const history = new HistoryRepository(vault, 20, {
    randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
  });
  const prepared = await history.prepare(
    DOCUMENT_ID,
    oldPair.html,
    new Date("2026-07-14T08:10:00.000Z")
  );
  const plan = await history.plan(prepared);
  const observed = (await vault.readPair(PATHS))!;
  return {
    oldPair,
    nextPair,
    unrelatedPair,
    backing,
    vault,
    history,
    prepared,
    plan,
    observed
  };
}

function transactionProofFiles(backing: PersistentObsidianBacking): string[] {
  return backing.paths().filter(
    (path) =>
      path.startsWith(".galley/transactions/") &&
      (path.endsWith(".json") || path.endsWith(".txt") || path.endsWith(".lock"))
  );
}

async function pair(body: string): Promise<{ html: string; sidecarJson: string }> {
  const html = GalleyDocumentCodec.serialize({
    doctype: "<!DOCTYPE html>",
    lang: "zh-CN",
    headHtml: '<meta charset="utf-8"><title>Article</title>',
    bodyHtml: `<article><p>${body}</p></article>`
  });
  return {
    html,
    sidecarJson: `${JSON.stringify({
      schemaVersion: 1,
      documentId: "123e4567-e89b-42d3-a456-426614174000",
      sourcePath: "notes/article.md",
      sourceHash: await sha256Text("# source\n"),
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
    })}\n`
  };
}
