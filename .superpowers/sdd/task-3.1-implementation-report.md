# Task 3.1 Implementation Report

## Status

DONE

- Base: `95a6819cdc658d9501e4e3da9dd18346197f3f8e`
- Independent-review remediation base:
  `b9a65aedd6443392213632a5827360f481d8f0af`
- Independent-review R2 remediation base:
  `f098c7d26662db9cdb3327738fd4bd06337dc5c7`
- Independent-review R3 remediation base:
  `79daf6cc35f1b570c11aa5facc2eccdb2407b451`
- Independent-review R4 remediation base:
  `2a5f28b5e695af972435a388a96c7b85efc7497c`
- Independent-review R5 remediation base:
  `acf09ea1b3e5c16b891605cc0bfab1c49056f927`
- Independent-review R6 remediation base:
  `0741b71f0f94509c43238ff906f2d1cd41191e19`
- Task commit: the commit containing this report; its exact SHA is recorded in
  the implementation handoff because a Git commit cannot contain its own hash.
- Progress ledger: not edited
- Phase plan: not edited
- Package files: not edited
- Blocking concerns: none

## Outcome

Implemented a pure document-session persistence layer for generated Galley
HTML/sidecar pairs:

- `GalleyDocumentRepository` validates matching normalized vault-relative pair
  paths, hashes the exact HTML text, wraps adapter identity/version values in an
  opaque repository-owned observation, and exposes atomic compare-and-replace
  and exclusive numbered-copy operations.
- The vault boundary exposes transactional replace/create primitives. The
  concrete reference adapter stores files, commit markers, and recovery
  journals in a durable backing object shared across destroyed/recreated
  adapter instances. Crash injection bypasses the originating catch. The next
  adapter replays the journal before any read can expose a mixed pair; failed
  recovery retains the journal for a later successful reopen.
- Copy creation starts at the Phase 2-compatible numbered sibling (`-2`), treats
  either occupied side as a collision, retries the whole pair, and conditionally
  removes each still-owned member after verification/abort failure. Cleanup
  registers the complete ownership tuple durably before either member, so a
  throw or crash between members is replayable. One-sided ABA replacements are
  preserved without retaining Galley's stale counterpart.
- `HistoryRepository` prepares invisible owned `.pending` snapshots below a
  sidecar-schema-compatible canonical lowercase UUID folder and exposes an
  opaque, observed retention plan. The document adapter commits the main pair,
  promotes that exact prior-version preparation, and applies all retention
  removals through one durable transaction journal. A pre-marker recovery rolls
  the pair back and removes its preparation; a post-marker recovery rolls the
  pair and history forward together. Post-mutation failures converge to exactly
  the newest 20 across independent repository/adapter instances.
- History ignores malformed and unrelated files. Pruning passes opaque observed
  handles to the adapter; an ABA/replacement causes a typed
  `history_prune_conflict` instead of path-only deletion.
- `DocumentSession.open` strictly parses the v1 sidecar and standalone HTML
  shell, verifies the sidecar against the exact disk HTML hash, obtains the
  source path only from the sidecar, and compares exact source text hashes.
  Missing source is deterministic (`sourceChanged: true`).
- Body updates pass through `GalleyDocumentCodec`, whole-document authoring
  sanitization, and a second codec parse. Doctype, language, and head are checked
  unchanged. Shell tokens, foreign namespaces, recovery-dependent fragments,
  active URL schemes, event handlers, executable elements, and unsafe CSS
  cannot enter retained session HTML.
- Dirty state changes only when the effective sanitized body changes. Returning
  to the saved body restores the exact saved HTML. After commit it is derived
  from final exact-content inequality, so B -> C -> B during a save is clean
  while a newer different edit remains dirty.
- Auto and explicit saves re-observe both disk files and compare opaque
  identity/version plus exact HTML hash. Any HTML, sidecar, same-byte ABA, or
  post-observation CAS race yields typed `document_conflict` and preserves dirty
  local content.
- Overwrite intentionally adopts the latest valid sidecar as identity and
  provenance owner, snapshots its exact paired HTML even when an external
  HTML-only edit has made the sidecar stale, and changes only `htmlHash` before
  replacing through the same CAS primitive.
