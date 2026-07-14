import { describe, expect, it } from "vitest";

import { sha256Text } from "../../src/documents/GalleySidecar";
import { ObsidianVaultFileStore } from "../../src/documents/ObsidianVaultFileStore";
import {
  ObsidianTransactionStore,
  type TransactionRecord,
  type TransactionReceiptPlan,
  type TransactionScope
} from "../../src/documents/ObsidianTransactionStore";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";

const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "223e4567-e89b-42d3-a456-426614174000";
const SCOPE: TransactionScope = {
  pair: { html: "notes/a.galley.html", sidecar: "notes/a.galley.json" },
  historyDocumentId: "323e4567-e89b-42d3-a456-426614174000"
};
const OTHER_SCOPE: TransactionScope = {
  pair: { html: "notes/b.galley.html", sidecar: "notes/b.galley.json" },
  historyDocumentId: "323e4567-e89b-42d3-a456-426614174000"
};
const BLOBS = [
  { role: "pair-html-before" as const, text: "old html" },
  { role: "pair-html-after" as const, text: "new html" },
  { role: "pair-sidecar-before" as const, text: "old sidecar" },
  { role: "pair-sidecar-after" as const, text: "new sidecar" }
];

describe("ObsidianTransactionStore", () => {
  it("prepares blobs before a verified manifest and reopens after store recreation", async () => {
    const backing = new PersistentObsidianBacking();
    const first = makeStore(backing, [ID_A]);
    const prepared = await first.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    expect(prepared.id).toBe(ID_A);
    expect(backing.createdPaths.at(-1)).toContain("manifest.json");
    expect(
      backing.createdPaths
        .slice(0, -1)
        .filter((path) => path.includes(`${ID_A}/`))
        .every((path) => path.includes("/blob-"))
    ).toBe(true);

    const reopened = await makeStore(backing, [ID_B]).open(ID_A);
    expect(reopened).toMatchObject({ id: ID_A, phase: "prepared", scope: SCOPE });
    expect(reopened.blobs.map(({ role, text }) => [role, text])).toEqual(
      BLOBS.map(({ role, text }) => [role, text]).sort(([left], [right]) =>
        String(left).localeCompare(String(right))
      )
    );
  });

  it("retries UUID folder collisions and lists deterministically by exact scope", async () => {
    const backing = new PersistentObsidianBacking();
    const first = makeStore(backing, [ID_A]);
    await first.prepare({ kind: "pair-create", scope: SCOPE, blobs: [] });
    const second = makeStore(backing, [ID_A, ID_B]);
    const prepared = await second.prepare({ kind: "pair-create", scope: SCOPE, blobs: [] });
    expect(prepared.id).toBe(ID_B);
    expect((await second.list(SCOPE)).map(({ id }) => id)).toEqual([ID_A, ID_B]);
  });

  it("prevents concurrent prepares from sharing or overwriting a UUID folder", async () => {
    const backing = new PersistentObsidianBacking();
    const first = makeStore(backing, [ID_A, ID_B]);
    const second = makeStore(backing, [ID_A, ID_B]);
    const [left, right] = await Promise.all([
      first.prepare({ kind: "pair-create", scope: SCOPE, blobs: [] }),
      second.prepare({ kind: "pair-create", scope: SCOPE, blobs: [] })
    ]);
    expect(new Set([left.id, right.id])).toEqual(new Set([ID_A, ID_B]));
    expect((await first.list(SCOPE)).map(({ id }) => id)).toEqual([ID_A, ID_B]);
  });

  it("accepts only the declared forward phase graph and preserves bytes on rejection", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const manifestPath = `.galley/transactions/${ID_A}/manifest.json`;
    const before = backing.read(manifestPath);
    await expect(store.transition(record, "committed")).rejects.toMatchObject({
      code: "transaction_phase_invalid"
    });
    expect(backing.read(manifestPath)).toBe(before);
    record = await store.transition(record, "applying");
    await expect(store.transition(record, "prepared")).rejects.toMatchObject({
      code: "transaction_phase_invalid"
    });
  });

  it("preserves the prior phase when the conditional manifest write conflicts", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const manifestPath = `.galley/transactions/${ID_A}/manifest.json`;
    backing.replace(manifestPath, backing.read(manifestPath)!);
    await expect(store.transition(record, "applying")).rejects.toMatchObject({
      code: "transaction_write_conflict"
    });
    expect(JSON.parse(backing.read(manifestPath)!).phase).toBe("prepared");
  });

  it("classifies abort after a successful manifest phase write as transaction ambiguity", async () => {
    const backing = new PersistentObsidianBacking();
    const controller = new AbortController();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    abortAfterManifestModify(files, controller);
    await expect(store.transition(record, "applying", controller.signal)).rejects.toMatchObject({
      code: "transaction_write_ambiguous",
      transactionId: ID_A,
      outcome: "applied"
    });
    expect(JSON.parse(backing.read(`.galley/transactions/${ID_A}/manifest.json`)!).phase).toBe(
      "applying"
    );
  });

  it("classifies strict reopen failure after a manifest phase write as transaction ambiguity", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    failManifestReopenAfterModify(files);
    await expect(store.transition(record, "applying")).rejects.toMatchObject({
      code: "transaction_write_ambiguous",
      transactionId: ID_A,
      outcome: "applied"
    });
    await expect(makeStore(backing, [ID_B]).open(ID_A)).resolves.toMatchObject({
      phase: "applying"
    });
  });

  it("preserves the complete WAL when abort lands after manifest creation", async () => {
    const backing = new PersistentObsidianBacking();
    const controller = new AbortController();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    abortAfterManifestCreate(files, controller);
    const store = makeStoreWithFiles(files, [ID_A]);
    await expect(
      store.prepare(
        { kind: "owned-cleanup", scope: SCOPE, blobs: [{ role: "metadata", text: "owned" }] },
        controller.signal
      )
    ).rejects.toMatchObject({
      code: "transaction_write_ambiguous",
      transactionId: ID_A,
      outcome: "applied"
    });
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/blob-metadata.json`)).toBe("owned");
    await expect(makeStore(backing, [ID_B]).open(ID_A)).resolves.toMatchObject({
      id: ID_A,
      phase: "prepared"
    });
  });

  it("binds receipts to the transaction, pair hashes, and exact history plan", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    const receipt = await store.writeReceipt(record, plan);
    expect(receipt).toMatchObject({
      manifestChecksum: record.checksum,
      aggregateDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(store.verifyReceipt(record, plan)).resolves.toMatchObject({ transactionId: ID_A });
    await expect(
      store.verifyReceipt(record, {
        ...plan,
        pair: { ...plan.pair, htmlHash: "f".repeat(64) }
      })
    ).rejects.toMatchObject({ code: "transaction_receipt_invalid" });
    await expect(
      store.verifyReceipt(record, { ...plan, historyHashes: ["e".repeat(64)] })
    ).rejects.toMatchObject({ code: "transaction_receipt_invalid" });
  });

  it("retries the whole record vector when an earlier blob drifts during a later read", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const firstPath = record.blobs[0]!.path;
    const laterPath = record.blobs.at(-1)!.path;
    const read = files.readTextStable.bind(files);
    let laterReads = 0;
    let drifted = false;
    files.readTextStable = async (path, signal) => {
      const result = await read(path, signal);
      if (path === laterPath) {
        laterReads += 1;
        if (laterReads === 2 && !drifted) {
          drifted = true;
          backing.replace(firstPath, "corrupt!", {
            sameIdentity: true,
            preserveStat: true
          });
        }
      }
      return result;
    };
    await expect(store.open(ID_A)).rejects.toMatchObject({
      code: "transaction_record_unstable"
    });
  });

  it("retries the whole record vector when manifest scope drifts during blob reads", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const read = files.readTextStable.bind(files);
    let drifted = false;
    files.readTextStable = async (path, signal) => {
      const result = await read(path, signal);
      if (path === record.blobs[0]!.path && !drifted) {
        drifted = true;
        await rewriteManifest(backing, ID_A, (value) => {
          value.scope = OTHER_SCOPE;
        });
      }
      return result;
    };
    await expect(store.open(ID_A)).resolves.toMatchObject({ scope: OTHER_SCOPE });
  });

  it("fails with typed instability when aggregate record churn exhausts bounded retries", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    let index = 0;
    const store = new ObsidianTransactionStore(files, {
      randomUUID: () => ID_A,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      maxSnapshotAttempts: 2
    });
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const read = files.readTextStable.bind(files);
    files.readTextStable = async (path, signal) => {
      const result = await read(path, signal);
      if (path === record.blobs[0]!.path) {
        index += 1;
        await rewriteManifest(backing, ID_A, (value) => {
          value.scope = index % 2 === 0 ? SCOPE : OTHER_SCOPE;
        });
      }
      return result;
    };
    await expect(store.open(ID_A)).rejects.toMatchObject({
      code: "transaction_record_unstable"
    });
  });

  it("binds stale-handle CAS to blob observations across stores", async () => {
    const backing = new PersistentObsidianBacking();
    const first = makeStore(backing, [ID_A]);
    const stale = await first.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const blob = stale.blobs[0]!;
    backing.replace(blob.path, blob.text);
    const second = makeStore(backing, [ID_B]);
    await expect(second.open(ID_A)).resolves.toMatchObject({ id: ID_A });
    await expect(first.transition(stale, "applying")).rejects.toMatchObject({
      code: "transaction_write_conflict"
    });
  });

  it("does not return a receipt when durable scope drifts inside its create window", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const create = files.createExclusive.bind(files);
    files.createExclusive = async (path, text, signal) => {
      if (path.endsWith("/receipt.json")) {
        await rewriteManifest(backing, ID_A, (value) => {
          value.scope = OTHER_SCOPE;
        });
      }
      return create(path, text, signal);
    };
    await expect(store.writeReceipt(record, receiptPlan())).rejects.toMatchObject({
      code: "transaction_write_ambiguous"
    });
  });

  it("does not return a receipt when a blob drifts after receipt creation", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const create = files.createExclusive.bind(files);
    files.createExclusive = async (path, text, signal) => {
      const result = await create(path, text, signal);
      if (path.endsWith("/receipt.json")) {
        const blob = record.blobs[0]!;
        backing.replace(blob.path, blob.text);
      }
      return result;
    };
    await expect(store.writeReceipt(record, receiptPlan())).rejects.toMatchObject({
      code: "transaction_write_ambiguous"
    });
  });

  it("closes receipt verification over the aggregate transaction snapshot", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    const read = files.readTextStable.bind(files);
    let drifted = false;
    files.readTextStable = async (path, signal) => {
      const result = await read(path, signal);
      if (path.endsWith("/receipt.json") && !drifted) {
        drifted = true;
        const blob = record.blobs[0]!;
        backing.replace(blob.path, blob.text);
      }
      return result;
    };
    await expect(store.verifyReceipt(record, plan)).rejects.toMatchObject({
      code: "transaction_receipt_invalid"
    });
  });

  it.each(["first-receipt", "closing-aggregate", "second-receipt"] as const)(
    "propagates cancellation during the %s verification window without quarantine",
    async (stage) => {
      const backing = new PersistentObsidianBacking();
      const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
      const store = makeStoreWithFiles(files, [ID_A]);
      const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
      const plan = receiptPlan();
      await store.writeReceipt(record, plan);
      const controller = new AbortController();
      abortReceiptVerificationAt(files, controller, stage);

      await expect(store.verifyReceipt(record, plan, controller.signal)).rejects.toMatchObject({
        name: "AbortError"
      });
      expect(backing.read(`.galley/transactions/${ID_A}/receipt.json`)).not.toBeNull();
      expect(backing.read(`.galley/transactions/${ID_A}/quarantine.json`)).toBeNull();
    }
  );

  it("rejects semantically valid but noncanonical manifest JSON bytes", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const path = `.galley/transactions/${ID_A}/manifest.json`;
    backing.replace(path, `${JSON.stringify(JSON.parse(backing.read(path)!), null, 2)}\n`, {
      sameIdentity: true
    });
    await expect(store.open(ID_A)).rejects.toMatchObject({
      code: "transaction_record_invalid"
    });
  });

  it("rejects semantically valid but noncanonical receipt JSON bytes", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    const path = `.galley/transactions/${ID_A}/receipt.json`;
    backing.replace(path, `${JSON.stringify(JSON.parse(backing.read(path)!), null, 2)}\n`, {
      sameIdentity: true
    });
    await expect(store.verifyReceipt(record, plan)).rejects.toMatchObject({
      code: "transaction_receipt_invalid"
    });
  });

  it.each([
    ["malformed JSON", (_value: any) => "{bad json"],
    ["unknown key", (value: any) => ({ ...value, extra: true })],
    ["changed transaction", (value: any) => ({ ...value, transactionId: ID_B })],
    ["checksum drift", (value: any) => ({ ...value, checksum: "0".repeat(64) })]
  ])("rejects a receipt attack: %s", async (_name, attack) => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    const path = `.galley/transactions/${ID_A}/receipt.json`;
    const raw = backing.read(path)!;
    const attacked = attack(JSON.parse(raw));
    backing.replace(path, typeof attacked === "string" ? attacked : `${canonicalJson(attacked)}\n`, {
      sameIdentity: true
    });
    await expect(store.verifyReceipt(record, plan)).rejects.toMatchObject({
      code: "transaction_receipt_invalid"
    });
  });

  it.each([
    ["unknown key", (value: any) => (value.extra = true)],
    ["unsupported version", (value: any) => (value.schemaVersion = 2)],
    ["unsupported kind", (value: any) => (value.kind = "delete-anything")],
    ["unsupported phase", (value: any) => (value.phase = "rolled-back")],
    ["traversal filename", (value: any) => (value.blobs[0].filename = "../victim")],
    ["sibling blob", (value: any) => (value.blobs[0].filename = `../${ID_B}/blob.txt`)],
    ["duplicate role", (value: any) => value.blobs.push({ ...value.blobs[0] })],
    ["duplicate filename", (value: any) => (value.blobs[1].filename = value.blobs[0].filename)],
    ["absolute scope", (value: any) => (value.scope.pair.html = "/etc/passwd")],
    ["backslash scope", (value: any) => (value.scope.pair.html = "notes\\a.html")],
    ["URL scope", (value: any) => (value.scope.pair.html = "https://host/a")],
    ["NUL scope", (value: any) => (value.scope.pair.html = "notes/a\0.html")]
  ])("fails closed and quarantines a manifest attack: %s", async (_name, mutate) => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    await rewriteManifest(backing, ID_A, mutate);
    await expect(store.open(ID_A)).rejects.toMatchObject({
      code: "transaction_record_invalid"
    });
    expect(backing.read(`.galley/transactions/${ID_A}/quarantine.json`)).not.toBeNull();
    expect(backing.read("victim")).toBeNull();
  });

  it("detects corrupted staged bytes and checksum drift", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    backing.replace(record.blobs[0]!.path, "corrupt", { sameIdentity: true });
    await expect(store.open(ID_A)).rejects.toMatchObject({ code: "transaction_record_invalid" });
  });

  it("rejects a drifted manifest checksum even when every field remains well-formed", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const path = `.galley/transactions/${ID_A}/manifest.json`;
    const value = JSON.parse(backing.read(path)!);
    value.checksum = "0".repeat(64);
    backing.replace(path, `${canonicalJson(value)}\n`, { sameIdentity: true });
    await expect(store.open(ID_A)).rejects.toMatchObject({ code: "transaction_record_invalid" });
  });

  it("rejects manifest checksum drift and oversized metadata without reading targets", async () => {
    const backing = new PersistentObsidianBacking({ "notes/a.galley.html": "target" });
    const store = makeStore(backing, [ID_A]);
    await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const path = `.galley/transactions/${ID_A}/manifest.json`;
    const value = JSON.parse(backing.read(path)!);
    value.checksum = "0".repeat(64);
    backing.replace(path, `${canonicalJson(value)}\n${"x".repeat(70_000)}`, { sameIdentity: true });
    await expect(store.open(ID_A)).rejects.toMatchObject({ code: "transaction_record_invalid" });
    expect(backing.read("notes/a.galley.html")).toBe("target");
  });

  it("never follows a forged cleanup path or deletes changed owned bytes", async () => {
    const backing = new PersistentObsidianBacking({ "victim": "preserve" });
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await store.transition(record, "applying");
    record = await store.transition(record, "committed");
    record = await store.transition(record, "completed");
    backing.replace(record.blobs[0]!.path, "external");
    await expect(store.cleanup(record)).resolves.toEqual({ status: "conflict" });
    expect(backing.read(record.blobs[0]!.path)).toBe("external");
    expect(backing.read("victim")).toBe("preserve");
  });

  it("rejects forged external ownership and never reads or deletes its victim", async () => {
    const backing = new PersistentObsidianBacking({ "notes/victim.txt": "preserve" });
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({
      kind: "owned-cleanup",
      scope: SCOPE,
      blobs: [{ role: "metadata", text: "owned" }]
    });
    record = await store.transition(record, "applying");
    record = await store.transition(record, "committed");
    record = await store.transition(record, "completed");
    const victim = await files.readTextStable("notes/victim.txt");
    const forged = {
      ...record,
      blobs: [{ ...record.blobs[0], ownership: victim }]
    } as any;
    await expect(store.cleanup(forged)).rejects.toMatchObject({
      code: "transaction_handle_untrusted"
    });
    expect(backing.read("notes/victim.txt")).toBe("preserve");
  });

  it("rejects a forged phase instead of skipping the durable forward graph", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const forged = { ...record, phase: "applying" } as any;
    await expect(store.transition(forged, "committed")).rejects.toMatchObject({
      code: "transaction_handle_untrusted"
    });
    expect(JSON.parse(backing.read(`.galley/transactions/${ID_A}/manifest.json`)!).phase).toBe(
      "prepared"
    );
  });

  it("binds receipt scope to the durable manifest instead of a forged public scope", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    const record = await store.prepare({ kind: "pair-history", scope: SCOPE, blobs: BLOBS });
    const other = {
      pair: { html: "notes/other.galley.html", sidecar: "notes/other.galley.json" },
      historyDocumentId: SCOPE.historyDocumentId
    };
    const forged = { ...record, scope: other } as any;
    const plan = {
      ...receiptPlan(),
      pair: {
        ...receiptPlan().pair,
        htmlPath: other.pair.html,
        sidecarPath: other.pair.sidecar
      }
    };
    await expect(store.writeReceipt(forged, plan)).rejects.toMatchObject({
      code: "transaction_handle_untrusted"
    });
    expect(backing.read(`.galley/transactions/${ID_A}/receipt.json`)).toBeNull();
  });

  it("deep-freezes records and rejects cloned, foreign-store, and stale handles", async () => {
    const backing = new PersistentObsidianBacking();
    const first = makeStore(backing, [ID_A]);
    const prepared = await first.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.scope)).toBe(true);
    expect(Object.isFrozen(prepared.scope.pair)).toBe(true);
    expect(Object.isFrozen(prepared.blobs)).toBe(true);
    expect(Object.isFrozen(prepared.blobs[0])).toBe(true);
    const cloned = structuredClone(prepared);
    await expect(first.transition(cloned, "applying")).rejects.toMatchObject({
      code: "transaction_handle_untrusted"
    });

    const second = makeStore(backing, [ID_B]);
    await expect(second.transition(prepared, "applying")).rejects.toMatchObject({
      code: "transaction_handle_untrusted"
    });
    const reopened = await second.open(ID_A);
    const applying = await second.transition(reopened, "applying");
    await expect(first.transition(prepared, "applying")).rejects.toMatchObject({
      code: "transaction_write_conflict"
    });
    await expect(second.transition(applying, "committed")).resolves.toMatchObject({
      phase: "committed"
    });
  });

  it("rejects a peer replacement at the optional receipt path before cleanup mutation", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    await store.writeReceipt(record, receiptPlan());
    record = await advanceToCompleted(store, record);
    const receiptPath = `.galley/transactions/${ID_A}/receipt.json`;
    backing.replace(receiptPath, "peer-receipt");

    await expect(store.cleanup(record)).resolves.toEqual({ status: "conflict" });
    expect(backing.read(receiptPath)).toBe("peer-receipt");
    expect(backing.read(record.blobs[0]!.path)).not.toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("rejects a peer replacement at the optional quarantine path before cleanup mutation", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    await expect(
      store.verifyReceipt(record, {
        ...plan,
        historyHashes: ["e".repeat(64)]
      })
    ).rejects.toMatchObject({ code: "transaction_receipt_invalid" });
    record = await advanceToCompleted(store, record);
    const quarantinePath = `.galley/transactions/${ID_A}/quarantine.json`;
    backing.replace(quarantinePath, "peer-quarantine");

    await expect(store.cleanup(record)).resolves.toEqual({ status: "conflict" });
    expect(backing.read(quarantinePath)).toBe("peer-quarantine");
    expect(backing.read(record.blobs[0]!.path)).not.toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("cleans a valid receipt written at committed phase after transition to completed", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await store.transition(record, "applying");
    record = await store.transition(record, "committed");
    await store.writeReceipt(record, receiptPlan());
    record = await store.transition(record, "completed");

    await expect(store.cleanup(record)).resolves.toEqual({
      status: "cleaned",
      directory: "retained"
    });
    expect(backing.read(`.galley/transactions/${ID_A}/receipt.json`)).toBeNull();
  });

  it("strictly accepts and cleans valid receipt plus quarantine metadata", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    await expect(
      store.verifyReceipt(record, {
        ...plan,
        pair: { ...plan.pair, sidecarHash: "f".repeat(64) }
      })
    ).rejects.toMatchObject({ code: "transaction_receipt_invalid" });
    record = await advanceToCompleted(store, record);

    await expect(store.cleanup(record)).resolves.toEqual({
      status: "cleaned",
      directory: "retained"
    });
    expect(backing.read(`.galley/transactions/${ID_A}/receipt.json`)).toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/quarantine.json`)).toBeNull();
  });

  it.each(["file", "folder"] as const)(
    "reports ambiguous when a peer %s appears after cleanup starts",
    async (kind) => {
      const backing = new PersistentObsidianBacking();
      const folderPath = `.galley/transactions/${ID_A}`;
      let firstPath = "";
      const files = new ObsidianVaultFileStore(
        persistentObsidianVault(backing, {
          afterDelete(path) {
            if (path !== firstPath) return;
            if (kind === "file") backing.replace(`${folderPath}/peer.txt`, "peer");
            else backing.ensureFolders(`${folderPath}/peer-folder`);
          }
        })
      );
      const store = makeStoreWithFiles(files, [ID_A]);
      let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
      record = await advanceToCompleted(store, record);
      firstPath = record.blobs[0]!.path;

      await expect(store.cleanup(record)).resolves.toEqual({ status: "ambiguous" });
      if (kind === "file") expect(backing.read(`${folderPath}/peer.txt`)).toBe("peer");
      else expect(backing.nodes.get(`${folderPath}/peer-folder`)?.kind).toBe("folder");
      expect(backing.rmdirPaths).toEqual([]);
    }
  );

  it.each(["throw", "abort"] as const)(
    "reports ambiguous when the final empty-folder list ends with %s",
    async (mode) => {
      const backing = new PersistentObsidianBacking();
      const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
      const store = makeStoreWithFiles(files, [ID_A]);
      let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
      record = await advanceToCompleted(store, record);
      const folderPath = `.galley/transactions/${ID_A}`;
      const list = files.list.bind(files);
      const controller = new AbortController();
      let folderLists = 0;
      files.list = async (path, signal) => {
        if (path === folderPath) {
          folderLists += 1;
          if (folderLists === 2) {
            if (mode === "throw") throw new Error("injected final list failure");
            controller.abort();
          }
        }
        return list(path, signal);
      };

      await expect(store.cleanup(record, controller.signal)).resolves.toEqual({
        status: "ambiguous"
      });
    }
  );

  it("rethrows a folder-list failure before cleanup mutates any member", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await advanceToCompleted(store, record);
    const folderPath = `.galley/transactions/${ID_A}`;
    const list = files.list.bind(files);
    const injected = new Error("injected preflight list failure");
    files.list = async (path, signal) => {
      if (path === folderPath) throw injected;
      return list(path, signal);
    };

    await expect(store.cleanup(record)).rejects.toBe(injected);
    expect(backing.read(record.blobs[0]!.path)).not.toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("reports ambiguous when a later blob conflicts after the first blob was removed", async () => {
    const backing = new PersistentObsidianBacking();
    let firstPath = "";
    let secondPath = "";
    const files = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterDelete(path) {
          if (path === firstPath) backing.replace(secondPath, "peer-blob");
        }
      })
    );
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await advanceToCompleted(store, record);
    firstPath = record.blobs[0]!.path;
    secondPath = record.blobs[1]!.path;

    await expect(store.cleanup(record)).resolves.toEqual({ status: "ambiguous" });
    expect(backing.read(firstPath)).toBeNull();
    expect(backing.read(secondPath)).toBe("peer-blob");
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("reports ambiguous when an optional receipt conflicts after blob removal", async () => {
    const backing = new PersistentObsidianBacking();
    const receiptPath = `.galley/transactions/${ID_A}/receipt.json`;
    let firstPath = "";
    const files = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterDelete(path) {
          if (path === firstPath) backing.replace(receiptPath, "peer-receipt");
        }
      })
    );
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    await store.writeReceipt(record, receiptPlan());
    record = await advanceToCompleted(store, record);
    firstPath = record.blobs[0]!.path;

    await expect(store.cleanup(record)).resolves.toEqual({ status: "ambiguous" });
    expect(backing.read(firstPath)).toBeNull();
    expect(backing.read(receiptPath)).toBe("peer-receipt");
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("reports ambiguous when quarantine conflicts after receipt removal", async () => {
    const backing = new PersistentObsidianBacking();
    const receiptPath = `.galley/transactions/${ID_A}/receipt.json`;
    const quarantinePath = `.galley/transactions/${ID_A}/quarantine.json`;
    const files = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterDelete(path) {
          if (path === receiptPath) backing.replace(quarantinePath, "peer-quarantine");
        }
      })
    );
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    const plan = receiptPlan();
    await store.writeReceipt(record, plan);
    await expect(
      store.verifyReceipt(record, {
        ...plan,
        pair: { ...plan.pair, htmlHash: "f".repeat(64) }
      })
    ).rejects.toMatchObject({ code: "transaction_receipt_invalid" });
    record = await advanceToCompleted(store, record);

    await expect(store.cleanup(record)).resolves.toEqual({ status: "ambiguous" });
    expect(backing.read(receiptPath)).toBeNull();
    expect(backing.read(quarantinePath)).toBe("peer-quarantine");
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("reports ambiguous when the manifest conflicts after a blob was removed", async () => {
    const backing = new PersistentObsidianBacking();
    const manifestPath = `.galley/transactions/${ID_A}/manifest.json`;
    let firstPath = "";
    let manifestText = "";
    const files = new ObsidianVaultFileStore(
      persistentObsidianVault(backing, {
        afterDelete(path) {
          if (path === firstPath) backing.replace(manifestPath, manifestText);
        }
      })
    );
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await advanceToCompleted(store, record);
    firstPath = record.blobs[0]!.path;
    manifestText = backing.read(manifestPath)!;

    await expect(store.cleanup(record)).resolves.toEqual({ status: "ambiguous" });
    expect(backing.read(firstPath)).toBeNull();
    expect(backing.read(manifestPath)).toBe(manifestText);
  });

  it("keeps a conflict classification when no cleanup member was removed", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await advanceToCompleted(store, record);
    const pathsBefore = backing.paths();
    backing.replace(record.blobs[0]!.path, "peer-first");

    await expect(store.cleanup(record)).resolves.toEqual({ status: "conflict" });
    expect(backing.paths()).toEqual(pathsBefore);
    expect(backing.read(record.blobs[0]!.path)).toBe("peer-first");
  });

  it.each(["throw", "abort", "ambiguous"] as const)(
    "reports ambiguous after one removal when the next removal ends with %s",
    async (mode) => {
      const backing = new PersistentObsidianBacking();
      const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
      const store = makeStoreWithFiles(files, [ID_A]);
      let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
      record = await advanceToCompleted(store, record);
      const remove = files.removeOwned.bind(files);
      const controller = new AbortController();
      let calls = 0;
      files.removeOwned = async (owned, signal) => {
        calls += 1;
        if (calls === 2) {
          if (mode === "throw") throw new Error("injected cleanup failure");
          if (mode === "ambiguous") {
            return {
              status: "ambiguous",
              operation: "remove",
              outcome: "unknown",
              aborted: false
            };
          }
        }
        const result = await remove(owned, signal);
        if (calls === 1 && mode === "abort") controller.abort();
        return result;
      };

      await expect(store.cleanup(record, controller.signal)).resolves.toEqual({
        status: "ambiguous"
      });
    }
  );

  it("rethrows a removal error when cleanup has not mutated any member", async () => {
    const backing = new PersistentObsidianBacking();
    const files = new ObsidianVaultFileStore(persistentObsidianVault(backing));
    const store = makeStoreWithFiles(files, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await advanceToCompleted(store, record);
    const injected = new Error("first removal failed");
    files.removeOwned = async () => {
      throw injected;
    };

    await expect(store.cleanup(record)).rejects.toBe(injected);
    expect(backing.read(record.blobs[0]!.path)).not.toBeNull();
    expect(backing.read(`.galley/transactions/${ID_A}/manifest.json`)).not.toBeNull();
  });

  it("cleans a completed transaction through only verified store-owned paths", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A]);
    let record = await store.prepare({ kind: "owned-cleanup", scope: SCOPE, blobs: BLOBS });
    record = await store.transition(record, "applying");
    record = await store.transition(record, "committed");
    record = await store.transition(record, "completed");
    await expect(store.cleanup(record)).resolves.toEqual({
      status: "cleaned",
      directory: "retained"
    });
    expect(backing.paths().some((path) => path.includes(ID_A))).toBe(false);
    expect(backing.nodes.has(`.galley/transactions/${ID_A}`)).toBe(true);
    expect(backing.rmdirPaths).toEqual([]);
    expect(await store.list(SCOPE)).toEqual([]);
  });

  it("keeps quarantine scope-local while unrelated valid scope listing remains usable", async () => {
    const backing = new PersistentObsidianBacking();
    const store = makeStore(backing, [ID_A, ID_B]);
    await store.prepare({ kind: "pair-replace", scope: SCOPE, blobs: BLOBS });
    const other: TransactionScope = {
      pair: { html: "notes/b.galley.html", sidecar: "notes/b.galley.json" }
    };
    await store.prepare({ kind: "pair-create", scope: other, blobs: [] });
    backing.replace(`.galley/transactions/${ID_A}/manifest.json`, "{bad json");
    expect((await store.list(other)).map(({ id }) => id)).toEqual([ID_B]);
  });
});

