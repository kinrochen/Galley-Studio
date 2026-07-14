# Task 3.2a.1 Implementation Report

## Status

DONE — independent-review R1 remediation included

- Required base: `d3c65d5bc9f7f3f2201e3abc8ca99cce29a22d48`
- Base HEAD verified before edits: exact match
- Initial tracked/untracked status: clean; only pre-existing ignored files were present
- Task commit: the commit containing this report; its SHA is supplied in the handoff because a commit cannot contain its own SHA
- Progress ledger, Phase 3 plan, Task 3.1 contracts, composition root, editor, package, and lock files: not modified

## Outcome

Implemented the two production primitives required before the complete Phase 3
Obsidian adapter:

- `ObsidianVaultFileStore` is a browser-compatible, injected wrapper over the
  exact Obsidian `Vault`/`DataAdapter` surface used here. It validates every
  public path, obtains bounded stable reads, hashes exact text with Web Crypto,
  carries `TFile` identity plus copied stat evidence, performs exclusive
  creation, exact conditional modification/removal, recursive directory
  creation, deterministic direct listing, and exact empty-folder cleanup.
- `ObsidianTransactionStore` owns only `.galley/transactions`, generates
  canonical UUID folders, writes immutable staged blobs before a canonical
  checksummed manifest, strictly reopens records after store recreation,
  conditionally advances a closed phase graph, writes/verifies exact-plan
  receipts, creates safe scope-local quarantine metadata, and cleans completed
  records only through derived closed paths and exact owned handles.
- Tests use a fresh persistent fake backing shaped like Obsidian. Independent
  `Vault`, file-store, and transaction-store instances share that backing, so
  restart and cross-instance behavior cannot pass through process-local maps.
  The Task 3.1 `MemoryWorkbenchVault` is not reused.

This task deliberately does not implement pair/history roll-forward or
rollback and does not wire `DocumentSession`, the editor, or `main.ts`.

## TDD evidence

### Formal RED

The two formal suites and their persistent Obsidian-shaped fixture were added
before either production module. The required focused command produced:

```text
npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts

FAIL tests/documents/ObsidianTransactionStore.test.ts
Failed to resolve ../../src/documents/ObsidianVaultFileStore

FAIL tests/documents/ObsidianVaultFileStore.test.ts
Failed to resolve ../../src/documents/ObsidianVaultFileStore

Test Files  2 failed (2)
Tests       no tests
exit 1
```

The failure occurred at static import, as expected for the intentionally
missing production boundary.

### Focused GREEN

```text
npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts
Test Files  2 passed (2)
Tests       49 passed (49)
exit 0

npm run test:typecheck
exit 0
```

## Inspected Obsidian 1.11.4 declarations

Inspected the installed file
`node_modules/obsidian/obsidian.d.ts` rather than inferring the API:

- `DataAdapter` at lines 1594-1699: `exists(normalizedPath, sensitive?)`,
  `stat(normalizedPath)`, non-recursive `list(normalizedPath)`, direct
  `read(normalizedPath)`, overwriting `write`, `mkdir`, `remove`, and related
  methods. The implementation uses only `adapter.list`; it does not use the
  overwriting `write` primitive.
- `FileStats` at lines 2564-2584: exact declared evidence fields are `ctime`,
  `mtime`, and `size`.
- `TAbstractFile` at lines 5838-5859: `vault`, `path`, `name`, `parent`.
- `TFile` at lines 6036-6058: adds `stat`, `basename`, and `extension`.
- `Vault` at lines 6261-6434: `getFileByPath`, `getFolderByPath`,
  `getAbstractFileByPath`, `create(path,data)->Promise<TFile>`,
  `createFolder(path)->Promise<TFolder>`, direct `read(TFile)`,
  `delete(TAbstractFile)`, and `modify(TFile,data)`. The declaration explicitly
  documents existing-folder failure for `createFolder` and existing-file
  failure for `createBinary`; `create` has no typed collision error. Therefore
  the wrapper never parses exception messages: it pre-observes, uses the
  exclusive `Vault.create` operation, verifies the exact returned `TFile`, and
  conservatively reports a post-call same-byte uncertainty as ambiguous.

