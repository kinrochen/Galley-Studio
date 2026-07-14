# Task 3.1 Implementation Report

## Status

DONE

- Base: `95a6819cdc658d9501e4e3da9dd18346197f3f8e`
- Independent-review remediation base:
  `b9a65aedd6443392213632a5827360f481d8f0af`
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
  concrete reference adapter uses a durable in-memory transaction journal,
  staged member writes, identity-conditional rollback/recovery, and abort/fault
  injection after either member write. Every tested failure leaves the old
  matching pair or no created pair, with no recovery journal left behind.
- Copy creation starts at the Phase 2-compatible numbered sibling (`-2`), treats
  either occupied side as a collision, retries the whole pair, and conditionally
  removes each still-owned member after verification/abort failure. One-sided
  ABA replacements are preserved without retaining Galley's stale counterpart.
- `HistoryRepository` prepares invisible owned `.pending` snapshots below a
  sidecar-schema-compatible canonical lowercase UUID folder, promotes only
  after the document CAS commits, and rolls back its own snapshot on precommit
  failure or prune failure. A re-listing retention loop converges to the newest
  20 recognized snapshots across independent repository instances.
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
  on abort at every member boundary. A transaction journal must be empty after
  every outcome.
- History now has explicit prepare/commit/rollback ownership. CAS losers,
  precommit aborts, and adapter failures remove only their pending snapshot and
  do not prune retained history; postcommit prune failure removes the newly
  recognized snapshot. Cross-instance stale pruning re-lists and converges.
- Sidecar UUID validation is the sole identity source of truth. Uppercase,
  v7/v8, and nil UUIDs save under canonical lowercase folders; copy identity
  comparison is case-insensitive after schema validation.
- Overwrite preserves the latest valid sidecar's document identity, source
  linkage, provenance, and model fields while changing only the HTML hash.
- Repository writes reject malformed HTML/sidecar content and exact hash
  mismatches before mutation and repeat semantic verification after commit.
- Copy ownership is per member, so cleanup independently removes every member
  still owned by Galley while preserving one-sided external replacements.
- Ambiguous post-commit verification or abort reconciles the durable pair when
  possible and always remains dirty/conflicted. Final dirty state after an
  ordinary commit depends only on exact current-vs-committed HTML.

### Final focused GREEN

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       85 passed (85)
exit 0

npm run test:typecheck
exit 0
```

## Required behavior coverage

- History: provisional prepare/rollback invisibility, newest-20 retention,
  deterministic oldest-first order, equal-time uniqueness, cross-instance
  exact-20 convergence, sidecar-compatible UUID canonicalization,
  malformed/unrelated preservation, traversal rejection, prune failure, ABA
  pruning conflict, and abort.
- Open: valid shell, malformed/strict sidecar failures, hash mismatch, invalid
  shell, contradictory pair paths, exact source hash, and missing source.
- Editing: body-only changes, exact shell preservation, whole-document
  sanitizer behavior, unsafe CSS/event/URL/script removal, shell/foreign-token
  rejection, sanitized no-op, and exact revert.
- Save: clean no-op, auto/explicit success, exact prior history, matching strict
  sidecar, HTML/sidecar changes, same-byte ABA, CAS race, overwrite metadata
  adoption, staged transaction/rollback failures, post-commit verification and
  history failure, concurrent independent sessions, edit/revert during save,
  and abort before, during, and after pair commit.
- Reload: valid external replacement, conflict clearing, source-status refresh,
  and malformed reload preserving local state.
- Copy: different canonical UUID, matching hash, unchanged session/original
  pair, one-sided collision, same-name race, staged creation/cleanup failure,
  per-member owned cleanup, verification failure, and one- or two-sided ABA
  replacement preservation during cleanup.

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
| Staged replacement/rollback failure or abort | old HTML and old matching sidecar remain; session dirty; journal empty |
| Post-commit verification failure | new HTML and new matching sidecar remain; session dirty |
| Overwrite after external HTML-only edit | exact latest external HTML stored in history; new matching local pair committed |
| Existing one-sided copy candidate | occupied side preserved; whole copy advances to next number |
| Copy candidate appears during create | raced file preserved; whole copy advances again |
| Staged copy/cleanup failure or abort | no partial copy pair remains; journal empty |
| Copy verification failure | each still-owned member is conditionally removed |
| One-sided copy-path ABA before cleanup | replacement member preserved; Galley-owned counterpart removed |
| History CAS loser/precommit abort | pending snapshot removed; retained history unchanged |
| History prune failure | newly recognized snapshot rolled back; original failure propagates |
| History snapshot ABA before prune | replacement preserved; typed prune conflict |
| Cross-instance history pruning | stale removal re-lists until exactly 20 snapshots remain |

The main-pair interface has no path-based delete or general overwrite method.
The history interface deletes/promotes only observed handles. The copy interface
cleans only per-member opaque ownership handles returned by exclusive pair
creation.

## Final verification

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       85 passed (85)
exit 0

npm run test:typecheck
exit 0

npm test
Test Files  33 passed (33)
Tests       778 passed (778)
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
identity-conditional cleanup, and adapter-conformance coverage. This task
deliberately does not add that Obsidian runtime adapter or modify the composition
root.