function makeStore(backing: PersistentObsidianBacking, ids: string[]): ObsidianTransactionStore {
  return makeStoreWithFiles(
    new ObsidianVaultFileStore(persistentObsidianVault(backing)),
    ids
  );
}

function makeStoreWithFiles(
  files: ObsidianVaultFileStore,
  ids: string[]
): ObsidianTransactionStore {
  let index = 0;
  return new ObsidianTransactionStore(
    files,
    {
      randomUUID: () => ids[Math.min(index++, ids.length - 1)]!,
      now: () => new Date("2026-07-15T00:00:00.000Z")
    }
  );
}

function abortAfterManifestCreate(
  files: ObsidianVaultFileStore,
  controller: AbortController
): void {
  const create = files.createExclusive.bind(files);
  files.createExclusive = async (path, text, signal) => {
    const result = await create(path, text, signal);
    if (path.endsWith("/manifest.json") && result.status === "created") {
      controller.abort();
    }
    return result;
  };
}

function abortAfterManifestModify(
  files: ObsidianVaultFileStore,
  controller: AbortController
): void {
  const modify = files.modifyOwned.bind(files);
  files.modifyOwned = async (owned, text, signal) => {
    const result = await modify(owned, text, signal);
    if (owned.path.endsWith("/manifest.json") && result.status === "modified") {
      controller.abort();
    }
    return result;
  };
}

