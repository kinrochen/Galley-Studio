import { describe, expect, it } from "vitest";

import { HistoryRepository } from "../../src/documents/HistoryRepository";
import {
  MemoryWorkbenchVault,
  memoryHistoryVault,
  type MemoryFaultStage,
  type MemoryWorkbenchHooks
} from "../support/workbenchFixtures";

const DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("HistoryRepository", () => {
  it("retains the newest twenty snapshots in deterministic oldest-first order", async () => {
    const repository = new HistoryRepository(memoryHistoryVault(), 20);

    for (let index = 0; index < 22; index += 1) {
      await repository.store(
        DOCUMENT_ID,
        `v${index}`,
        new Date(`2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`)
      );
    }

    const snapshots = await repository.list(DOCUMENT_ID);
    expect(snapshots.map(({ html }) => html)).toEqual(
      Array.from({ length: 20 }, (_, index) => `v${index + 2}`)
    );
    expect(snapshots.map(({ timestamp }) => timestamp)).toEqual(
      [...snapshots.map(({ timestamp }) => timestamp)].sort()
    );
  });

  it("creates unique same-timestamp snapshots under concurrent stores without overwrite", async () => {
    const vault = memoryHistoryVault();
    const repository = new HistoryRepository(vault, 30, {
      randomUUID: () => "423e4567-e89b-42d3-a456-426614174000"
    });
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        repository.store(DOCUMENT_ID, `concurrent-${index}`, timestamp)
      )
    );

    const snapshots = await repository.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(25);
    expect(new Set(snapshots.map(({ path }) => path)).size).toBe(25);
    expect(new Set(snapshots.map(({ html }) => html).values()).size).toBe(25);
    expect(snapshots.map(({ path }) => path)).toEqual(
      [...snapshots.map(({ path }) => path)].sort()
    );
  });

  it("retains exactly twenty after concurrent same-timestamp stores", async () => {
    const repository = new HistoryRepository(memoryHistoryVault(), 20);
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        repository.store(DOCUMENT_ID, `version-${index}`, timestamp)
      )
    );

    const snapshots = await repository.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(20);
    expect(new Set(snapshots.map(({ path }) => path)).size).toBe(20);
  });

  it.each([
    "../escape",
    "notes/id",
    "123e4567-e89b-42d3-a456-426614174000/../../escape",
    "not-a-uuid",
    ""
  ])("rejects unsafe document id %j before touching the vault", async (id) => {
    const vault = memoryHistoryVault();
    const repository = new HistoryRepository(vault);

    await expect(repository.store(id, "unsafe", new Date())).rejects.toThrow(
      /document id/i
    );
    await expect(repository.list(id)).rejects.toThrow(/document id/i);
    expect(vault.paths()).toEqual([]);
  });

  it.each([
    "123E4567-E89B-42D3-A456-426614174000",
    "01890f8e-7b6d-7cc0-98c4-dc0c0c07398f",
    "01890f8e-7b6d-8cc0-98c4-dc0c0c07398f",
    "00000000-0000-0000-0000-000000000000"
  ])("accepts and safely canonicalizes sidecar-valid UUID %s", async (id) => {
    const vault = memoryHistoryVault();
    const repository = new HistoryRepository(vault);

    await repository.store(id, "valid", new Date("2026-01-01T00:00:00.000Z"));

    expect((await repository.list(id)).map(({ html }) => html)).toEqual([
      "valid"
    ]);
    expect(vault.paths()).toHaveLength(1);
    expect(vault.paths()[0]).toContain(`/${id.toLowerCase()}/`);
  });

  it("keeps prepared history provisional and removes it on rollback", async () => {
    const vault = memoryHistoryVault();
    const repository = new HistoryRepository(vault);

    const prepared = await repository.prepare(
      DOCUMENT_ID,
      "pending",
      new Date("2026-01-01T00:00:00.000Z")
    );
    expect(await repository.list(DOCUMENT_ID)).toEqual([]);
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(true);

    await repository.rollback(prepared);

    expect(await repository.list(DOCUMENT_ID)).toEqual([]);
    expect(vault.paths()).toEqual([]);
  });

  it.each(["failure", "crash"] as const)(
    "retries promotion idempotently after a post-mutation %s",
    async (mode) => {
      const hooks: MemoryWorkbenchHooks = {};
      hooks[mode === "crash" ? "crashStages" : "faultStages"] = new Set<
        MemoryFaultStage
      >(["history_after_promotion"]);
      const vault = memoryHistoryVault({}, hooks);
      const repository = new HistoryRepository(vault);
      const prepared = await repository.prepare(
        DOCUMENT_ID,
        "prior version",
        new Date("2026-01-01T00:00:00.000Z")
      );

      await expect(repository.commit(prepared)).rejects.toThrow(
        "history_after_promotion"
      );
      expect(vault.journalCount()).toBe(1);
      hooks.crashStages = new Set();
      hooks.faultStages = new Set();

      const committed = await repository.commit(prepared);
      expect(committed.html).toBe("prior version");
      expect(
        (await repository.list(DOCUMENT_ID)).map(({ html }) => html)
      ).toEqual(["prior version"]);
      expect(vault.journalCount()).toBe(0);
    }
  );

  it("recovers post-promotion state through a recreated adapter", async () => {
    const vault = memoryHistoryVault({}, {
      crashStages: new Set<MemoryFaultStage>(["history_after_promotion"])
    });
    const repository = new HistoryRepository(vault);
    const prepared = await repository.prepare(
      DOCUMENT_ID,
      "recover on reopen",
      new Date("2026-01-01T00:00:00.000Z")
    );
    await expect(repository.commit(prepared)).rejects.toMatchObject({
      name: "MemoryCrashError"
    });

    vault.destroy();
    const reopened = MemoryWorkbenchVault.reopen(vault.backing);
    expect(
      (await new HistoryRepository(reopened).list(DOCUMENT_ID)).map(
        ({ html }) => html
      )
    ).toEqual(["recover on reopen"]);
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
    expect(vault.journalCount()).toBe(0);
  });

  it("keeps a failed history-recovery journal for a later clean reopen", async () => {
    const vault = memoryHistoryVault({}, {
      crashStages: new Set<MemoryFaultStage>(["history_after_promotion"])
    });
    const repository = new HistoryRepository(vault);
    const prepared = await repository.prepare(
      DOCUMENT_ID,
      "retry recovery",
      new Date("2026-01-01T00:00:00.000Z")
    );
    await expect(repository.commit(prepared)).rejects.toMatchObject({
      name: "MemoryCrashError"
    });

    vault.destroy();
    const failedRecovery = MemoryWorkbenchVault.reopen(vault.backing, {
      faultStages: new Set<MemoryFaultStage>(["history_recovery_start"])
    });
    await expect(
      new HistoryRepository(failedRecovery).list(DOCUMENT_ID)
    ).rejects.toThrow("history_recovery_start");
    expect(vault.journalCount()).toBe(1);

    failedRecovery.destroy();
    const successfulRecovery = MemoryWorkbenchVault.reopen(vault.backing);
    expect(
      (await new HistoryRepository(successfulRecovery).list(DOCUMENT_ID)).map(
        ({ html }) => html
      )
    ).toEqual(["retry recovery"]);
    expect(vault.journalCount()).toBe(0);
  });

  it.each([
    "history_rollback_before_remove",
    "history_rollback_after_remove"
  ] as const)(
    "recovers a rollback throw at %s on the next adapter instance",
    async (stage) => {
      const vault = memoryHistoryVault({}, {
        faultStages: new Set<MemoryFaultStage>([stage])
      });
      const repository = new HistoryRepository(vault);
      const prepared = await repository.prepare(
        DOCUMENT_ID,
        "orphan pending",
        new Date("2026-01-01T00:00:00.000Z")
      );

      await expect(repository.rollback(prepared)).rejects.toThrow(stage);
      expect(vault.journalCount()).toBe(1);
      expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(
        stage === "history_rollback_before_remove"
      );

      vault.destroy();
      const reopened = MemoryWorkbenchVault.reopen(vault.backing);
      expect(await new HistoryRepository(reopened).list(DOCUMENT_ID)).toEqual(
        []
      );
      expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(
        false
      );
      expect(vault.journalCount()).toBe(0);
    }
  );

  it("rolls back a queued preparation when its signal aborts while waiting", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const vault = memoryHistoryVault({}, hooks);
    const repository = new HistoryRepository(vault, 1);
    await repository.store(
      DOCUMENT_ID,
      "seed",
      new Date("2026-01-01T00:00:00.000Z")
    );
    const first = await repository.prepare(
      DOCUMENT_ID,
      "first",
      new Date("2026-01-01T00:00:01.000Z")
    );
    const second = await repository.prepare(
      DOCUMENT_ID,
      "second",
      new Date("2026-01-01T00:00:02.000Z")
    );
    const entered = deferred<void>();
    const release = deferred<void>();
    hooks.beforeHistoryRemove = async () => {
      delete hooks.beforeHistoryRemove;
      entered.resolve();
      await release.promise;
    };
    const firstCommit = repository.commit(first);
    await entered.promise;
    const controller = new AbortController();
    const secondCommit = repository.commit(second, controller.signal);
    controller.abort();
    release.resolve();

    await firstCommit;
    await expect(secondCommit).rejects.toMatchObject({ name: "AbortError" });
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
    expect((await repository.list(DOCUMENT_ID)).map(({ html }) => html)).toEqual([
      "first"
    ]);
  });

  it("ignores and preserves malformed or unrelated files while pruning snapshots", async () => {
    const vault = memoryHistoryVault({
      ".galley/history/unrelated.txt": "unrelated",
      [`.galley/history/${DOCUMENT_ID}/README.md`]: "keep me",
      [`.galley/history/${DOCUMENT_ID}/not-a-snapshot.html`]: "malformed"
    });
    const repository = new HistoryRepository(vault, 2);

    await repository.store(
      DOCUMENT_ID,
      "one",
      new Date("2026-01-01T00:00:00.000Z")
    );
    await repository.store(
      DOCUMENT_ID,
      "two",
      new Date("2026-01-01T00:00:01.000Z")
    );
    await repository.store(
      DOCUMENT_ID,
      "three",
      new Date("2026-01-01T00:00:02.000Z")
    );

    expect((await repository.list(DOCUMENT_ID)).map(({ html }) => html)).toEqual([
      "two",
      "three"
    ]);
    expect(vault.read(`.galley/history/${DOCUMENT_ID}/README.md`)).toBe(
      "keep me"
    );
    expect(
      vault.read(`.galley/history/${DOCUMENT_ID}/not-a-snapshot.html`)
    ).toBe("malformed");
    expect(vault.read(".galley/history/unrelated.txt")).toBe("unrelated");
  });

  it("recovers the newest snapshot transaction when pruning throws", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const vault = memoryHistoryVault({}, hooks);
    const repository = new HistoryRepository(vault, 1);
    await repository.store(
      DOCUMENT_ID,
      "old",
      new Date("2026-01-01T00:00:00.000Z")
    );
    hooks.failHistoryRemove = true;

    await expect(
      repository.store(
        DOCUMENT_ID,
        "new",
        new Date("2026-01-01T00:00:01.000Z")
      )
    ).rejects.toThrow("injected history prune failure");

    hooks.failHistoryRemove = false;
    expect((await repository.list(DOCUMENT_ID)).map(({ html }) => html)).toEqual([
      "new"
    ]);
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
  });

  it.each(["failure", "crash"] as const)(
    "replays a multi-delete plan after one deletion %s to exact newest-twenty retention",
    async (mode) => {
      const hooks: MemoryWorkbenchHooks = {};
      const vault = memoryHistoryVault({}, hooks);
      const seedRepository = new HistoryRepository(vault, 30);
      for (let index = 0; index < 21; index += 1) {
        await seedRepository.store(
          DOCUMENT_ID,
          `seed-${index}`,
          new Date(1_700_000_000_000 + index)
        );
      }
      hooks[mode === "crash" ? "crashStages" : "faultStages"] = new Set<
        MemoryFaultStage
      >(["history_after_remove"]);
      const repository = new HistoryRepository(vault, 20);

      await expect(
        repository.store(
          DOCUMENT_ID,
          "newest",
          new Date(1_800_000_000_000)
        )
      ).rejects.toThrow("history_after_remove");
      expect(
        vault
          .paths()
          .filter((path) => path.endsWith(".html"))
      ).toHaveLength(21);
      expect(vault.journalCount()).toBe(1);

      vault.destroy();
      const reopened = MemoryWorkbenchVault.reopen(vault.backing);
      const retained = await new HistoryRepository(reopened, 20).list(
        DOCUMENT_ID
      );
      expect(retained).toHaveLength(20);
      expect(retained.map(({ html }) => html)).toEqual([
        ...Array.from({ length: 19 }, (_, index) => `seed-${index + 2}`),
        "newest"
      ]);
      expect(vault.journalCount()).toBe(0);
    }
  );

  it("preserves an ABA replacement when conditional pruning loses ownership", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const vault = memoryHistoryVault({}, hooks);
    const repository = new HistoryRepository(vault, 1);
    const old = await repository.store(
      DOCUMENT_ID,
      "owned old",
      new Date("2026-01-01T00:00:00.000Z")
    );
    hooks.beforeHistoryRemove = (file) => {
      delete hooks.beforeHistoryRemove;
      vault.writeExternally(file.path, "external replacement");
    };

    await expect(
      repository.store(
        DOCUMENT_ID,
        "new",
        new Date("2026-01-01T00:00:01.000Z")
      )
    ).rejects.toMatchObject({ code: "history_prune_conflict" });

    expect(vault.read(old.path)).toBe("external replacement");
  });

  it("propagates an already-aborted store without creating a snapshot", async () => {
    const vault = memoryHistoryVault();
    const repository = new HistoryRepository(vault);
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.store(DOCUMENT_ID, "nope", new Date(), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(vault.paths()).toEqual([]);
  });

  it("converges to exactly twenty across two repositories sharing durable backing", async () => {
    const vault = memoryHistoryVault();
    const seed = new HistoryRepository(vault, 20);
    for (let index = 0; index < 20; index += 1) {
      await seed.store(
        DOCUMENT_ID,
        `seed-${index}`,
        new Date(1_700_000_000_000 + index)
      );
    }

    const repositoryA = new HistoryRepository(vault, 20);
    const repositoryB = new HistoryRepository(
      MemoryWorkbenchVault.reopen(vault.backing),
      20
    );

    await Promise.all([
      repositoryA.store(DOCUMENT_ID, "concurrent-a", new Date(1_800_000_000_000)),
      repositoryB.store(DOCUMENT_ID, "concurrent-b", new Date(1_800_000_000_001))
    ]);

    const snapshots = await repositoryA.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.map(({ html }) => html)).toEqual(
      expect.arrayContaining(["concurrent-a", "concurrent-b"])
    );
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
  });

  it("does not exceed twenty when two adapters race from nineteen", async () => {
    const vaultA = memoryHistoryVault();
    const seed = new HistoryRepository(vaultA, 20);
    for (let index = 0; index < 19; index += 1) {
      await seed.store(
        DOCUMENT_ID,
        `seed-${index}`,
        new Date(1_700_000_000_000 + index)
      );
    }
    const vaultB = MemoryWorkbenchVault.reopen(vaultA.backing);
    const repositoryA = new HistoryRepository(vaultA, 20);
    const repositoryB = new HistoryRepository(vaultB, 20);

    await Promise.all([
      repositoryA.store(DOCUMENT_ID, "racer-a", new Date(1_800_000_000_000)),
      repositoryB.store(DOCUMENT_ID, "racer-b", new Date(1_800_000_000_001))
    ]);

    const snapshots = await repositoryA.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.map(({ html }) => html)).toEqual(
      expect.arrayContaining(["racer-a", "racer-b"])
    );
    expect(vaultA.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
