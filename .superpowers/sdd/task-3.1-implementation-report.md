# Task 3.1 Implementation Report

## Status

DONE

- Base: `95a6819cdc658d9501e4e3da9dd18346197f3f8e`
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
- The vault boundary makes pair atomicity explicit: adapters must leave the old
  complete pair or the new complete pair after every result or failure. The
  repository verifies exact returned HTML and sidecar bytes plus the adapter's
  returned opaque observation before reporting a commit.
- Copy creation starts at the Phase 2-compatible numbered sibling (`-2`), treats
  either occupied side as a collision, retries the whole pair, and conditionally
  removes only the adapter-owned pair after verification/abort failure.
- `HistoryRepository` stores snapshots below
  `.galley/history/<lowercase-uuid>/`, uses exclusive collision-retrying names
  that remain unique under equal timestamps, serializes concurrent stores per
  document, sorts by deterministic `(timestamp, path)` order, and retains the
  newest 20 recognized snapshots.
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
  to the saved body restores the exact saved HTML. A monotonic revision protects
  edits made while a save is awaiting history or pair commit.
- Auto and explicit saves re-observe both disk files and compare opaque
  identity/version plus exact HTML hash. Any HTML, sidecar, same-byte ABA, or
  post-observation CAS race yields typed `document_conflict` and preserves dirty
  local content.
- Overwrite intentionally uses the latest observed pair, snapshots its exact
  HTML even when an external HTML-only edit has made the sidecar stale, and then
  replaces the pair through the same CAS primitive.
- Successful saves re-sanitize, hash exact committed HTML, preserve every other
  v1 sidecar field, set `lastSavedAt` from the injected clock, verify the pair,
  and clear conflict only after verification. Clean saves create no history and
  perform no repository write.
- Reentrant saves fail deterministically with
  `document_save_in_progress`. `saving` is reset on every exit; failed saves do
  not clear dirty state. A later edit during an in-flight save remains dirty
  while the observation/hash advance to the committed revision.
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

### Final focused GREEN

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       52 passed (52)
exit 0

npm run test:typecheck
exit 0
```

## Required behavior coverage

- History: newest-20 retention, deterministic oldest-first order, equal-time
  uniqueness, concurrent exact-20 retention, malformed/unrelated preservation,
  traversal-like ID rejection, prune failure, ABA pruning conflict, and abort.
- Open: valid shell, malformed/strict sidecar failures, hash mismatch, invalid
  shell, contradictory pair paths, exact source hash, and missing source.
- Editing: body-only changes, exact shell preservation, whole-document
  sanitizer behavior, unsafe CSS/event/URL/script removal, shell/foreign-token
  rejection, sanitized no-op, and exact revert.
- Save: clean no-op, auto/explicit success, exact prior history, matching strict
  sidecar, HTML/sidecar changes, same-byte ABA, CAS race, overwrite, atomic
  failure, post-commit verification failure, concurrent save rejection, edit
  during save, and abort.
- Reload: valid external replacement, conflict clearing, source-status refresh,
  and malformed reload preserving local state.
- Copy: different UUID, matching hash, unchanged session/original pair,
  one-sided collision, same-name race, atomic creation failure, owned cleanup,
  verification failure, and ABA replacement preservation during cleanup.

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
| Injected atomic replacement failure | old HTML and old matching sidecar remain; session dirty |
| Post-commit verification failure | new HTML and new matching sidecar remain; session dirty |
| Overwrite after external HTML-only edit | exact latest external HTML stored in history; new matching local pair committed |
| Existing one-sided copy candidate | occupied side preserved; whole copy advances to next number |
| Copy candidate appears during create | raced file preserved; whole copy advances again |
| Atomic copy failure | no partial copy pair remains |
| Copy verification failure | only the adapter-owned pair is conditionally removed |
| Copy-path ABA before cleanup | replacement HTML and replacement sidecar both preserved |
| History prune failure | original failure propagates; no path-only deletion or overwrite |
| History snapshot ABA before prune | replacement preserved; typed prune conflict |

The main-pair interface has no path-based delete or general overwrite method.
The history interface deletes only an observed handle. The copy interface cleans
only an opaque ownership handle returned by the exclusive pair-create call.

## Final verification

```text
npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts
Test Files  2 passed (2)
Tests       52 passed (52)
exit 0

npm run test:typecheck
exit 0

npm test
Test Files  33 passed (33)
Tests       745 passed (745)
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
implement the documented adapter primitives with true pair-level atomicity,
stable identity/version observations, exclusive pair creation, and
identity-conditional cleanup. This task deliberately does not add that Obsidian
runtime adapter or modify the composition root.
