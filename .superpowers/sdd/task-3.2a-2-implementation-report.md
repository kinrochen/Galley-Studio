# Task 3.2a.2 Implementation Report

## Status

DONE — R1 remediation included

- Required base: `2ae5c19cc9571d8985618b7c920713ce1388f89f`
- Base HEAD and clean worktree verified before the formal RED
- Task commit: the commit containing this report; its SHA is supplied in the handoff
- Package/lock, Task 3.1 public contracts, `main.ts`, editor/workbench/UI, Phase 2 code, Phase 3 plan, and progress ledger: unchanged
- Task 3.2a.3 plugin/session wiring and quarantine acceptance UI: intentionally not started

## Outcome

Implemented `ObsidianWorkbenchVault`, one production adapter satisfying both
`GalleyDocumentVault<ObsidianPairObservation, ObsidianPairOwnership,
ObsidianHistoryObservation>` and `HistoryVault<ObsidianHistoryObservation>`.
It composes the exact-observation file store and strict WAL from Task 3.2a.1,
without weakening either public repository contract.

The adapter now provides:

- exact, adapter-provenanced pair/history observations and pair ownership;
- fail-closed rejection of cloned, foreign, stale, or wrong-scope handles;
- recoverable pair replace/create/owned-cleanup transactions;
- durable history preparation, atomic promotion/retention, rollback, and acknowledgement;
- one combined pair-plus-history WAL and receipt, not two composed transactions;
- canonical pair/history scope serialization, durable scope locks, and restart routing indexes;
- precommit rollback, postcommit roll-forward, exact target-drift quarantine, and idempotent re-entry;
- exact reconciliation to `committed`, `precommit`, `conflict`, or `unknown`;
- plugin-style integration through real `GalleyDocumentRepository`, `HistoryRepository`, and `DocumentSession` instances.
- identity-proven deletion ownership that never treats matching path, bytes, hash,
  or length as authority to delete a newly-created replacement;
- retryable history-only committed receipts through explicit acknowledgement.

## TDD evidence

### Formal RED

The two production-adapter suites were created before the adapter module. The
required focused command failed at collection because the production boundary
did not exist:

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts

FAIL tests/documents/ObsidianWorkbenchVault.test.ts
FAIL tests/documents/ObsidianTransactionRecovery.test.ts
Failed to resolve ../../src/documents/ObsidianWorkbenchVault
Test Files  2 failed (2)
Tests       no tests
exit 1
```

### R1 formal RED

The R1 rejection cases were added before the remediation and run against the
submitted implementation. The focused command collected 57 tests and failed
the seven intended regressions:

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts

Test Files  2 failed (2)
Tests       7 failed | 50 passed (57)
exit 1
```

The failures proved that matching bytes were incorrectly authorizing deletion
of new-identity replacements in pair-create, pending-history, owned-cleanup,
promoted-final, and live-provisional paths, and that an exact history-only
retry after `after-completed` incorrectly returned `lost`.

### Final GREEN

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts
Test Files  2 passed (2)
Tests       57 passed (57)

npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts
Test Files  4 passed (4)
Tests       152 passed (152)

npm run test:typecheck
exit 0

npm test
Test Files  42 passed (42)
Tests       1004 passed (1004)