- Successful saves re-sanitize, hash exact committed HTML, preserve every other
  v1 sidecar field, set `lastSavedAt` from the injected clock, verify the pair,
  and clear conflict only after verification. Clean saves create no history and
  perform no repository write.
- Reentrant saves fail deterministically with
  `document_save_in_progress`. `saving` is reset on every exit; failed saves do
  not silently clear dirty state. Ambiguous post-commit verification/abort
  outcomes reconcile when possible and remain explicitly dirty/conflicted,
  including when history finalization also fails.
- Every catchable adapter throw is reconciled generically at the repository
  boundary. The vault's idempotent reconciliation result proves the exact
  `HistoryCommitPlan`, a `combined-save` receipt, and the requested pair before
  the session can take its history-finalizing post-commit path. Exact old state
  preserves the original precommit error; external/deleted state without a
  matching receipt becomes a conflict and rolls back only the owned pending
  preparation. Unknown or quarantined state becomes typed
  `document_commit_ambiguous`, which cannot enter history commit or rollback.
  Crash conformance tests abandon the upper call stack at the vault boundary
  rather than relying on test-only production error recognition.
- Recovery is resource-scoped. Pair replay preflights the complete pair/history
  ownership set before its first mutation. Identity loss retains the complete
  pair/history journal and opaque handles inside a typed,
  `transaction_recovery_conflict` quarantine for only that transaction.
  Recoverable history mutation is failure-atomically rolled back to one owned
  pending preparation; unsafe rollback leaves the full payload and raw history
  unchanged. Unrelated pairs, source files, and history folders remain usable.
- Create-journal recovery uses cleanup semantics rather than replacement
  quarantine semantics: it observes both members before mutation, preserves
  every external identity, conditionally deletes every member still equal to
  Galley's recorded create ownership, and clears the cleanup journal. This
  remains safe for HTML-only, sidecar-only, and two-member replacement.
- History idempotency receipts are acknowledged after repository commit and
  compacted against retained visible files on later adapter entry, so recovery
  metadata remains bounded with retention rather than growing for the lifetime
  of the backing.
- Reload validates a complete replacement before discarding local state and
  refreshes source status. A malformed reload leaves local content and dirty
  state untouched.
- Save-copy writes the sanitized in-memory document and a strict matching
  sidecar with a different UUID, while preserving provenance and leaving the
  original paths, pair, observation, HTML, dirty/conflict flags, and saved time
  unchanged.

## TDD evidence

### Initial RED

The required focused tests were created before any Task 3.1 production module.

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts

FAIL tests/documents/DocumentSession.test.ts
Failed to resolve ../../src/documents/DocumentSession

FAIL tests/documents/HistoryRepository.test.ts
Failed to resolve ../../src/documents/HistoryRepository

Test Files  2 failed (2)
Tests       no tests
```

### Focused hardening RED

After the initial implementation, a new copy-identity test proved that a
schema-valid injected UUID equal to the original document ID was accepted:

```text
npm test -- tests/documents/DocumentSession.test.ts -t "unchanged document ID"
Test Files  1 failed (1)
Tests       1 failed | 38 skipped (39)
promise resolved instead of rejecting
```

The session now rejects an unchanged copy ID before any pair-create call.

### Independent review R1 remediation RED

The rejected-review reproduction suite was added before the remediation. Its
first focused run exposed 37 failures across the two files (45 tests already
passing), covering staged transaction failures, provisional history, UUID
compatibility, overwrite provenance, ambiguous post-commit state, per-member
copy cleanup, direct repository semantics, and exact dirty-state derivation.

A final audit composed two additional failure windows before their fixes:

```text
npm test -- tests/documents/DocumentSession.test.ts -t \
  "immediately after prepare|history finalization also fails"
