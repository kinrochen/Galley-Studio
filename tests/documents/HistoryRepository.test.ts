import { describe, expect, it } from "vitest";

import { HistoryRepository } from "../../src/documents/HistoryRepository";
import {
  memoryHistoryVault,
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

  it("rolls back the newly recognized snapshot when pruning fails", async () => {
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

    expect((await repository.list(DOCUMENT_ID)).map(({ html }) => html)).toEqual([
      "old"
    ]);
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
  });

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

  it("converges to exactly twenty across two repositories after a concrete stale remove", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const vault = memoryHistoryVault({}, hooks);
    const seed = new HistoryRepository(vault, 20);
    for (let index = 0; index < 20; index += 1) {
      await seed.store(
        DOCUMENT_ID,
        `seed-${index}`,
        new Date(1_700_000_000_000 + index)
      );
    }

    const firstRemoveEntered = deferred<void>();
    const secondRemoveEntered = deferred<void>();
    let removeCalls = 0;
    hooks.beforeHistoryRemove = async () => {
      removeCalls += 1;
      if (removeCalls === 1) {
        firstRemoveEntered.resolve();
        await secondRemoveEntered.promise;
      } else if (removeCalls === 2) {
        await firstRemoveEntered.promise;
        secondRemoveEntered.resolve();
      }
    };
    const repositoryA = new HistoryRepository(vault, 20);
    const repositoryB = new HistoryRepository(vault, 20);

    await Promise.all([
      repositoryA.store(DOCUMENT_ID, "concurrent-a", new Date(1_800_000_000_000)),
      repositoryB.store(DOCUMENT_ID, "concurrent-b", new Date(1_800_000_000_001))
    ]);

    delete hooks.beforeHistoryRemove;
    const snapshots = await repositoryA.list(DOCUMENT_ID);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.map(({ html }) => html)).toEqual(
      expect.arrayContaining(["concurrent-a", "concurrent-b"])
    );
    expect(vault.paths().some((path) => path.endsWith(".pending"))).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
