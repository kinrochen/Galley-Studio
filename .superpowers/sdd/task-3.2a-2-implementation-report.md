# Task 3.2a.2 Implementation Report

## Status

DONE — R1, R2, R3, R4, and R5 remediation included

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
- plugin-style integration through real `GalleyDocumentRepository`, `HistoryRepository`, and `DocumentSession` instances;
- identity-proven deletion ownership that never treats matching path, bytes, hash,
  or length as authority to delete a newly-created replacement;
- retryable history-only committed receipts through explicit acknowledgement;
- fresh-runtime compaction of exact orphan combined receipts without losing or
  duplicating pair/history state;
- WAL-independent closing proof with target revalidation throughout combined
  receipt compaction;
- live-identity WAL cleanup admission: all eight members must still be the exact
  `TFile` observations captured from one stable full aggregate before deletion;
- durable route admission, cleanup-complete evidence, and redundant pair/history
  closing routes that keep either scope connected when an ordinary index is lost;
- permanent pair/history closing-route and closing-final tombstones whose missing
  or malformed sibling fails closed without blocking unrelated scopes;
- same-runtime promoted-final identity binding for completed history retries, so
  a same-byte new `TFile` is preserved and rejected rather than accepted as the
  original transaction result.

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

### R2 formal RED

The R2 blocker and cleanup crash matrix were added before production changes
and run against R1 HEAD `5ed471adb56b8ded043b856918786ac895c2d834`:

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts

Test Files  1 failed | 1 passed (2)
Tests       4 failed | 57 passed (61)
exit 1
```

The fresh-runtime test reproduced `Galley history retention did not converge.`
after all 128 lock retries. The other three tests proved that no orphan
compaction, and therefore no crashable `WAL -> locks -> indexes` cleanup, was
being attempted.

### R3 formal RED

The R3 in-cleanup race matrix was added before production changes and run
against R2 HEAD `cd296bace5f7b87bdcc3bc9ac8f4ecf1ebfa0d6a`:

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts

Test Files  1 failed | 1 passed (2)
Tests       6 failed | 63 passed (69)
exit 1
```

All six planned-target races (first/middle/last combined WAL deletion, each for
pair HTML and promoted history final) incorrectly resolved and erased all
proof/locks/indexes instead of retaining a scoped recovery conflict.

### R4 formal RED

The R4 public-retry, member-cleanup, and post-WAL routing reproductions were
added before production changes and run against R3 HEAD
`d91f1f36490a4c090bb6375c693bc4c7b32531a7`:

```text
npx vitest run tests/documents/ObsidianTransactionRecovery.test.ts

Test Files  1 failed (1)
Tests       5 failed | 66 passed (71)
exit 1
```

The failures proved that a real `HistoryRepository` retry was marked inactive,
fresh runtimes could not resume after the first or middle WAL member deletion,
and loss of either the pair or history scope index disconnected that scope
from a still-valid post-WAL closing proof. Last-member deletion already reached
the prior empty-folder recovery path, while malformed indexes already failed
closed; both remain permanent positive controls.

### R5 formal RED

The four R5 rejection reproductions were added before production changes and
run against R4 HEAD `631c84fa6282c22cfa26f688f281c1536485827c`:

```text
npx vitest run tests/documents/ObsidianTransactionRecovery.test.ts

Test Files  1 failed (1)
Tests       4 failed | 71 passed (75)
exit 1
```

The failures proved that a fresh runtime treated a missing combined metadata
member as its own interrupted progress, deleted a same-byte replacement
metadata `TFile`, lost one scope after an interrupted first route creation plus
ordinary-index loss, and let a real `HistoryRepository` retry accept a
same-byte replacement promoted final.

The ensuing protocol-order audit added two more permanent RED cases. Both
showed that an admitted pair/history route removed immediately after the last
WAL deletion was detected only after locks, indexes, and active proof had been
retired. The close path now revalidates the admitted route set before consumed
pending cleanup, lock release, final-marker creation, and active-evidence
retirement.

### Final GREEN

```text
npm test -- tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts
Test Files  2 passed (2)
Tests       102 passed (102)

npm test -- tests/documents/ObsidianVaultFileStore.test.ts tests/documents/ObsidianTransactionStore.test.ts tests/documents/ObsidianWorkbenchVault.test.ts tests/documents/ObsidianTransactionRecovery.test.ts
Test Files  4 passed (4)
Tests       197 passed (197)

npm run test:typecheck
exit 0

npm test
Test Files  42 passed (42)
Tests       1049 passed (1049)

npm run build
exit 0
```