Test Files  1 failed (1)
Tests       2 failed | 65 skipped (67)
```

The first failure proved cancellation observed immediately after `prepare`
could strand a pending snapshot. The second proved a history-finalization error
could bypass conservative session state after a post-commit verification
failure. Both now pass.

### Independent review R1 remediation

- Pair mutation is exercised against a staged transactional reference adapter
  after HTML write, after sidecar write, during rollback/cleanup recovery, and
  on abort at every member boundary. Each ordinary fault/abort is recovered
  before the adapter returns control.
- History now has explicit prepare/commit/rollback ownership. CAS losers,
  precommit aborts, and adapter failures remove only their pending snapshot and
  do not prune retained history. R2 subsequently upgrades postcommit
  promotion/pruning to durable roll-forward replay.
- Sidecar UUID validation is the sole identity source of truth. Uppercase,
  v7/v8, and nil UUIDs save under canonical lowercase folders; copy identity
  comparison is case-insensitive after schema validation.
- Overwrite preserves the latest valid sidecar's document identity, source
  linkage, provenance, and model fields while changing only the HTML hash.
- Repository writes reject malformed HTML/sidecar content and exact hash
  mismatches before mutation and repeat semantic verification after commit.
- Copy ownership is per member, so cleanup conditionally removes every member
  still owned by Galley while preserving one-sided external replacements; R2
  persists both handles as one cleanup operation.
- Ambiguous post-commit verification or abort reconciles the durable pair when
  possible and always remains dirty/conflicted. Final dirty state after an
  ordinary commit depends only on exact current-vs-committed HTML.

### Independent review R2 remediation RED

Four permanent reproductions were added before the R2 production-contract
changes:

```text
npm test -- tests/documents/HistoryRepository.test.ts \
  tests/documents/DocumentSession.test.ts \
  -t "recreated adapter exposes|promotion throws after|first removal throws|later prune step fails"
Test Files  2 failed (2)
Tests       4 failed | 85 skipped (89)
```

- C1 exposed a mixed HTML/sidecar pair after recreating an adapter with the
  interrupted durable bytes but no consumed recovery journal.
- I1 left an invisible `.pending` file after promotion threw following the main
  pair commit.
- I2 deleted one retained snapshot, removed the new snapshot on a later failure,
  and returned only 19.
- I6 swallowed the first cleanup error, removed the sidecar, and left Galley's
  owned HTML orphan.

### Independent review R2 remediation

- `MemoryWorkbenchBacking` now owns files and journals independently of any
  adapter instance. Crash stages after HTML, after sidecar, and after the durable
  commit marker bypass same-stack cleanup. Raw backing assertions prove the
  intermediate state and persisted journal; a newly constructed adapter reads
  and replays that journal before exposing the pair.
- Replacement recovery rolls back pre-marker crashes and rolls forward a
  post-marker crash. Unacknowledged copy creation rolls back after crashes at
  every corresponding boundary. An injected recovery failure rejects the read,
  retains the journal, and a later clean adapter reopen completes replay.
- History promotion and all observed retention removals are one durable,
  idempotent adapter transaction. The transaction validates the complete folder
  observation, so adapters racing from 19 or 20 converge to exactly 20.
- History tests cover promotion throws/crashes before and after mutation,
  idempotent retry, recreated-adapter recovery, recovery failure followed by a
  later reopen, rollback throws before and after deletion, and abort while
  waiting in the local queue.
- Multi-delete retention tests interrupt after the first successful removal for
  both an ordinary throw and a crash. Raw state is temporarily 21 with a journal;
  reopening rolls forward to exactly the newest 20, never 19.
- Copy verification cleanup persists the complete two-member ownership tuple
  before either conditional delete. First, second, both, and between-member
  failures recover after restart; external replacements remain untouched while
  every still-owned counterpart is removed.

### Independent review R3 remediation RED

The four independent-review reproductions were added permanently before the
R3 production changes. The ownership case covers both one-member and
two-member identity loss, so the focused RED contained five failing cases:

```text
npm test -- tests/documents/DocumentSession.test.ts \
  tests/documents/HistoryRepository.test.ts \
  -t "caller-level commit-marker|ordinary commit-marker|ownership loss|hidden idempotency"