## Exact production public surface

`ObsidianVaultFileStore.ts` exports:

- Evidence/ownership: `VaultFileStatEvidence`, `VaultFileObservation`,
  `VaultOwnedFile`, `VaultOwnedFolder`, `VaultDirectoryEntry`.
- Injected port/options: `ObsidianVaultFilePort`,
  `ObsidianVaultFileStoreOptions`.
- Explicit errors: `VaultPathError`, `VaultFolderConflictError`,
  `VaultFileReadUnstableError`, `VaultMutationAmbiguousError`.
- Result unions: `VaultMutationAmbiguity`,
  `VaultCreateExclusiveResult`, `VaultConditionalModifyResult`,
  `VaultConditionalRemoveResult`, `VaultCreateFolderExclusiveResult`.
- Operations: `readTextStable`, `createExclusive`, `modifyOwned`,
  `removeOwned`, `ensureFolder`, `createFolderExclusive`, `list`, and
  `removeEmptyFolderOwned`.
- Shared strict validator: `canonicalVaultPath`.

Every successful file observation contains normalized `path`, exact `text`,
lowercase SHA-256, UTF-8 byte length, the in-process `TFile` identity, and copied
`ctime`/`mtime`/`size`. Exact identity plus text/hash is authoritative; stats
are evidence only.

`ObsidianTransactionStore.ts` exports:

- Closed constants/types: `TRANSACTION_ROOT`, `TRANSACTION_KINDS`,
  `TRANSACTION_PHASES`, `TRANSACTION_BLOB_ROLES`, `TransactionKind`,
  `TransactionPhase`, and `TransactionBlobRole`.
- Inputs/data: `TransactionScope`, `TransactionBlobInput`,
  `PrepareTransactionInput`, `StoredTransactionBlob`, `TransactionRecord`,
  `TransactionReceiptPlan`, `VerifiedTransactionReceipt`, and
  `ObsidianTransactionStoreOptions`.
- Explicit errors: `TransactionRecordInvalidError`,
  `TransactionPhaseInvalidError`, `TransactionWriteConflictError`,
  `TransactionWriteAmbiguousError`, `TransactionHandleUntrustedError`, and
  `TransactionReceiptInvalidError`.
- Operations: `prepare`, `open`, `list`, `transition`, `writeReceipt`,
  `verifyReceipt`, and `cleanup`.

## Durable layout and schema

```text
.galley/transactions/
  <canonical-generated-uuid>/
    blob-pair-html-before.txt
    blob-pair-html-after.txt
    blob-pair-sidecar-before.txt
    blob-pair-sidecar-after.txt
    blob-history-plan.json
    blob-ownership-plan.json
    blob-metadata.json
    manifest.json
    receipt.json       # optional, exact-plan receipt
    quarantine.json    # optional, safe store metadata
```

Only requested closed blob roles exist; each maps to one fixed filename.
Callers never supply a transaction path or blob filename. Empty role sets are
valid for transactions that need only intent metadata.

Manifest v1 security-relevant fields are:

```text
schemaVersion = 1
transactionId = exact canonical UUID folder name
kind = pair-replace | pair-create | history-retention | pair-history | owned-cleanup
phase = prepared | applying | committed | completed
scope = exact normalized HTML/sidecar paths + optional canonical history UUID
blobs[] = unique closed role + fixed filename + UTF-8 byteLength + SHA-256
createdAt / updatedAt = canonical ISO metadata
checksum = SHA-256(canonical JSON of every preceding field)
```

Canonical JSON recursively sorts object keys, preserves array order, contains
no insignificant whitespace, and is stored with one final newline. Preparation
creates and verifies every blob first, creates `manifest.json` last, and returns
only after a strict re-read verifies the manifest, checksum, folder, blob
identity, exact bytes, lengths, and hashes.

The phase graph is deliberately adjacent and monotonic:

```text
prepared -> applying -> committed -> completed
```

Skipping, repeating, unknown, or backwards transitions fail before mutation.
Transitions compare the exact manifest ownership returned by the preceding
read, conditionally modify, and strictly reopen the new record.

