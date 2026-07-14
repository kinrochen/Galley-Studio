import { describe, expect, it } from "vitest";

import {
  ObsidianVaultFileStore,
  VaultFileReadUnstableError
} from "../../src/documents/ObsidianVaultFileStore";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";

describe("ObsidianVaultFileStore", () => {
  it("returns one stable exact observation and retries an identity swap", async () => {
    const backing = new PersistentObsidianBacking({ "notes/a.txt": "old" });
    let swapped = false;
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterRead(path) {
          if (!swapped) {
            swapped = true;
            backing.replace(path, "new", { preserveStat: true });
          }
        }
      })
    );
    await expect(store.readTextStable("notes/a.txt")).resolves.toMatchObject({
      path: "notes/a.txt",
      text: "new",
      byteLength: 3
    });
  });

  it("detects same-stat byte changes and repeated churn without a torn read", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "aaa" });
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterRead(path) {
          backing.replace(path, backing.read(path) === "aaa" ? "bbb" : "aaa", {
            sameIdentity: true,
            preserveStat: true
          });
        }
      }),
      { maxReadAttempts: 3 }
    );
    await expect(store.readTextStable("a.txt")).rejects.toBeInstanceOf(
      VaultFileReadUnstableError
    );
  });

  it("retries a one-time same-identity byte change even when stat evidence is unchanged", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "aaa" });
    let changed = false;
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterRead(path) {
          if (changed) return;
          changed = true;
          backing.replace(path, "bbb", { sameIdentity: true, preserveStat: true });
        }
      })
    );
    await expect(store.readTextStable("a.txt")).resolves.toMatchObject({
      text: "bbb",
      byteLength: 3
    });
  });

  it.each(["", "/a", "a\\b", "../a", "a/./b", "a//b", "https://x", "a\0b", "e\u0301.txt"])(
    "rejects a non-canonical public path %j",
    async (path) => {
      const store = new ObsidianVaultFileStore(persistentObsidianVault());
      await expect(store.readTextStable(path)).rejects.toMatchObject({
        code: "vault_path_invalid"
      });
    }
  );

  it("uses exclusive create and reports collisions", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "external" });
    const store = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    await expect(store.createExclusive("a.txt", "mine")).resolves.toEqual({
      status: "collision"
    });
    expect(backing.read("a.txt")).toBe("external");
  });

  it("conditionally modifies and removes only exact owned identity and bytes", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "one" });
    const store = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const observed = await store.readTextStable("a.txt");
    expect(observed).not.toBeNull();
    backing.replace("a.txt", "one");
    await expect(store.modifyOwned(observed!, "two")).resolves.toEqual({
      status: "conflict"
    });
    await expect(store.removeOwned(observed!)).resolves.toEqual({
      status: "conflict"
    });
    expect(backing.read("a.txt")).toBe("one");
  });

  it("returns fresh exact ownership after modify and removes that ownership", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "one" });
    const store = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const observed = (await store.readTextStable("a.txt"))!;
    const modified = await store.modifyOwned(observed, "two");
    expect(modified).toMatchObject({ status: "modified", file: { text: "two" } });
    if (modified.status !== "modified") throw new Error("expected modified");
    await expect(store.removeOwned(modified.file)).resolves.toEqual({ status: "removed" });
    expect(backing.read("a.txt")).toBeNull();
  });

  it("classifies a throw and abort after a possible write as ambiguous", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "one" });
    const controller = new AbortController();
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterModify() {
          controller.abort();
          throw new Error("after mutation");
        }
      })
    );
    const observed = (await store.readTextStable("a.txt"))!;
    await expect(
      store.modifyOwned(observed, "two", controller.signal)
    ).resolves.toMatchObject({ status: "ambiguous", aborted: true });
    expect(backing.read("a.txt")).toBe("two");
  });

  it("checks abort before mutation without touching the file", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "one" });
    const store = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const observed = (await store.readTextStable("a.txt"))!;
    const controller = new AbortController();
    controller.abort();
    await expect(store.modifyOwned(observed, "two", controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(backing.read("a.txt")).toBe("one");
  });

  it("classifies abort after exclusive create as ambiguous ownership", async () => {
    const backing = new PersistentObsidianBacking();
    const controller = new AbortController();
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterCreate() {
          controller.abort();
        }
      })
    );
    await expect(store.createExclusive("a.txt", "mine", controller.signal)).resolves.toMatchObject({
      status: "ambiguous",
      operation: "create",
      outcome: "applied",
      aborted: true
    });
  });

  it("classifies abort after owned removal as ambiguous rather than precommit", async () => {
    const backing = new PersistentObsidianBacking({ "a.txt": "mine" });
    const controller = new AbortController();
    const store = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterDelete() {
          controller.abort();
        }
      })
    );
    const owned = (await store.readTextStable("a.txt"))!;
    await expect(store.removeOwned(owned, controller.signal)).resolves.toMatchObject({
      status: "ambiguous",
      operation: "remove",
      outcome: "applied",
      aborted: true
    });
  });

  it("shares durable writes across independently recreated stores", async () => {
    const backing = new PersistentObsidianBacking();
    const first = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const second = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    expect((await first.createExclusive("a.txt", "durable")).status).toBe("created");
    await expect(second.readTextStable("a.txt")).resolves.toMatchObject({
      text: "durable"
    });
  });

  it("creates folders recursively, tolerates existing folders, and rejects file components", async () => {
    const backing = new PersistentObsidianBacking();
    const store = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    await store.ensureFolder(".galley/transactions/id");
    await store.ensureFolder(".galley/transactions/id");
    expect((await store.list(".galley/transactions")).map((entry) => entry.path)).toEqual([
      ".galley/transactions/id"
    ]);
    await store.createExclusive("blocked", "file");
    await expect(store.ensureFolder("blocked/child")).rejects.toMatchObject({
      code: "vault_folder_conflict"
    });
  });
});