Test Files  2 failed (2)
Tests       5 failed | 108 skipped (113)
```

- A true caller-level commit-marker crash rolled the pair forward after reopen
  but left its exact prior HTML invisible as an unassociated `.pending` file.
- An ordinary marker fault produced a matching new pair while session cleanup
  removed its required history and did not mark the state conflicted.
- One- and two-member recovery ownership loss blocked unrelated source, pair,
  and history reads, retried forever, and could mutate an earlier member before
  detecting the conflict.
- Sixty stores at limit 20 left 60 hidden idempotency receipts.

### Independent review R3 remediation

- `DocumentSession` now obtains a `HistoryCommitPlan` and passes it with the
  target pair into `replacePairWithHistory`. The adapter persists one journal
  containing the old/new pair members, provisional/promoted history handles,
  and complete removal set before the first pair mutation.
- Prepared-phase replay restores the old pair and removes its owned pending
  history. Committed-phase replay restores the complete new pair, promotes the
  exact pending prior HTML, finishes retention, and records an idempotent
  receipt. A direct vault-boundary process-death test destroys the adapter
  before any repository/session catch and proves recovery on a fresh adapter.
- Repository reconciliation distinguishes exact recovered-new and
  recovered-old outcomes for every ordinary catchable throw. The former is a
  typed post-commit outcome; the latter preserves the original operation error.
- Recovery entry points now select journals by affected pair, member path, or
  history folder instead of sweeping the entire backing. All pair and history
  ownership is preflighted before replay writes. Ownership loss creates a
  durable typed quarantine; R5 subsequently retains its full active payload
  while blocking automatic retry.
- The isolation test repeats affected reads across fresh adapters while proving
  an unrelated text file, another valid pair, and another document's history
  all remain readable and the affected raw bytes remain unchanged.
- Successful history commit acknowledges its provisional receipt. Crash-only
  unacknowledged receipts are compacted when their promoted file leaves the
  retained set. The long-running retention test now bounds both the 20 visible
  snapshots and hidden receipt metadata.

### Independent review R4 remediation RED

Both R4 findings were added as permanent negative reproductions before the
production and recovery changes. The crashed-create reproduction is
parameterized across HTML-only, sidecar-only, and both-member replacement, so
the initial targeted RED contained four failing cases:

```text
npm test -- tests/documents/DocumentSession.test.ts \
  -t "pre-CAS adapter throw|crashed-create members"
Test Files  1 failed (1)
Tests       4 failed | 84 skipped (88)
```

- A pre-CAS hook installed a valid external pair and threw before Galley wrote
  a journal. Repository reconciliation labeled the unproved outcome committed,
  and the session standalone-promoted one history snapshot for a save whose
  target never reached disk.
- A copy create crash after both members, followed by one- or two-member
  external replacement, produced `transaction_recovery_conflict` and retained
  every still-owned counterpart instead of completing safe cleanup.

### Independent review R4 remediation

- `GalleyDocumentVault` now exposes idempotent exact-plan reconciliation with
  four outcomes: `committed`, `precommit`, `conflict`, and `unknown`.
  `committed` requires requested pair bytes plus a visible matching receipt for
  the same provisional identity, final path, complete observation/removal set,
  and `combined-save` transaction kind. A history-only receipt cannot prove a
  combined document commit.
- Proved combined outcomes use `DocumentSavePostCommitError`, a subtype that
  explicitly carries `combinedHistoryProved`. Only that subtype can reach
  `#finishPostCommitFailure` and `history.commit`. A separate
  `DocumentCommitAmbiguousError` has no `committed` property; the session marks
  it dirty/conflicted and performs neither standalone promotion nor rollback.
- External or deleted pair state with no matching receipt returns the normal
  conflict path. The session removes only its owned pending history. The
  permanent pre-CAS test proves the valid external pair remains, recognized
  history stays empty, no pending file or journal remains, and state is
  dirty/conflicted.
- A permanent quarantine test composes a combined retention mutation with pair
  ownership loss. It proves the result is typed ambiguous, does not advertise
  `committed`, leaves the durable quarantine intact, and records no receipt.
- Create recovery now captures both current member identities before any
  cleanup write, executes both injected recovery gates, deletes each member
  only if it still equals the create journal's owned identity, preserves all
  replacements, clears the journal, and never creates a cleanup-only
  quarantine. Repeated fresh adapters and unrelated reads remain usable.