The forced two-adapter history interleaving was additionally repeated ten
times after the R5 fix; all ten rounds passed both the pair-CAS and history
interleaving cases. The fix keeps the
durable scope lock through WAL cleanup, and uses the exact scope index to clean
an id-matching orphan lock if a crash leaves an empty transaction tombstone.
A non-empty partially cleaned combined directory is never resumed from hashes,
lengths, missing paths, or durable proof alone. Without the original live
eight-member identity vector it remains a scoped recovery conflict. Only an
exact full live cleanup followed by the checksummed cleanup-complete marker can
resume after the WAL directory has become empty.

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

A second backing-keyed ephemeral registry binds a retention transaction ID to
both the exact provisional identity and the exact promoted-final identity.
History-only and combined transactions register it at the committed boundary,
before postcommit crash hooks. Recreated adapters over the same Vault therefore
return only the original promoted `TFile`; a same-byte replacement is a
`history_prune_conflict`. A fresh Vault/runtime has no such identity authority
and falls back to the closed durable receipt/content proof.

A third backing-keyed ephemeral registry binds a combined closing proof to the
exact eight-member WAL identity vector captured while the complete stable
aggregate is still present. Physical cleanup preflights the whole directory and
every original `TFile` before deleting the first member. Once any member is
missing or replaced, a fresh runtime cannot reconstruct that authority and the
scope remains fail-closed. Acknowledgement/finalization forgets all three live
registries.

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
6. `cleanupEvidence(record, receipt)` derives a closed, sorted vector of exact
   WAL member paths, SHA-256 hashes, and byte lengths only from a stable valid
   completed aggregate whose exact receipt is present. The vector is captured
   before any member deletion and is never reconstructed from a partial WAL.

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
  closing/<transaction>.json
  closing/<transaction>.quarantine.json
  closing-admission/<transaction>.json
  closing-cleaned/<transaction>.json
  closing-route/pair-<scope-hash>/<transaction>.json
  closing-route/history-<document-hash>/<transaction>.json
  closing-final/pair-<scope-hash>/<transaction>.json
  closing-final/history-<document-hash>/<transaction>.json