npm run build
exit 0
```

The forced two-adapter history interleaving was additionally repeated ten
times after its cleanup-race fix; all ten runs passed. The fix keeps the
durable scope lock through WAL cleanup, and uses the exact scope index to clean
an id-matching orphan lock if a crash leaves an empty transaction tombstone.
A non-empty partially cleaned directory remains quarantined; it is never
treated as successfully cleaned.

## Public evidence and provenance

The adapter exports plain immutable evidence shapes rather than transaction
handles:

- `ObsidianPairObservation` carries public exact evidence for both pair members.
- `ObsidianPairOwnership` carries exact evidence plus the owned pair member.
- `ObsidianHistoryObservation` carries exact evidence for one history file.

Private `WeakMap` provenance binds those values to the creating adapter, exact
`TFile` observation, canonical pair/history scope, and preparation/retention
transaction when applicable. Copying an object copies its visible evidence but
not its authority. Every mutating entry point resolves the private provenance
and rechecks exact current identity/bytes before registering intent.

Deletion authority has a separate module-private `WeakMap` registry keyed by
the file store's stable backing `Vault` object, then transaction ID and semantic
role/path. Each entry preserves the exact original `TFile` observation. New
adapter instances over the same live Vault share that registry; a different
Vault object (the restart boundary used by tests) has no such authority. A
target may be removed only when the current observation has the same `TFile`
identity and exact path/text/hash/length as the registered original. Matching
path, bytes, hash, length, or stat without identity never grants deletion
ownership.

Pair paths must be distinct same-stem `.galley.html`/`.galley.json` paths.
History paths are re-derived under
`.galley/history/<canonical-sidecar-valid-uuid>/`; provisional, final,
observed, and removal paths are closed against that scope. `readText` derives a
pair or history scope before replay, so a single-member read cannot bypass a
relevant WAL or corrupt scope index.

## Durable schema extensions

Task 3.2a.1's closed manifest/blob schema remains version 1. The transaction
store was extended only with strict optional/derived records:

1. `listAll()` supplies stable strict discovery while malformed records remain
   excluded from unrelated scopes.
2. Completed manifests may bind the immediately preceding committed manifest
   checksum and aggregate digest. The binding is added only when the existing
   receipt exactly matches that committed record, preserving receipt proof
   across the `committed -> completed` manifest change.
3. Target quarantine v2 binds transaction ID, reason, current manifest
   checksum, aggregate digest, sorted exact target evidence
   (`path/state/sha256/byteLength`), and its own checksum. Parsing remains
   closed, canonical, bounded, and aggregate-verified.
4. `cleanup(record, signal, allowIncomplete)` permits exact cleanup of a proved
   precommit intent only where adapter rollback/collision handling requires it.
   It still preflights every exact owned file and rejects unexpected members.
5. The history scope validator accepts the same canonical UUID form already
   admitted by the sidecar contract.

The adapter adds canonical checksummed internal blobs:

- `metadata`: closed operation discriminator;
- `history-plan`: document ID; exact provisional path/text/hash/length; final
  path; ordered observed vector; exact removal vector; checksum;
- `ownership-plan`: exact created/pending ownership needed for restart cleanup.

It also adds closed routing/admission records:

```text
.galley/transactions/
  locks/<sha256(canonical-scope-key)>.lock       # exact text = transaction UUID
  scopes/pair-<scope-hash>/<transaction>.json
  scopes/history-<document-hash>/<transaction>.json