### Independent review R5 remediation RED

The exact 20-history ambiguous-retention scenario was strengthened permanently
before changing recovery. Its targeted RED failed on the first durable-state
invariant:

```text
npm test -- tests/documents/DocumentSession.test.ts \
  -t "keeps a quarantined combined outcome"
Test Files  1 failed (1)
Tests       1 failed | 88 skipped (89)
expected journalCount 1; received 0
```

The reason-only tombstone had discarded the complete pair/history journal. It
also left zero pending preparations and 21 recognized history snapshots after
starting from exactly 20, with no receipt or resolution path.

### Independent review R5 remediation

- `MemoryRecoveryConflict` now retains the complete `MemoryPairJournal`,
  including old/new pair identities, provisional/promoted history handles,
  observed folder, complete removal set, mutation progress, and transaction
  phase. The same journal remains in durable pair recovery storage, and
  `journalCount()` counts a quarantined full transaction exactly once.
- Before quarantine, the adapter preflights every history location it would
  mutate. If safe, it removes only the still-owned promoted snapshot, restores
  every already-removed owned candidate, restores the exact provisional handle,
  and marks the retained history payload rolled back. The permanent 20-entry
  case therefore has exactly 20 recognized snapshots, one `.pending`, zero
  receipts, one counted journal, and one scoped conflict across fresh adapters.
- The rollback is failure-atomic. If the promoted, provisional, or restorable
  removal path has an external identity, no rollback mutation occurs. A second
  permanent test replaces the promoted history entry and proves its bytes,
  21-entry raw history, missing pending state, full journal, and quarantine all
  remain unchanged across reopen.
- The reference adapter exposes explicit
  `acceptCurrentPairAndAbandonQuarantinedTransaction`. Resolution requires both
  current pair members to exactly match caller-supplied accepted bytes, strict
  parsing of the accepted HTML and sidecar, and a sidecar hash matching the
  exact accepted HTML. After the asynchronous hash, it re-observes the current
  exact bytes immediately before synchronous cleanup, retries deferred history
  rollback only when it has become ownership-safe, removes only the exact owned
  pending handle, and then clears the journal/conflict.
  The permanent resolution test accepts a strict hash-matching external
  sidecar, preserves both accepted pair members byte-for-byte, restores normal
  pair/history access, and leaves the exact original 20 history snapshots with
  no pending state.
- Existing replacement quarantine remains resource-scoped and now retains its
  full counted transaction; create-mode cleanup remains independently
  decidable and never enters quarantine.

### Independent review R6 remediation RED

Three permanent acceptance-boundary cases were added before changing the
resolver:

```text
npm test -- tests/documents/DocumentSession.test.ts \
  -t "explicitly resolving a quarantined pair"
Test Files  1 failed (1)
Tests       3 failed | 90 skipped (93)
```

Malformed sidecar JSON, invalid standalone HTML paired with a strict matching
sidecar, and a valid strict sidecar carrying the wrong exact HTML hash were all
accepted. Each promise resolved, allowing the resolver to clear durable
pending, journal, and conflict state without first proving a valid Galley pair.

### Independent review R6 remediation

- Explicit acceptance now parses HTML with `GalleyDocumentCodec`, parses JSON
  and validates it with `GalleySidecarV1Schema`, hashes the exact accepted HTML
  with `sha256Text`, and requires exact equality with `sidecar.htmlHash`. Every
  semantic check completes before history rollback or cleanup can mutate state.
- Hashing is asynchronous, so the resolver re-observes both current pair members
  and compares their exact bytes with the accepted values immediately before
  the remaining synchronous critical cleanup section.
- The three permanent negative cases assert that rejection preserves every raw
  external byte, the exact same full journal and conflict objects, one pending
  preparation, 20 recognized history snapshots, one counted journal, and zero
  receipts. The existing valid strict, hash-matching resolution case remains
  green and still clears the owned quarantine safely.

### Final focused GREEN

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       122 passed (122)
exit 0