function failManifestReopenAfterModify(files: ObsidianVaultFileStore): void {
  const modify = files.modifyOwned.bind(files);
  const read = files.readTextStable.bind(files);
  let failReopen = false;
  files.modifyOwned = async (owned, text, signal) => {
    const result = await modify(owned, text, signal);
    if (owned.path.endsWith("/manifest.json") && result.status === "modified") {
      failReopen = true;
    }
    return result;
  };
  files.readTextStable = async (path, signal) => {
    if (failReopen && path.endsWith("/manifest.json")) {
      failReopen = false;
      throw new Error("injected strict reopen failure");
    }
    return read(path, signal);
  };
}

function abortReceiptVerificationAt(
  files: ObsidianVaultFileStore,
  controller: AbortController,
  stage: "first-receipt" | "closing-aggregate" | "second-receipt"
): void {
  const read = files.readTextStable.bind(files);
  let receiptReads = 0;
  let aborted = false;
  files.readTextStable = async (path, signal) => {
    const result = await read(path, signal);
    if (path.endsWith("/receipt.json")) {
      receiptReads += 1;
      if (
        !aborted &&
        ((stage === "first-receipt" && receiptReads === 1) ||
          (stage === "second-receipt" && receiptReads === 2))
      ) {
        aborted = true;
        controller.abort();
      }
    } else if (
      !aborted &&
      stage === "closing-aggregate" &&
      receiptReads === 1 &&
      path.endsWith("/manifest.json")
    ) {
      aborted = true;
      controller.abort();
    }
    return result;
  };
}

function receiptPlan(): TransactionReceiptPlan {
  return {
    pair: {
      htmlPath: SCOPE.pair.html,
      sidecarPath: SCOPE.pair.sidecar,
      htmlHash: "a".repeat(64),
      sidecarHash: "b".repeat(64)
    },
    historyHashes: ["c".repeat(64), "d".repeat(64)]
  };
}

async function advanceToCompleted(
  store: ObsidianTransactionStore,
  record: TransactionRecord
): Promise<TransactionRecord> {
  let current = await store.transition(record, "applying");
  current = await store.transition(current, "committed");
  return store.transition(current, "completed");
}

async function rewriteManifest(
  backing: PersistentObsidianBacking,
  id: string,
  mutate: (value: any) => void
): Promise<void> {
  const path = `.galley/transactions/${id}/manifest.json`;
  const value = JSON.parse(backing.read(path)!);
  mutate(value);
  delete value.checksum;
  value.checksum = await sha256Text(canonicalJson(value));
  backing.replace(path, `${canonicalJson(value)}\n`, { sameIdentity: true });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
