# Phase 4 Implementation Report: Export Profiles and Mobile Preview

- Base: `6a4725eb0162a4c321d691976cd0f8362f99cff4`
- Delivery model: one integrated Phase 4 implementation and one stage gate
- Date: 2026-07-15

## Outcome

Phase 4 completes the independent-output path for Galley documents:

1. The desktop workbench now has persisted export configurations with three built-in profiles: Standard Web, Portable Inline, and WeChat Editor.
2. Every export is created as a new collision-safe HTML artifact. The Authoring `*.galley.html` bytes remain unchanged.
3. Each successful export is recorded in the same-stem sidecar with configuration, profile, timestamp, source/output hashes, repair rounds, and Skill-file provenance.
4. Standard Web produces a complete sanitized document, Portable Inline produces a shell-free self-contained article fragment, and WeChat produces exactly one validated top-level `section`.
5. Rich-text copy writes both `text/html` and semantic `text/plain`, with a deterministic hidden-selection fallback and guaranteed cleanup.
6. The mobile surface registers only the read-only Galley preview. Desktop generation, diagnostics, workbench editing, and model repair are not registered on mobile.
7. Preview accepts only canonical non-empty `*.galley.html` paths, resolves vault-local resources, and renders through the existing scriptless empty-sandbox/CSP/no-referrer boundary.
8. The plugin does not claim ordinary HTML files or register an `.html` extension handler.

## Export contracts

### Standard Web

- Sanitizes the Authoring document and preserves a complete HTML shell.
- Adds provenance as `meta` elements in the exported copy only.
- Does not mutate the source session or source file.

### Portable Inline

- Inlines safe stylesheet declarations and removes external/executable dependencies.
- Emits only the semantic article root, without `html`, `head`, or `body`.
- Removes Authoring-only `data-galley-*` attributes.
- Stores provenance in a safe leading HTML comment instead of adding an application shell.

### WeChat Editor

- Emits exactly one top-level `section`, removes unsupported tags/classes/IDs, sanitizes inline CSS, and wraps every non-empty text leaf in `span[leaf]`.
- Runs the deterministic TypeScript validator before writing and again after provenance stamping.
- Uses pinned gzh-design validator parity fixtures recorded against Skill version `ba1f4175519b481cb3566616c9e5178705067904` and bundled archive hash `8b8b521997cf4e7c3073a390c1fe0a4af19580835edfb4e024670457e46fdc00`.
- Does not execute bundled Python or any absolute-path external script.

## AI repair and Skill boundary

- Deterministic transformation is attempted first. The model is called only when WeChat validation fails.
- Repair is limited to two rounds and keeps the last deterministic candidate if a response is malformed.
- The repair virtual file system exposes exactly `SKILL.md`, `references/theme-index.md`, and `assets/profiles/wechat.md`.
- Tool-capable models explicitly load those three files. The existing Skill-session fallback injects their full required contents when tools are unavailable.
- Every model candidate is sanitized before it can become the next candidate. Event attributes, unsafe or encoded executable URLs, forbidden CSS/dependencies, multiple roots, comments outside the root, and unwrapped text are rejected.
- Desktop repair/model modules are behind a dynamic runtime import and are not statically imported by mobile startup.

## Persistence and concurrency

- Export paths are normalized vault-relative paths and are created exclusively. Existing output and sidecar-reserved historical paths are never reused; proved collisions advance to `-2`, `-3`, and so on.
- A create that may have mutated storage but cannot prove the returned path identity and exact bytes stops with a typed ambiguous-write result. It never continues numbering and therefore cannot silently create a duplicate artifact.
- Export records are strict Zod-validated records. IDs and paths are unique and the sidecar retains at most 256 records.
- A record can be committed only when the session is saved, the source hash matches the current saved bytes, no save is active, and the observed HTML/sidecar pair has not changed externally.
- The sidecar update uses the existing recovery-aware pair replacement while writing the exact same HTML bytes back, so an export record cannot silently rewrite the Authoring document.
- Record failures preserve a proof-oriented `recorded | not-recorded | ambiguous` outcome and the durable artifact path. A verified post-commit cancellation rejects as cancelled while truthfully reporting that the record is durable.
- Workbench exports capture document identity and mount generation, use cancellation, and are settled before close/open save transitions. Stale completions never copy or update the closing/replaced view and are reported with their artifact path.
- `saveCopy()` assigns a new document identity and hash while deliberately starting with an empty export history.

## Consolidated review remediation

The eight Important findings in `.superpowers/sdd/review-phase-4-consolidated.md` were remediated as one integrated batch from commit `99d53f00d2e6d2beaf3e7185e2a739e045c698fc`:

