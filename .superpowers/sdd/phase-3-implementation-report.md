# Phase 3 Implementation Report: Complete Desktop Workbench

- Base: `2dd1aabdffbf25c93443a101d92819e2d01a8148`
- Delivery model: one integrated Phase 3 implementation and one stage gate
- Date: 2026-07-15

## Outcome

Phase 3 now provides the complete desktop Galley editing loop:

1. A strict production opener accepts only canonical `*.galley.html` paths and derives the same-stem `*.galley.json` sidecar.
2. One plugin-scoped production composition shares `ObsidianWorkbenchVault`, `GalleyDocumentRepository`, and a 20-item `HistoryRepository` without exposing generic observation or ownership handles to UI code.
3. The Obsidian ItemView renders the approved toolbar, left workflow/outline/history rail, central canvas, and right property inspector.
4. Preview, visual, and body-source modes preserve the full Authoring shell. HugeRTE is loaded only through the desktop editor factory's dynamic boundary.
5. Editor display resources are rewritten to Obsidian URLs and restored to canonical vault-relative paths before every session update and save.
6. Current-document component roles, outline navigation, paragraph/color/spacing, image, link, and table controls operate without inventing cross-theme templates.
7. Changes autosave after 800 ms, flush safely before close or document replacement, stop on conflicts, and expose reload, save-copy, and explicit-overwrite decisions.
8. History shows the newest 20 versions and restores a retained snapshot as dirty without silently writing it to the main document.
9. Generation opens the committed Galley HTML automatically. A workbench-open failure does not misreport or roll back an already committed pair.
10. Commands and file-menu actions recognize only canonical Galley HTML files. No ordinary `.html` extension is claimed.

## Production composition and recovery

- `ObsidianDocumentSessionOpener` owns one production adapter/repository/history set per plugin instance.
- Open and reload use a bounded stable observation window so the facade document ID and history scope cannot be mixed with a concurrently replaced pair.
- Restart integration covers open, edit, save, history, retained restore, plugin recreation, committed transaction replay, and scoped external-drift quarantine.
- The workbench surfaces ready, ambiguous, and quarantined recovery states. Ambiguous or quarantined saves pause autosave and never imply overwrite authority.
- The review-clean `ObsidianWorkbenchVault`, `ObsidianTransactionStore`, and `ObsidianVaultFileStore` contracts were not weakened or rewritten.

## Main implementation files

### Production session composition

- `src/documents/DocumentSessionOpener.ts`
- `src/documents/ObsidianDocumentSessionOpener.ts`

### Editor and preview

- `src/editor/EditorResourceResolver.ts`
- `src/editor/ThemeComponentCatalog.ts`
- `src/editor/ComponentTransformer.ts`
- `src/editor/HtmlEditorAdapter.ts`
- `src/editor/HugeRteAdapter.ts`
- `src/preview/SafeHtmlPreview.ts`

### Workbench

- `src/workbench/WorkbenchState.ts`
- `src/workbench/GalleyWorkbenchView.ts`
- `src/workbench/WorkbenchToolbar.ts`
- `src/workbench/DocumentOutline.ts`
- `src/workbench/PropertyInspector.ts`
- `src/workbench/AutosaveController.ts`
- `src/workbench/ConflictBanner.ts`
- `src/workbench/HistoryPanel.ts`

### Plugin integration

- `src/main.ts`
- `src/commands/GenerateCurrentArticle.ts`
- `styles.css`

## Test coverage added

- strict opener paths, missing pairs, stable facade identity, and hidden generics
- production adapter restart, combined save/history recovery, and scoped quarantine
- production workbench open/edit/resource restore/save/reopen/history restore
- workbench registration, explicit Galley command/menu filtering, and automatic generation opening
- workbench reducer, layout, three-mode lifecycle, close/document-switch flush, conflict decisions, history, recovery states, and mobile preview-only behavior
- scriptless sandboxed preview with restrictive CSP and no referrer
- HugeRTE temporary resource markers kept only inside the editor boundary, exact source navigation, and existing async teardown matrix
- cross-realm iframe property controls, current-theme catalog, and component transformation

## Stage gate evidence

```text
npm test -- tests/documents tests/editor tests/workbench tests/preview tests/integration
28 files, 641 tests passed

npm run test:typecheck
passed

npm test
56 files, 1143 tests passed

npm run build
passed; main.js 2,463,810 bytes; styles.css 7,863 bytes

git diff --check
passed
```

Static checks also confirmed:

- no static `HugeRteAdapter` or `hugerte` import from `main.ts`, workbench, commands, or platform startup modules;
- no `registerExtensions(["html"])` or equivalent ordinary HTML claim;
- no runtime `hugerte/` asset directory;
- package and lock files unchanged;
- no visible en dash or em dash in the new workbench UI strings.

## Visual direction

The workbench uses Obsidian semantic tokens rather than a second UI system. The layout is a restrained editorial tool with variance 4, motion 2, and density 7: compact desktop rails, a paper-width canvas, one accent source, consistent 8 px panel radii, explicit focus states, and deterministic narrow-window collapse.

## Known limits and deferred scope

- Phase 4 will add the dedicated mobile Galley preview view and export profiles. Phase 3 deliberately does not register desktop editing on mobile.
- Phase 4 export UI and Phase 5 Theme Lab/custom Skill package management are not started here.
- Quarantined transaction state is surfaced and writes are blocked; destructive or manual quarantine resolution is intentionally not guessed by the workbench.
- Source mode edits only the Authoring body by design. The document shell remains codec-owned.