npm run test:typecheck
exit 0
```

## Required behavior coverage

- History: provisional prepare/rollback invisibility, newest-20 retention,
  deterministic oldest-first order, equal-time uniqueness, cross-adapter
  exact-20 convergence from 19/20/21, failure-atomic multi-delete replay,
  sidecar-compatible UUID canonicalization, malformed/unrelated preservation,
  traversal rejection, promotion/rollback/recovery failure, ABA pruning
  conflict, queued abort, restart, recoverable ambiguous rollback to pending,
  unsafe rollback preflight, explicit quarantine resolution, and rejection of
  malformed HTML/sidecar or exact-hash-mismatching accepted pairs without any
  durable-state mutation.
- Open: valid shell, malformed/strict sidecar failures, hash mismatch, invalid
  shell, contradictory pair paths, exact source hash, and missing source.
- Editing: body-only changes, exact shell preservation, whole-document
  sanitizer behavior, unsafe CSS/event/URL/script removal, shell/foreign-token
  rejection, sanitized no-op, and exact revert.
- Save: clean no-op, auto/explicit success, exact prior history, combined
  pair/history recovery after ordinary throws and true caller-level restart,
  exact-plan receipt proof, pre-CAS external-winner rollback, typed unknown
  outcome without history finalization,
  matching strict sidecar, HTML/sidecar changes, same-byte ABA, CAS race,
  overwrite metadata
  adoption, staged transaction/rollback failures, post-commit verification and
  history failure, concurrent independent sessions, edit/revert during save,
  and abort before, during, and after pair commit.
- Reload: valid external replacement, conflict clearing, source-status refresh,
  and malformed reload preserving local state.
- Copy: different canonical UUID, matching hash, unchanged session/original
  pair, one-sided collision, same-name race, staged creation/cleanup failure,
  durable whole-ownership cleanup, first/second/both and between-member cleanup
  failure, verification failure, restart, and one- or two-sided ABA replacement
  preservation during both verification cleanup and crashed-create recovery.

## Security and shell audit

| Boundary | Enforcement | Evidence |
| --- | --- | --- |
| Pair/source paths | Existing normalized vault-relative validator plus matching `.galley.html`/`.galley.json` stem | absolute, traversal, wrong suffix, contradictory pair tests |
| Sidecar | `GalleySidecarV1Schema` on open, save construction, copy construction, and verification | malformed/strict/hash/provenance tests |
| Exact bytes | `sha256Text` over the exact HTML/source strings returned by the adapter | open/save/copy hash assertions |
| Body shell | codec serialize before sanitizer; codec parse after sanitizer; explicit doctype/lang/head equality | shell smuggling and preservation tests |
| Active content | complete document through `sanitizeAuthoringDocument` on update and again on save/copy | event, script, active URL, unsafe CSS tests |
| Foreign/recovery markup | existing strict lexical scanner reached through the codec before any retained update | SVG and shell-escape corpus cases |
| Runtime purity | no `obsidian`, Node built-in, `require`, or composition-root import in the three production modules | staged source scan |

## Atomicity and ownership audit

| Event | Durable result asserted |
| --- | --- |
| External HTML/sidecar or same-byte ABA before save | external pair preserved; typed conflict; no replace call |
| Race after re-observation | adapter CAS rejects; raced pair preserved; local session dirty/conflicted |
| Crash after replacement HTML/sidecar | raw backing is interrupted with journal; recreated adapter rolls back before exposing a read |
| Crash after durable replacement marker | recreated adapter rolls forward the complete new pair before exposing a read |
| Crash after combined save marker | recreated adapter rolls forward the complete new pair and promotes its exact prior HTML |
| Ordinary throw after combined save marker | repository reconciles the recovered new pair; session remains dirty/conflicted and history is finalized |
| Pre-CAS throw after an external winner | no combined receipt exists; external pair remains, pending history rolls back, and no snapshot is promoted |
| Unknown/quarantined combined outcome | typed non-committed ambiguity remains dirty/conflicted and cannot call standalone history commit/rollback |
| Pair/history ownership loss before replay | all members are preflighted; complete journal remains counted and resource-scoped without unrelated-resource denial |
| Safe history rollback before quarantine | promoted history is removed, owned removals are restored, and exact prior HTML returns to one pending preparation beside exactly 20 recognized snapshots |
| Unsafe history rollback before quarantine | preflight performs no mutation; external history bytes and complete transaction payload remain quarantined for later resolution |
| Invalid external-pair acceptance | malformed HTML/sidecar or wrong exact hash is rejected before rollback/cleanup; every external byte and the exact pending, journal, conflict, history, and receipt state remain unchanged |
| Valid external-pair acceptance | strict, exact-hash-matching caller-selected bytes are rechecked immediately before cleanup and preserved; owned pending state and full quarantine clear; exact history becomes accessible |
| Recovery failure | read rejects and journal remains; later clean reopen completes replay |
| Post-commit verification failure | new HTML and new matching sidecar remain; session dirty |
| Overwrite after external HTML-only edit | exact latest external HTML stored in history; new matching local pair committed |
| Existing one-sided copy candidate | occupied side preserved; whole copy advances to next number |
| Copy candidate appears during create | raced file preserved; whole copy advances again |
| Crashed copy creation | recreated adapter replays the journal and removes every unacknowledged member |
| Crashed copy creation plus external member replacement | every replacement is preserved; each still-owned counterpart is removed; journal clears without quarantine |
| Copy verification/cleanup failure | complete ownership tuple remains journaled until each still-owned member is removed |
| Crash between copy cleanup members | raw backing can be one-sided only behind a journal; reopen removes the remaining owned member |
| One-sided copy-path ABA before cleanup | replacement member preserved; Galley-owned counterpart removed |
| History CAS loser/precommit abort | pending snapshot removed; retained history unchanged |
| History promotion failure before mutation | pending snapshot is durably rolled back |
| History promotion failure/crash after mutation | retry/reopen idempotently returns the promoted snapshot |
| History multi-delete failure/crash | journal rolls forward from temporary 21 to exactly the newest 20 |
| History rollback/recovery failure | journal survives and a later adapter reopen completes cleanup/replay |
| History snapshot ABA before prune | replacement preserved; typed prune conflict |
| Cross-instance history pruning | stale removal re-lists until exactly 20 snapshots remain |
| Long-running history retention | visible files remain at 20 and acknowledged/compacted receipts remain bounded |

The main-pair interface has no path-based delete or general overwrite method.
The history interface applies only complete observed-folder retention plans.
The copy interface registers the opaque two-member ownership tuple before any
cleanup mutation. Every adapter entry point must replay unfinished journals
before exposing persistent state.

## Final verification

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       122 passed (122)
exit 0

npm run test:typecheck
exit 0

npm test
Test Files  33 passed (33)
Tests       815 passed (815)
exit 0

npm run build
tsc --noEmit && node esbuild.config.mjs production
exit 0

git diff --check 95a6819cdc658d9501e4e3da9dd18346197f3f8e..HEAD
exit 0

git diff -- package.json package-lock.json
no output; exit 0
```