Receipt v1 binds `schemaVersion`, exact `transactionId`, both target paths,
exact target HTML/sidecar SHA-256 values, ordered exact history-plan hashes, and
its canonical checksum. It must also match the record's pair scope.

## Exact-read, ambiguity, and abort semantics

- A stable read obtains a `TFile`, reads exact text, rechecks path identity,
  rereads exact text, hashes it, rereads again after hashing, and rechecks the
  same path identity. Identity replacement, same-identity byte changes, stale
  read rejection, and repeated churn retry only up to the injected bound; then
  `vault_file_read_unstable` fails closed.
- Exclusive create reports pre-existing files/folders as `collision`. A normal
  return is `created` only if the exact returned `TFile` and bytes reverify.
- Conditional modify/remove re-read exact owned identity and bytes immediately
  before mutation. ABA identity replacement and same-stat byte drift are
  conflicts, not writes/deletes.
- After every awaited mutation, exact state is checked again. A thrown adapter,
  unstable verification, lost identity, or abort after a possible mutation is
  explicit `ambiguous`; it is never reported as clean precommit cancellation.
  The ambiguity includes operation, `aborted`, and only a proved
  `applied`/otherwise `unknown` outcome.
- Abort observed before mutation throws `AbortError` and leaves bytes untouched.
  Recursive folder creation uses `vault_mutation_ambiguous` if abort is first
  observed after possible folder creation.

## Malicious-record and ownership audit

Permanent tests prove fail-closed behavior for:

- traversal, absolute, backslash, URL-like, NUL/control, empty-segment,
  dot-segment, drive-like, and non-NFC alias paths;
- unknown manifest/receipt keys, malformed JSON, unsupported version, unknown
  kind/phase, changed transaction ID, and checksum drift;
- `../` blob names, sibling transaction references, duplicate roles,
  duplicate filenames, oversized metadata, and corrupt staged bytes;
- receipt pair-hash or ordered history-plan-hash changes;
- identity swaps, same-stat byte changes, repeated churn, create collisions,
  conditional write/delete conflicts, and post-mutation ambiguity;
- cleanup preflight against externally replaced blob identity/bytes;
- one malformed scope becoming quarantined without blocking deterministic
  listing of an unrelated valid scope.

Untrusted manifest paths never drive reads or cleanup. Blob reads are derived
from `TRANSACTION_ROOT + canonical transaction ID + role filename`; receipt,
manifest, quarantine, and folder cleanup paths are likewise closed and derived.
Unexpected files make cleanup conflict. Quarantine writes only canonical
checksummed metadata inside that derived transaction folder and never reads,
renames, or deletes a target pair/history path.

## Verification gates

Final post-report command results are recorded below after the last full gate:

```text
npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts
2 files passed; 64 tests passed; exit 0

npm run test:typecheck
exit 0

npm test
40 files passed; 916 tests passed; exit 0

npm run build
exit 0

git diff --check d3c65d5bc9f7f3f2201e3abc8ca99cce29a22d48..HEAD
exit 0
```

## Changed files

- `.superpowers/sdd/task-3.2a-1-implementation-report.md`
- `src/documents/ObsidianVaultFileStore.ts`
- `src/documents/ObsidianTransactionStore.ts`
- `tests/documents/ObsidianVaultFileStore.test.ts`
- `tests/documents/ObsidianTransactionStore.test.ts`
- `tests/support/obsidianVaultFixtures.ts`

No `tests/setup/obsidian.ts` change was needed because production imports the
Obsidian surface as types only and the persistent fixture injects the exact
structural port.

## Residual platform limits and next-task boundary

- Obsidian exposes in-process `TFile` identity, not a cross-process filesystem
  inode/generation CAS. Exact repeated bytes/hash plus current `TFile` identity
  close in-process async races; after a plugin/app restart the transaction layer
  reopens fresh exact owned handles from durable bytes. Task 3.2a.2 must still
  use durable intent before target mutation and never treat stats as ownership.
