import { describe, expect, it } from "vitest";

import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import { DocumentSession } from "../../src/documents/DocumentSession";
import { GalleyDocumentRepository } from "../../src/documents/GalleyDocumentRepository";
import { sha256Text } from "../../src/documents/GalleySidecar";
import { HistoryRepository } from "../../src/documents/HistoryRepository";
import {
  ObsidianWorkbenchVault,
  type ObsidianPairObservation
} from "../../src/documents/ObsidianWorkbenchVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";

const PATHS = {
  html: "notes/article.galley.html",
  sidecar: "notes/article.galley.json"
} as const;

describe("ObsidianWorkbenchVault", () => {
  it("reads and replaces one exact pair without accepting a cloned observation", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing), {
      randomUUID: () => "423e4567-e89b-42d3-a456-426614174000"
    });

    const observed = await vault.readPair(PATHS);
    expect(observed?.html).toBe(oldPair.html);
    const cloned = structuredClone(observed!.observation) as ObsidianPairObservation;
    await expect(
      vault.replacePairTransactional(PATHS, cloned, nextPair)
    ).rejects.toMatchObject({ code: "workbench_handle_untrusted" });

    await expect(
      vault.replacePairTransactional(PATHS, observed!.observation, nextPair)
    ).resolves.toMatchObject({ status: "committed" });
    expect(backing.read(PATHS.html)).toBe(nextPair.html);
    expect(backing.read(PATHS.sidecar)).toBe(nextPair.sidecarJson);
  });

  it("rejects foreign, stale, and wrong-path pair handles", async () => {
    const oldPair = await pair("old");
    const nextPair = await pair("next");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const first = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const second = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const observed = (await first.readPair(PATHS))!;
    const foreign = (await second.readPair(PATHS))!;

    await expect(
      first.replacePairTransactional(PATHS, foreign.observation, nextPair)
    ).rejects.toMatchObject({ code: "workbench_handle_untrusted" });
    await expect(
      first.replacePairTransactional(
        { html: "notes/other.galley.html", sidecar: "notes/other.galley.json" },
        observed.observation,
        nextPair
      )
    ).rejects.toMatchObject({ code: "workbench_handle_untrusted" });
    backing.replace(PATHS.html, oldPair.html);
    await expect(
      first.replacePairTransactional(PATHS, observed.observation, nextPair)
    ).resolves.toEqual({ status: "conflict" });
  });

  it("creates a pair exclusively and cleans only its exact owned members", async () => {
    const contents = await pair("copy");
    const backing = new PersistentObsidianBacking();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const created = await vault.createPairTransactional(PATHS, contents);
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("expected created pair");

    await vault.cleanupCreatedMembers(created.ownership);
    expect(backing.read(PATHS.html)).toBeNull();
    expect(backing.read(PATHS.sidecar)).toBeNull();
    expect(backing.paths().filter((path) => path.includes("/.galley"))).toEqual([]);
  });

  it("preserves an externally replaced created member during owned cleanup", async () => {
    const contents = await pair("copy");
    const backing = new PersistentObsidianBacking();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const created = await vault.createPairTransactional(PATHS, contents);
    if (created.status !== "created") throw new Error("expected created pair");
    backing.replace(PATHS.html, "external");

    await expect(vault.cleanupCreatedMembers(created.ownership)).rejects.toMatchObject({
      code: "workbench_handle_untrusted"
    });
    expect(backing.read(PATHS.html)).toBe("external");
    expect(backing.read(PATHS.sidecar)).toBe(contents.sidecarJson);
  });

  it("lets only one of two adapters win the same exact pair CAS", async () => {
    const oldPair = await pair("old");
    const firstPair = await pair("first");
    const secondPair = await pair("second");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    const first = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const second = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const firstObserved = (await first.readPair(PATHS))!;
    const secondObserved = (await second.readPair(PATHS))!;

    await expect(
      first.replacePairTransactional(PATHS, firstObserved.observation, firstPair)
    ).resolves.toMatchObject({ status: "committed" });
    await expect(
      second.replacePairTransactional(PATHS, secondObserved.observation, secondPair)
    ).resolves.toEqual({ status: "conflict" });
    expect(backing.read(PATHS.html)).toBe(firstPair.html);
    expect(backing.read(PATHS.sidecar)).toBe(firstPair.sidecarJson);
  });

  it("uses a durable scope lock so simultaneous adapters yield one commit and one conflict", async () => {
    const oldPair = await pair("old");
    const firstPair = await pair("first");
    const secondPair = await pair("second");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson
    });
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const options = {
      async onCrashPoint(point: string) {
        if (point !== "after-intent") return;
        arrived += 1;
        if (arrived === 2) release();
        await gate;
      }
    };
    const first = new ObsidianWorkbenchVault(persistentObsidianVault(backing), options);
    const second = new ObsidianWorkbenchVault(persistentObsidianVault(backing), options);
    const firstObserved = (await first.readPair(PATHS))!;
    const secondObserved = (await second.readPair(PATHS))!;

    const results = await Promise.all([
      first.replacePairTransactional(PATHS, firstObserved.observation, firstPair),
      second.replacePairTransactional(PATHS, secondObserved.observation, secondPair)
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["committed", "conflict"]);
    const winner = results[0]!.status === "committed" ? firstPair : secondPair;
    expect(backing.read(PATHS.html)).toBe(winner.html);
    expect(backing.read(PATHS.sidecar)).toBe(winner.sidecarJson);
    expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
  });

  it("implements real HistoryRepository retention with exactly twenty snapshots", async () => {
    const backing = new PersistentObsidianBacking();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const timestamp = new Date("2026-07-14T08:09:10.123Z");
    for (let index = 0; index < 22; index += 1) {
      await history.store("123e4567-e89b-42d3-a456-426614174000", `v${index}`, timestamp);
    }

    const snapshots = await history.list("123e4567-e89b-42d3-a456-426614174000");
    expect(snapshots.map(({ html }) => html)).toEqual(
      Array.from({ length: 20 }, (_, index) => `v${index + 2}`)
    );
    expect(
      backing.paths().filter((path) => path.includes("/.galley/transactions/"))
    ).toEqual([]);
  });

  it("replans concurrent history stores across two adapters without lost snapshots", async () => {
    const backing = new PersistentObsidianBacking();
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const options = {
      async onCrashPoint(point: string) {
        if (point !== "after-intent" || arrived >= 2) return;
        arrived += 1;
        if (arrived === 2) release();
        await gate;
      }
    };
    const firstVault = new ObsidianWorkbenchVault(
      persistentObsidianVault(backing),
      options
    );
    const secondVault = new ObsidianWorkbenchVault(
      persistentObsidianVault(backing),
      options
    );
    const first = new HistoryRepository(firstVault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const second = new HistoryRepository(secondVault, 20, {
      randomUUID: () => "423e4567-e89b-42d3-a456-426614174000"
    });
    const timestamp = new Date("2026-07-14T08:09:10.123Z");

    await Promise.all([
      first.store("123e4567-e89b-42d3-a456-426614174000", "first", timestamp),
      second.store("123e4567-e89b-42d3-a456-426614174000", "second", timestamp)
    ]);
    const listed = await new HistoryRepository(
      new ObsidianWorkbenchVault(persistentObsidianVault(backing))
    ).list("123e4567-e89b-42d3-a456-426614174000");
    expect(listed.map(({ html }) => html).sort()).toEqual(["first", "second"]);
    expect(backing.paths().filter((path) => path.endsWith(".lock"))).toEqual([]);
  });

  it("returns only validated final and owned pending history files", async () => {
    const backing = new PersistentObsidianBacking();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const history = new HistoryRepository(vault, 20, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    const prepared = await history.prepare(
      "123e4567-e89b-42d3-a456-426614174000",
      "pending",
      new Date("2026-07-14T08:09:10.123Z")
    );
    const folder = ".galley/history/123e4567-e89b-42d3-a456-426614174000";
    backing.replace(`${folder}/unexpected.txt`, "preserve");

    const listed = await vault.listFiles(folder);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.html).toBe("pending");
    const plan = await history.plan(prepared);
    await expect(
      vault.applyRetentionTransaction(
        plan.provisional,
        plan.finalPath,
        plan.observedFiles,
        plan.removals
      )
    ).resolves.toEqual({ status: "conflict" });
    expect(backing.read(`${folder}/unexpected.txt`)).toBe("preserve");
  });

  it("preserves provisional replacements, final collisions, and prune-candidate ABA", async () => {
    const backing = new PersistentObsidianBacking();
    const vault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const history = new HistoryRepository(vault, 1, {
      randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
    });
    await history.store(
      "123e4567-e89b-42d3-a456-426614174000",
      "older",
      new Date("2026-07-14T08:09:09.000Z")
    );

    const replaced = await history.prepare(
      "123e4567-e89b-42d3-a456-426614174000",
      "newer",
      new Date("2026-07-14T08:09:10.000Z")
    );
    const replacedPlan = await history.plan(replaced);
    backing.replace(replacedPlan.provisional.path, "external");
    await expect(
      vault.applyRetentionTransaction(
        replacedPlan.provisional,
        replacedPlan.finalPath,
        replacedPlan.observedFiles,
        replacedPlan.removals
      )
    ).resolves.toEqual({ status: "lost" });
    expect(backing.read(replacedPlan.provisional.path)).toBe("external");

    const collision = await history.prepare(
      "123e4567-e89b-42d3-a456-426614174000",
      "collision",
      new Date("2026-07-14T08:09:11.000Z")
    );
    const collisionPlan = await history.plan(collision);
    backing.replace(collisionPlan.finalPath, "external-final");
    await expect(
      vault.applyRetentionTransaction(
        collisionPlan.provisional,
        collisionPlan.finalPath,
        collisionPlan.observedFiles,
        collisionPlan.removals
      )
    ).resolves.toEqual({ status: "collision" });
    expect(backing.read(collisionPlan.finalPath)).toBe("external-final");

    backing.remove(replacedPlan.provisional.path);
    backing.remove(collisionPlan.finalPath);
    await history.rollback(collision);
    const pruning = await history.prepare(
      "123e4567-e89b-42d3-a456-426614174000",
      "latest",
      new Date("2026-07-14T08:09:12.000Z")
    );
    const pruningPlan = await history.plan(pruning);
    const candidate = pruningPlan.removals[0]!;
    backing.replace(candidate.path, candidate.html);
    await expect(
      vault.applyRetentionTransaction(
        pruningPlan.provisional,
        pruningPlan.finalPath,
        pruningPlan.observedFiles,
        pruningPlan.removals
      )
    ).resolves.toEqual({ status: "conflict" });
    expect(backing.read(candidate.path)).toBe(candidate.html);
  });

  it("saves and reopens a real DocumentSession with exact prior HTML in history", async () => {
    const oldPair = await pair("old");
    const backing = new PersistentObsidianBacking({
      [PATHS.html]: oldPair.html,
      [PATHS.sidecar]: oldPair.sidecarJson,
      "notes/article.md": "# source\n"
    });
    const firstVault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const session = await DocumentSession.open({
      repository: new GalleyDocumentRepository(firstVault),
      history: new HistoryRepository(firstVault, 20, {
        randomUUID: () => "323e4567-e89b-42d3-a456-426614174000"
      }),
      htmlPath: PATHS.html,
      sidecarPath: PATHS.sidecar,
      now: () => new Date("2026-07-14T08:09:10.123Z")
    });
    session.updateBody("<article><p>edited</p></article>");
    await session.save("explicit");

    const reopenedVault = new ObsidianWorkbenchVault(persistentObsidianVault(backing));
    const reopened = await DocumentSession.open({
      repository: new GalleyDocumentRepository(reopenedVault),
      history: new HistoryRepository(reopenedVault),
      htmlPath: PATHS.html,
      sidecarPath: PATHS.sidecar
    });
    expect(reopened.bodyHtml()).toContain("edited");
    const history = await new HistoryRepository(reopenedVault).list(
      "123e4567-e89b-42d3-a456-426614174000"
    );
    expect(history.map(({ html }) => html)).toEqual([oldPair.html]);
  });
});

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