Commit-boundary `git status --short` and `git diff --name-only` evidence is
included in the final implementation handoff, after the commit exists.

## Changed files

- `.superpowers/sdd/task-3.1-implementation-report.md`
- `src/documents/GalleyDocumentRepository.ts`
- `src/documents/HistoryRepository.ts`
- `src/documents/DocumentSession.ts`
- `tests/documents/HistoryRepository.test.ts`
- `tests/documents/DocumentSession.test.ts`
- `tests/support/workbenchFixtures.ts`

## Residual risks

No known Task 3.1 logic defect remains. The future Obsidian composition task must
implement the proven transaction protocol with durable recovery state, stable
identity/version observations, exclusive pair creation/promotion, per-member
identity-conditional cleanup from a whole-operation journal, a single durable
pair-plus-history save boundary, scoped recoverable quarantine, bounded
receipt acknowledgement/compaction, exact combined-receipt reconciliation,
full-payload quarantine with ownership-safe history rollback and explicit
resolution whose accepted HTML/sidecar is strictly validated and exact-hash
matched before mutation, with a final exact-byte recheck after asynchronous
validation, mode-aware create cleanup, and the same restart/failure-stage
adapter-conformance coverage. This task
deliberately does not add that Obsidian runtime adapter or modify the composition
root.