- `Vault.create` does not expose a typed collision-vs-after-create error in the
  1.11.4 declaration. The wrapper therefore reports only a precheck-visible
  existing path as `collision`. Once `Vault.create` has been invoked, any throw
  without a returned `TFile` identity is `ambiguous/unknown`, regardless of the
  current bytes, and the current file is preserved.
- This primitive stores and verifies recovery material but does not decide
  old/new pair roll-forward, rollback, history retention, combined receipts,
  or explicit quarantine resolution. Those behaviors belong exclusively to
  Task 3.2a.2, which was not started here.

## Independent-review R1 remediation

The independent review at reviewed HEAD `bbcb8c575a7f6465366f9de11e951f8cfc9cde41`
reported a nine-case adversarial matrix. All cases were first made permanent,
then run before production remediation:

```text
npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts
Test Files  2 failed (2)
Tests       14 failed | 49 passed (63)
exit 1
```

Four additional parameter rows cover C1/format controls, and a non-recursive
folder-deletion race was added from the same review, hence 14 initial failures
for the nine finding groups. A further post-manifest strict-reopen failure test
was added while hardening the outer await boundary.

### Provenance and durable authority

- Public `TransactionRecord` and `StoredTransactionBlob` values are now pure
  data: no `TFile`, `TFolder`, or owned observation is exposed through them.
- Every `prepare`, `open`, and `list` result is recursively frozen at the
  record, scope, pair, blob-array, and blob levels. The store records an
  unforgeable private `WeakMap` provenance entry containing the canonical
  transaction ID and exact manifest ownership snapshot.
- `transition`, receipt write/verification, and cleanup reject a forged,
  structured-cloned, or foreign-store record with
  `transaction_handle_untrusted`. A fresh store can strictly `open` the durable
  record to obtain its own valid handle. A once-valid stale handle fails exact
  manifest ownership comparison with `transaction_write_conflict`.
- After provenance validation, every operation derives the transaction folder
  from the trusted canonical ID and strictly reopens the current durable
  manifest. Durable phase and scope—not public object fields—authorize the
  phase edge and receipt pair. Cleanup derives its closed paths from the
  reopened manifest and uses only the reopened internal owned observations.
  Injecting an exact observation for an external victim cannot cause even a
  victim-path read through cleanup.

### Possible-mutation handling

- Once `Vault.create` is invoked and throws without a returned `TFile`, a
  present same-byte peer, present different-byte peer, unstable re-observation,
  or verified absence is never promoted to owned success/collision. The result
  is typed `ambiguous` with `outcome: "unknown"`; only a precheck-visible path
  is a collision.
- Folder creation normal-return and throw paths verify the exact returned
  `TFolder`; abort, replacement, or any thrown call is
  `vault_mutation_ambiguous`, never a benign existing-folder race or plain
  post-mutation `AbortError`.
- Prepared blobs may be cleaned only before a durable manifest could exist.
  Once manifest creation returns created/ambiguous/collision or a post-call
  observation is unprovable, the staged blobs and manifest are preserved.
  Abort after manifest creation and strict-reopen failure both throw
  `transaction_write_ambiguous` carrying canonical transaction ID and
  `applied/unknown` outcome. A fresh store reopens the complete WAL.
- Phase update uses the strictly reopened durable phase. After exact manifest
  modification, abort, strict-reopen failure, drift, or verification failure is
  `transaction_write_ambiguous`; the updated manifest is not described as the
  previous phase.
- Cleanup tracks whether any member was removed; a later abort/error becomes
  an ambiguous cleanup result rather than a clean precommit abort.

### Path and directory hardening

- `canonicalVaultPath` now rejects Unicode general categories `Cc` and `Cf`,
  covering C0, DEL, C1 including `U+0085`, and prohibited format controls such
  as `U+200B`, in addition to all earlier path restrictions.
- Empty owned transaction folders are removed with
  `DataAdapter.rmdir(path, false)`, the declared non-recursive primitive. The
  persistent fixture now implements that exact contract. A child injected
  after listing but before removal is preserved and the operation becomes
  ambiguous instead of recursively deleting the child.

### R1 regression GREEN

```text
npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts
Test Files  2 passed (2)
Tests       64 passed (64)
exit 0

npm run test:typecheck
exit 0
```