```

Each scope index contains only schema version, exact transaction UUID, exact
canonical scope, and checksum. It is created exclusively after the WAL is
durable. Normal finalization orders cleanup as `WAL -> exact lock -> exact
scope index`, leaving the index as the crash-recovery marker until both earlier
steps finish. No directory path deletion is used.

## Transaction and recovery state machine

The durable phase graph remains:

```text
prepared -> applying -> committed -> completed
```

| Durable state | Target rule | Recovery decision |
| --- | --- | --- |
| no intent | no adapter-owned target mutation | clean conflict/collision/abort is allowed |
| `prepared` | staged old/new/rollback bytes only | restore the exact precommit state |
| `applying` | one or more conditional mutations may exist | restore the exact precommit state |
| `committed` | commit boundary is durable | finish exact new pair/history state, write/verify receipt, then complete |
| `completed` | receipt predecessor binding is durable | verify receipt and exact forward state; finalize or retain combined proof for reconciliation/acknowledgement |
| valid target quarantine | no further target mutation | typed scope-local recovery conflict / reconciliation `unknown` |

Before recovery mutates anything, it preflights every pair/history target. Each
current target must be absent where allowed or match one of the staged old/new
states. Any other byte state produces one checksummed target quarantine record
and no partial recovery mutations. Hash/text/length evidence can detect drift
or prove bytes to restore, but it cannot authorize deletion. Every rollback
delete requires the live identity registry above; missing provenance or a new
identity produces exact scope quarantine while preserving the bytes. A fully
created pair can roll forward without deletion, and pair overwrite recovery can
restore staged bytes through exact observations, so those cases do not invent
delete authority.

Pair replace stages both old and both new members. Pair create stages absence
plus both new members. Owned cleanup and pending-history preparation stage
exact ownership evidence. History retention stages the complete observed
vector and rollback bytes for every removal. Combined save stages all four pair
blobs and the complete history plan in one `pair-history` record.

The receipt binds both pair paths/hashes and an ordered history evidence vector
whose roles bind provisional, final, observed, and removal paths with hashes
and lengths. Consequently a content-hash multiset with changed roles or paths
does not verify.

## Concurrency and cleanup

Each adapter serializes by canonical pair and history keys, but in-memory
queues are only scheduling aids. Separately constructed adapters compete on an
exclusively created durable scope lock and then recheck all exact target
observations. A losing transaction cleans only its proved WAL/index and returns
a clean conflict only before mutation.

An in-process active-transaction promise prevents one adapter from opening a
WAL while another adapter is exact-cleaning that same UUID directory. It is not
the correctness source: the durable lock, WAL, scope index, receipt, and target
CAS remain authoritative across adapter recreation. The active marker is
abandoned on simulated crash/throw so a recreated adapter can recover.

Normal pair success cleans WAL while still holding its durable lock.
History-only and combined success retain WAL, receipt, exact locks, and scope
indexes until `HistoryRepository` calls `acknowledgeRetention`;
acknowledgement then cleans WAL, releases exact locks, removes exact scope
indexes, and forgets deletion provenance. The retention ID is bound when the
transaction becomes committed. An exact same-plan retry verifies the durable
receipt and final state and returns the idempotent `created` result; a changed
retry plan returns `lost`. Generic postcommit recovery across a true restart
may finalize only when it requires no deletion.

## Crash points and tested outcomes

Deterministic crash hooks cover:

- after durable intent;
- after `applying`;
- after HTML mutation;
- after sidecar mutation;
- after history promotion;
- after each history removal;
- after commit marker;
- after receipt;
- after completed marker.

Permanent tests cover pair replacement and creation at every applicable point,
one-sided creation, partial owned cleanup, history-only retention, combined
pair/history saves, repeated recovery, target drift, receipt replacement,
metadata/blob/quarantine tampering, abort before intent, abort after possible
mutation, and unrelated-scope availability. Tests assert exact backing bytes,
locks/WAL, and history contents rather than only returned statuses.

Normal behavior tests include same-timestamp history collisions, exact newest
20 retention after 22 writes, two-adapter pair CAS, forced concurrent history
replanning without lost snapshots, provisional/final/removal ABA, unexpected
history entries, forged/cloned/foreign handles, and a real edit/save/recreate/
reopen `DocumentSession` flow whose history contains the exact old HTML.

The R1 matrix additionally replaces rollback targets with distinct `TFile`
objects containing identical bytes for one-sided pair creation, pending
history, owned cleanup, promoted finals, and live provisional cleanup. Every
replacement is preserved and quarantined. The negative control recreates the
adapter over the same Vault and confirms that the exact originally registered
identity is still cleanable. Exact after-completed history retry, changed-plan
retry, and repeated acknowledgement are also covered.

## Reconciliation and quarantine outcomes

- `committed`: only an exact requested new pair, exact forward history plan,
  and exact durable combined receipt all verify.
- `precommit`: only the exact original pair and exact rollback history state
  are proved and no committed receipt exists.
- `conflict`: only a proved clean stale/external state before this transaction
  mutated anything.
- `unknown`: corrupt/missing/tampered proof, target quarantine, ambiguous
  cleanup, or any state that cannot distinguish commit from rollback.

Reconciliation first replays only the exact pair/history scope. It never creates
a receipt from current target bytes. Replaced receipts and changed plan evidence
return `unknown` while preserving target bytes. A corrupt/quarantined scope
does not block an unrelated pair or history document.

## Static and scope audit

- `package.json` and `package-lock.json` are byte-identical to the required base.
- No Node built-in import or `require()` was added under the changed production
  source.
- No remote runtime URL was added.
- The adapter uses `ObsidianVaultFileStore.removeOwned` for file removal. Its
  other `.delete()` calls are only JavaScript `Map.delete`; it performs no
  adapter/vault path delete, rename, `rmdir`, or recursive removal.
- Store-owned empty UUID and scope directories remain inert tombstones.
- Only authorized files changed; no public repository contract or composition
  root changed.

## Changed files

- `src/documents/ObsidianWorkbenchVault.ts` — production dual-vault adapter,
  durable operations, recovery, locks/indexes, provenance, and reconciliation.
- `src/documents/ObsidianVaultFileStore.ts` — stable backing-Vault identity used
  as the private live deletion-provenance key.
- `src/documents/ObsidianTransactionStore.ts` — strict discovery, completed
  predecessor binding, exact target quarantine, and controlled incomplete
  cleanup support.
- `tests/documents/ObsidianWorkbenchVault.test.ts` — normal, concurrency,
  retention, handle, ABA, and plugin-style integration coverage.
- `tests/documents/ObsidianTransactionRecovery.test.ts` — crash/restart,
  quarantine, tamper, abort, idempotence, and scoped `readText` recovery.
- `.superpowers/sdd/task-3.2a-2-implementation-report.md` — this report.

## Unavoidable Obsidian platform limits

- `TFile` identity and the module-private deletion registry exist only within a
  live process. A new adapter over the same Vault object retains that authority;
  a true process restart does not. Across that boundary, any rollback requiring
  deletion quarantines and preserves the target even when path, bytes, SHA-256,
  length, and stat match. Recovery does not guess ownership. A postcommit path
  that requires no deletion can still be verified and completed from durable
  WAL/receipt/scope evidence.
- Obsidian's `Vault.create` does not expose a typed collision result. The file
  layer pre-observes and re-verifies the returned identity/bytes; an uncertain
  post-call result remains ambiguous rather than being guessed successful.
- Obsidian exposes no identity-conditional directory delete. Empty transaction,
  lock, and scope directories are intentionally retained; only exact owned files
  are removed.
- A durable lock has no platform-provided process lease. It is admission
  control, while target CAS and WAL decide correctness. Recreated adapters can
  recover an id-matching orphan lock through the checksummed scope index.
- Quarantined-current-byte inspection is available to the next composition/UI
  task, but accepting those bytes is deliberately outside Task 3.2a.2.