```

Each scope index contains only schema version, exact transaction UUID, exact
canonical scope, and checksum. It is created exclusively after the WAL is
durable. Normal finalization orders cleanup as `WAL -> exact lock -> exact
scope index` for non-combined records, leaving the index as the crash-recovery
marker until both earlier steps finish. Completed combined receipts use the
closing-proof protocol below. No directory path deletion is used.

Before a completed combined receipt can lose any WAL member, the adapter
creates one strict canonical/checksummed closing proof outside the WAL. It
binds transaction ID, exact scope, the complete verified receipt envelope,
pair-after text/hash/length, and the complete signed history plan (provisional,
final, observed, removals, hashes, lengths, and plan checksum). It also binds
the independent closed cleanup vector for every exact manifest/blob/receipt
member. Two scope-hashed canonical/checksummed closing routes bind the same
transaction, scope, and proof checksum, so pair and history entry points can
discover the proof without their ordinary scope index. A route-admission record
is created only after both routes have been stably re-read and binds their
checksum; once admission exists, a missing/malformed route is never recreated.
A cleanup-complete record binds both proof and admission and is created only
after all eight original live WAL identities have been removed and the folder
is empty. A separate checksummed closing quarantine records target evidence if
closing validation fails after WAL deletion. Scope-hashed signed final markers
are created only after cleanup-complete, repeated route admission, and the last
target validation. Both route markers and both final markers are retained as
the permanent closed tombstone after ordinary indexes and active proof are
removed.

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

Fresh-runtime orphan combined recovery is deliberately stricter than ordinary
roll-forward. Before deleting proof it requires a valid committed/completed
manifest, the exact after-pair bytes, exact promoted final, exact retained
observations, absent provisional/removals, and a matching combined receipt. A
committed record may first write its exact receipt and transition to completed
only after that full forward state is already proved. Missing/tampered proof or
external drift remains locked and becomes a scoped recovery conflict/target
quarantine; it is never compacted.

Physical WAL cleanup is admitted only while the exact live identity vector for
the complete stable aggregate still exists. The adapter preflights all eight
members and the exact directory set before deleting the first member. If a
delete throws after applying, or a member is externally missing/replaced, no
remaining member is deleted on a later attempt. Durable hashes and lengths
remain detection evidence only; they never turn a missing member into proof of
the adapter's own progress.

After all eight exact removals and an empty-folder check, the adapter writes the
proof/admission-bound cleanup-complete marker. It then revalidates both admitted
routes before consumed-pending cleanup, before lock release, and before final
marker creation. The full target vector is also revalidated before and after
lock release. Drift writes the independent closing quarantine; missing routes
preserve the active proof/admission/cleanup marker. Only two stable final
markers plus both stable routes authorize retirement of active proof/indexes.
Once that full permanent tombstone exists, later external target edits are
post-completion and legal. Later valid history finals outside the old plan are
likewise ignored and preserved.

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
History-only and live-continuation combined success retain WAL, receipt, exact
locks, and scope indexes until `HistoryRepository` calls `acknowledgeRetention`;
acknowledgement then cleans WAL, releases exact locks, removes exact scope
indexes, and forgets deletion provenance. The retention ID is bound when the
transaction becomes committed. A retry verifies the original durable completed
receipt and final state and returns that receipt's promoted file before
considering the legitimately re-planned final path/observed/removal vector.
`rollbackPrepared` cannot mark the preparation rolled back while that exact
completed retention proof remains.

When the continuation registry is absent after a true restart, exact orphan
combined proof is compacted in the crash-replayable order `closing proof + both
routes + route admission -> exact live WAL cleanup -> cleanup-complete -> route
revalidation -> consumed pending -> route/target revalidation -> pair/history
locks -> route/target revalidation -> both final markers -> active
proof/index/admission cleanup`. The four route/final tombstone files remain.
The consumed pending-preparation WAL is
removed only when its signed path/hash/length exactly match the combined plan
whose forward state and receipt were just verified. Empty transaction
tombstones use their signed scope index plus closing proof/final marker to
finish all matching locks/indexes. A missing/tampered proof without a final
marker, closing quarantine, or non-empty partial proof stays fail-closed.

Live combined acknowledgement uses the same closing-proof protocol as fresh
orphan recovery. History-only acknowledgement retains its existing exact WAL
cleanup path because it does not own a combined pair/history receipt.

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
- after completed marker;
- after recovery WAL cleanup;
- after recovery lock cleanup;
- after recovery index cleanup;
- after recovery proof cleanup.

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

The R2 matrix completes a combined save without acknowledging its receipt,
discards the Vault/adapter/repository, and stores again through a fresh runtime.
It proves exact retention 20, one unchanged combined snapshot, the exact new
pair, no duplicate/lost finals, and complete WAL/lock/index compaction. Each of
the three cleanup boundaries crashes and converges on another fresh adapter.
Fresh receipt tamper and external pair drift are negative controls that retain
proof/locks and return a scoped recovery conflict instead of cleaning.

The R3 matrix injects pair and planned-history drift after the first, middle,
and final combined WAL member deletion. Each case preserves external bytes,
closing proof/quarantine, scope blockers, and unrelated-scope availability on
repeated fresh recovery. Additional controls cover closing-proof tamper and
absence after WAL cleanup, all four cleanup crash boundaries, a later valid
out-of-plan history final, and the same race through live combined
acknowledgement.

The R4 matrix retries an `after-completed` history-only interruption through
the real `HistoryRepository`, including a newly generated plan and repeated
acknowledgement. Its original partial-member convergence expectation was
superseded by R5: first/middle/last
applied-then-throw deletions now remain safely fail-closed because a fresh
runtime cannot prove who removed the missing member. Its ordinary-index and
closing-route cases remain the route-discovery foundation.

The R5 matrix covers externally missing and same-byte-replaced combined
metadata, first/middle/last own deletion interruptions, one-route creation
interruption followed by ordinary-index loss and target drift, admitted-route
loss both before cleanup and immediately after the eighth deletion, cleanup
marker tamper/absence, closing route/final tamper/absence for both scopes,
same-runtime completed-final identity replacement, and legal later pair/history
edits after the permanent closed tombstone. Every unsafe or ambiguous case
preserves external bytes and active evidence while unrelated scopes remain
usable.

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
- Each successfully closed combined transaction intentionally retains four
  small checksummed JSON files (two scope routes and two scope finals). This is
  the explicit safety cost of making both scopes permanently discoverable and
  distinguishing a legal close from missing/tampered active proof.
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
- The retention-continuation registry is likewise process-local and keyed by
  the live Vault object. That limitation is intentional: losing it changes a
  completed combined record from “retain for this handle” to “compact only
  after exact durable forward-state and receipt proof.”
- The combined-cleanup identity vector is also process-local. If cleanup is
  interrupted after any WAL member is removed but before cleanup-complete is
  durable, later runtimes preserve the remaining files and report a scoped
  recovery conflict. Availability is deliberately traded for non-destructive
  ownership semantics; repair/acceptance belongs to the later quarantine UI.
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