1. Exclusive export create now verifies returned identity and exact stored bytes, and fails closed on mutate-then-throw, identity replacement, or unproved racing outcomes.
2. The production export path passes all sidecar historical paths into the writer, so deleting an old artifact does not release its name for reuse.
3. Numbered document copies no longer inherit export records from the original document.
4. Close and document replacement invalidate and abort at entry, settle every tracked export, then perform the coordinated capture/save path.
5. Export recording, cancellation, stale completion, and clipboard failure retain truthful record outcome and artifact-path presentation. Same-session and cross-session concurrency/recovery cases are covered.
6. Portable output places authored inline declarations after matching stylesheet declarations, and WeChat output migrates sanitized authoring-root theme styles onto its single root section.
7. Export-panel actions defer callback invocation into the Promise boundary; invalid synchronous form values render an accessible owner error without invoking persistence.
8. The Phase 4 integration gate now starts with the recorded model generation pipeline, opens the generated artifact through the production session opener, edits/saves, exports all three profiles, exercises historical reservation, and opens preview through the mobile-registered command and view factory.

## Main implementation files

- `assets/profiles/standard-web.md`
- `assets/profiles/portable-inline.md`
- `assets/profiles/wechat.md`
- `src/export/ExportConfiguration.ts`
- `src/export/ExportProfile.ts`
- `src/export/ExportRecord.ts`
- `src/export/ExportService.ts`
- `src/export/ObsidianExportArtifactWriter.ts`
- `src/export/RichTextClipboard.ts`
- `src/export/WechatRepairService.ts`
- `src/export/WechatRepairSkillPackage.ts`
- `src/export/WechatValidator.ts`
- `src/export/profiles/`
- `src/platform/DesktopGenerationRuntime.ts`
- `src/preview/GalleyPreviewView.ts`
- `src/workbench/ExportPanel.ts`
- `src/workbench/GalleyWorkbenchView.ts`
- `src/documents/DocumentSession.ts`
- `src/documents/GalleySidecar.ts`
- `src/main.ts`
- `styles.css`

## Test coverage added

- all three export output shapes, sanitization, provenance, and source-byte immutability
- collision-safe artifact naming and safe output configuration normalization
- ambiguous exclusive-create handling, returned identity/content verification, racing writers, and historical path reservation after artifact deletion
- export-record schema/path/hash limits, sidecar uniqueness, dirty/mismatched/external-change rejection, and exact HTML preservation
- save-copy export-history reset plus recorded/not-recorded/ambiguous transaction, abort, same-session, and cross-session outcomes
- native rich clipboard payloads and fallback cleanup on both success and failure
- pinned WeChat validator parity fixtures, executable markup rejection, two-round repair, scoped Skill loading, malformed response handling, and candidate sanitization
- export-panel configuration persistence, accessible synchronous validation errors, status/error states, stale async completion reporting, and partial-success copy behavior
- dedicated Galley preview path filtering, local-resource display rewriting, and safe iframe rendering
- desktop/mobile command, view, and file-menu registration boundaries
- an end-to-end recorded-generation workflow that uses the production session, edits and saves, exports all profiles, proves unchanged Authoring bytes, verifies unique sidecar history after deletion/re-export, and opens safe preview through mobile plugin registration

## Stage gate evidence

```text
npm test -- tests/export tests/preview tests/workbench tests/integration tests/platform
26 files, 135 tests passed

npm run test:typecheck
passed

npm test
71 files, 1240 tests passed

npm run build
passed

git diff --check
passed
```

Static checks also confirmed:

- `package.json` and `package-lock.json` are unchanged from the Phase 4 base;
- `main.ts` has no static HugeRTE, OpenAI client, Skill session, generation pipeline, or WeChat repair runtime import;
- the mobile registration test exposes preview only and the static boundary test excludes HugeRTE/model repair runtime imports;
- there is no `registerExtensions(["html"])` or equivalent ordinary HTML claim;
- no real API key, bearer token, request header, or secret value is present in the Phase 4 runtime and asset changes;
- source Authoring bytes remain unchanged across all three exports.

## Known limits and deferred scope

- Mobile is deliberately preview-only; generation, visual/source editing, export, clipboard operations, diagnostics, and Theme Lab remain desktop features.
- Portable CSS inlining supports deterministic ordinary selector blocks. It does not attempt a full browser cascade engine or preserve unsupported at-rules.
- Export files are intentionally independent snapshots. Later Authoring edits do not update an existing export.
- A written export whose subsequent sidecar record fails is retained and reported with its artifact path and proof-oriented record outcome; Galley does not delete a user-visible artifact with an uncertain ownership/history outcome.
- Theme Lab, text-described custom theme generation, local custom theme package management, and broader Phase 5 release hardening are not included in Phase 4.
