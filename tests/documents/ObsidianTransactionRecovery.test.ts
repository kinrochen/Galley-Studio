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
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";

const PATHS = {
  html: "notes/article.galley.html",
  sidecar: "notes/article.galley.json"
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
      const committed = ["after-commit", "after-receipt", "after-completed"].includes(point);
      if (committed) {
        await expect(reopened.readPair(PATHS)).resolves.toMatchObject(contents);
      } else {
        await expect(reopened.readPair(PATHS)).resolves.toBeNull();
      }
      expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
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
    expect(backing.read(PATHS.sidecar)).toBeNull();
    expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
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
      const snapshots = await new HistoryRepository(reopened, 1).list(DOCUMENT_ID);
      const committed = ["after-commit", "after-receipt", "after-completed"].includes(point);
      expect(snapshots.map(({ html }) => html)).toEqual([
        committed ? "newer" : "older"
      ]);
      expect(
        fixture.backing.paths().some((path) => path.includes(".history-scope.galley"))
      ).toBe(false);
    });
  }

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
