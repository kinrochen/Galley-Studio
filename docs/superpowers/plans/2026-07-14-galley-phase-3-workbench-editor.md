# Galley Phase 3: Workbench and HugeRTE Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open generated Galley documents in the approved one-page workbench and let desktop users visually edit, autosave, recover versions, and resolve external file conflicts without touching HTML source.

**Architecture:** A pure `DocumentSession` owns hashes, dirty state, history, and conflict decisions. The Obsidian ItemView owns layout and delegates body editing to an `HtmlEditorAdapter`; HugeRTE is the desktop adapter, while tests use an in-memory adapter. Every editor change is sanitized before the document codec saves it.

**Tech Stack:** Previous phases plus HugeRTE 1.0.12, bundled with esbuild and inline skin CSS.

## Global Constraints

- Use the approved layout: top toolbar, left workflow/outline, center canvas, right inspector.
- Desktop has Edit and advanced Source modes; mobile never initializes HugeRTE.
- Preserve the full Authoring document shell while HugeRTE edits only body HTML.
- Re-sanitize edited HTML before every save.
- Autosave after 800 ms of inactivity.
- Stop autosave on external modification and require reload, save-copy, or explicit overwrite.
- Keep exactly the latest 20 history snapshots per document.
- Do not depend on `obsidian-html-v-editor` being installed.
- Use TDD and commit after each task.

---

## File Map

```text
src/documents/DocumentSession.ts          dirty/save/conflict state machine
src/documents/GalleyDocumentRepository.ts main/sidecar read and atomic update
src/documents/HistoryRepository.ts        twenty-version retention
src/editor/HtmlEditorAdapter.ts           visual editor boundary
src/editor/HugeRteAdapter.ts              bundled desktop implementation
src/editor/EditorFactory.ts                desktop-only dynamic adapter loading
src/editor/SourceBodyEditor.ts            optional advanced body-source editor
src/editor/EditorResourceResolver.ts      vault image/link display URLs
src/generated/hugerteSkin.ts              generated inline skin CSS
tools/embed-hugerte-assets.mjs             deterministic skin generator
src/workbench/WorkbenchState.ts            pure UI state
src/workbench/GalleyWorkbenchView.ts       ItemView composition
src/workbench/WorkbenchToolbar.ts          top actions/status
src/workbench/DocumentOutline.ts           source-aware heading navigation
src/workbench/PropertyInspector.ts         content/page controls
src/editor/ThemeComponentCatalog.ts        role templates found in current document
src/editor/ComponentTransformer.ts         safe block-role conversion
src/preview/SafeHtmlPreview.ts             shared scriptless preview primitive
```

Test support lives in `tests/support/workbenchFixtures.ts`. It exports `memoryVault`, `makeSessionDeps`, an `InMemoryHtmlEditorAdapter`, and Obsidian ItemView stubs. The fake editor records mount/set/destroy calls and emits changes only when the test invokes `emitChange(html)`.

### Task 1: Add document sessions, history, and conflict-safe saves

**Files:**
- Create: `src/documents/GalleyDocumentRepository.ts`, `src/documents/HistoryRepository.ts`, `src/documents/DocumentSession.ts`
- Create: `tests/documents/HistoryRepository.test.ts`, `tests/documents/DocumentSession.test.ts`
- Create: `tests/support/workbenchFixtures.ts`

**Interfaces:**
- Consumes: `GalleyDocumentCodec`, `GalleySidecarV1`, vault adapter, sanitizer
- Produces: `DocumentSession.open`, `updateBody`, `save`, `reload`, `saveCopy`
- Produces: `DocumentSessionState { dirty; saving; conflict; htmlHash; sourceChanged }`

- [ ] **Step 1: Write failing history and conflict tests**

```ts
import { expect, it } from "vitest";
import { HistoryRepository } from "../../src/documents/HistoryRepository";

it("retains the newest twenty snapshots", async () => {
  const repo = new HistoryRepository(memoryVault(), 20);
  for (let i = 0; i < 22; i += 1) await repo.store("doc-1", `v${i}`, new Date(2026, 0, 1, 0, 0, i));
  expect((await repo.list("doc-1")).map(item => item.html)).toEqual(Array.from({ length: 20 }, (_, i) => `v${i + 2}`));
});
```

```ts
import { expect, it } from "vitest";
import { DocumentSession } from "../../src/documents/DocumentSession";

it("blocks autosave after an external modification", async () => {
  const deps = makeSessionDeps();
  const session = await DocumentSession.open(deps);
  session.updateBody("<p>local</p>");
  deps.repository.replaceExternally("<p>external</p>");
  await expect(session.save("auto")).rejects.toMatchObject({ code: "document_conflict" });
  expect(session.state().conflict).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify the modules are missing**

Run: `npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts`

Expected: FAIL because the session repositories do not exist.

- [ ] **Step 3: Implement session and conflict contracts**

```ts
export interface DocumentSessionState {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  htmlHash: string;
  sourceChanged: boolean;
  lastSavedAt: string | null;
}
export type SaveReason = "auto" | "explicit" | "overwrite";
```

`open` reads HTML and sidecar, verifies `htmlHash`, and stores the observed vault mtime/hash. `updateBody` sanitizes the body, updates the in-memory full document, and sets dirty. Before save, re-read the on-disk hash. A mismatch sets conflict and throws unless reason is `overwrite`. A successful save stores the prior HTML in history, atomically updates HTML then sidecar, and clears dirty/conflict. `saveCopy` uses the Phase 2 collision-safe repository and never changes the current paths.

`sourceChanged` compares the current Markdown SHA-256 to sidecar `sourceHash`; it is informational and never regenerates automatically.

- [ ] **Step 4: Verify session behavior**

Run: `npm test -- tests/documents/HistoryRepository.test.ts tests/documents/DocumentSession.test.ts && npm run test:typecheck`

Expected: tests PASS for autosave, explicit save, conflict, reload, overwrite, save-copy, and twenty-version retention.

- [ ] **Step 5: Commit document sessions**

```bash
git add src/documents tests/documents tests/support/workbenchFixtures.ts
git commit -m "feat: add conflict-safe document sessions"
```

### Task 2: Bundle HugeRTE and implement the editor adapter boundary

**Files:**
- Create: `src/editor/HtmlEditorAdapter.ts`, `src/editor/HugeRteAdapter.ts`, `src/editor/EditorFactory.ts`, `src/editor/SourceBodyEditor.ts`
- Create: `src/generated/hugerteSkin.ts`, `tools/embed-hugerte-assets.mjs`
- Create: `tests/editor/HugeRteAdapter.test.ts`, `tests/editor/SourceBodyEditor.test.ts`
- Modify: `package.json`, `package-lock.json`, `esbuild.config.mjs`, `styles.css`

**Interfaces:**
- Produces: `HtmlEditorAdapter.mount/getHtml/setHtml/focus/destroy`
- Consumes: sanitized body HTML, document base URL, `onChange`

- [ ] **Step 1: Write failing adapter-contract tests**

```ts
import { expect, it } from "vitest";
import { SourceBodyEditor } from "../../src/editor/SourceBodyEditor";

it("implements the same body editor contract as HugeRTE", async () => {
  const host = document.createElement("div");
  const changes: string[] = [];
  const editor = new SourceBodyEditor();
  await editor.mount(host, "<p>one</p>", { documentBaseUrl: "app://vault/", onChange: value => changes.push(value) });
  editor.setHtml("<p>two</p>");
  expect(editor.getHtml()).toBe("<p>two</p>");
  editor.destroy();
  expect(host.childElementCount).toBe(0);
});
```

- [ ] **Step 2: Install HugeRTE and verify the contract test fails**

Run: `npm install hugerte@1.0.12 --save && npm test -- tests/editor`

Expected: FAIL because editor adapters are missing.

- [ ] **Step 3: Implement adapters and generated skin assets**

```ts
export interface HtmlEditorMountOptions {
  documentBaseUrl: string;
  onChange(html: string): void;
  onSelectionChange?(element: HTMLElement | null): void;
}
export interface HtmlEditorAdapter {
  mount(container: HTMLElement, bodyHtml: string, options: HtmlEditorMountOptions): Promise<void>;
  getHtml(): string;
  setHtml(html: string): void;
  focus(): void;
  destroy(): void;
}
```

Import HugeRTE core plus `advlist`, `autolink`, `link`, `lists`, `image`, `table`, `charmap`, icons, DOM model, and silver theme. Configure `skin:false`, `content_css:false`, `promotion:false`, `branding:false`, and `convert_urls:false`. Export a `HUGERTE_VALID_ELEMENTS` allowlist from `AuthoringSanitizer` containing only the sanitizer-approved article elements/attributes, including `data-galley-source`, `data-galley-role`, and `data-galley-slot`; pass that allowlist as `valid_elements`. Configure a toolbar for undo/redo, blocks, font, bold/italic/underline, colors, alignment, lists, links, images, and tables. Do not show a code button in the default toolbar.

`tools/embed-hugerte-assets.mjs` reads the upstream oxide skin, replaces proprietary system font names with the approved open-source fallback stack, and writes `HUGERTE_INLINE_SKIN_CSS` to `src/generated/hugerteSkin.ts`. The build script runs it before typecheck and bundle. All HugeRTE code and skin CSS must be inside `main.js`/`styles.css`; no runtime CDN or extra asset folder.

`EditorFactory.createVisual(capabilities)` throws `visual_editor_unavailable` when `canEdit` is false and otherwise loads HugeRTE through `await import("./HugeRteAdapter")`. No mobile startup path may statically import or initialize HugeRTE.

- [ ] **Step 4: Verify adapters and release asset shape**

Run: `npm test -- tests/editor && npm run build && test ! -d hugerte`

Expected: adapter tests PASS, build PASS, and release does not require a `hugerte/` directory.

- [ ] **Step 5: Commit editor adapters**

```bash
git add package.json package-lock.json esbuild.config.mjs styles.css tools/embed-hugerte-assets.mjs src/editor src/generated/hugerteSkin.ts tests/editor
git commit -m "feat: bundle HugeRTE visual editor"
```

### Task 3: Build the one-page workbench shell and state model

**Files:**
- Create: `src/workbench/WorkbenchState.ts`, `src/workbench/GalleyWorkbenchView.ts`
- Create: `src/preview/SafeHtmlPreview.ts`
- Create: `src/workbench/WorkbenchToolbar.ts`, `src/workbench/DocumentOutline.ts`, `src/workbench/PropertyInspector.ts`
- Create: `tests/workbench/WorkbenchState.test.ts`, `tests/workbench/GalleyWorkbenchView.test.ts`, `tests/preview/SafeHtmlPreview.test.ts`
- Modify: `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: `DocumentSession`, `HtmlEditorAdapter`, platform capabilities
- Produces: view type `galley-workbench`
- Produces: `openGalleyDocument(path): Promise<void>` in plugin composition root

- [ ] **Step 1: Write failing workbench state tests**

```ts
import { expect, it } from "vitest";
import { reduceWorkbenchState } from "../../src/workbench/WorkbenchState";

it("moves from generation completion into visual edit mode", () => {
  const state = reduceWorkbenchState(initialWorkbenchState(), { type: "document-opened", path: "a.galley.html" });
  expect(state).toMatchObject({ phase: "edit", mode: "visual", documentPath: "a.galley.html" });
});

it("shows conflict without discarding dirty content", () => {
  const dirty = { ...initialWorkbenchState(), dirty: true };
  const state = reduceWorkbenchState(dirty, { type: "conflict-detected" });
  expect(state.dirty).toBe(true);
  expect(state.conflict).toBe(true);
});
```

- [ ] **Step 2: Run workbench tests to verify failure**

Run: `npm test -- tests/workbench`

Expected: FAIL because workbench modules are missing.

- [ ] **Step 3: Implement the approved layout and view lifecycle**

```ts
export interface WorkbenchState {
  phase: "generate" | "edit" | "export";
  mode: "preview" | "visual" | "source";
  documentPath: string | null;
  selectedSourceId: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  sourceChanged: boolean;
}
```

`GalleyWorkbenchView` extends `ItemView`, creates four regions with CSS classes `galley-toolbar`, `galley-left-rail`, `galley-canvas`, and `galley-inspector`, opens a `DocumentSession`, and mounts HugeRTE only in visual mode. Preview uses `createSafePreviewFrame`: sanitize first, then set `sandbox=""` and a script-free `srcdoc`. Source mode mounts `SourceBodyEditor`. Switching modes first reads current adapter HTML into the session and then destroys the old adapter.

Register `.galley.html` opening through a file-menu command rather than claiming every `.html` extension. Register `Open current Galley document in workbench` and let the generation command open the newly written artifact after Phase 2 succeeds.

- [ ] **Step 4: Verify view lifecycle and layout**

Run: `npm test -- tests/workbench tests/preview/SafeHtmlPreview.test.ts && npm run build`

Expected: tests PASS; view mock contains all four regions; adapter destroy is called exactly once on mode switch and view close.

- [ ] **Step 5: Commit the workbench shell**

```bash
git add src/workbench src/preview/SafeHtmlPreview.ts src/main.ts styles.css tests/workbench tests/preview/SafeHtmlPreview.test.ts src/commands/GenerateCurrentArticle.ts
git commit -m "feat: add Galley workbench shell"
```

### Task 4: Add visual block controls, resource rewriting, and outline navigation

**Files:**
- Create: `src/editor/EditorResourceResolver.ts`, `src/editor/ThemeComponentCatalog.ts`, `src/editor/ComponentTransformer.ts`
- Create: `tests/editor/EditorResourceResolver.test.ts`, `tests/editor/ComponentTransformer.test.ts`
- Modify: `src/workbench/DocumentOutline.ts`, `src/workbench/PropertyInspector.ts`, `src/editor/HugeRteAdapter.ts`

**Interfaces:**
- Consumes: `data-galley-source`, `data-galley-role`, vault resource URLs
- Produces: `ThemeComponentCatalog.fromDocument`
- Produces: `transformSelectedBlock(targetRole, selectedElement, catalog): string`

- [ ] **Step 1: Write failing component and resource tests**

```ts
import { expect, it } from "vitest";
import { ThemeComponentCatalog } from "../../src/editor/ThemeComponentCatalog";
import { transformBlock } from "../../src/editor/ComponentTransformer";

it("reuses a current-theme role template while preserving selected content and source ID", () => {
  const catalog = ThemeComponentCatalog.fromDocument("<blockquote data-galley-role='quote' style='border-left:3px solid #111'><span>sample</span></blockquote>");
  const result = transformBlock("<p data-galley-source='paragraph-003'>Keep <strong>this</strong></p>", "quote", catalog);
  expect(result).toContain("data-galley-source=\"paragraph-003\"");
  expect(result).toContain("Keep <strong>this</strong>");
  expect(result).toContain("border-left:3px solid #111");
});
```

- [ ] **Step 2: Run the editor behavior tests to verify failure**

Run: `npm test -- tests/editor/EditorResourceResolver.test.ts tests/editor/ComponentTransformer.test.ts`

Expected: FAIL because catalog and transformer modules are missing.

- [ ] **Step 3: Implement non-destructive visual controls**

`ThemeComponentCatalog` collects the first sanitized element for each `data-galley-role`. A template retains tag, attributes, and wrapper descendants and replaces the element marked `data-galley-slot="content"`; if no slot exists, the role root is the content slot. `transformBlock` preserves source ID and selected inner HTML. If a target role is absent, the inspector disables it; it never invents a cross-theme style.

The inspector shows controls for paragraph role, alignment, safe text/background color, paragraph spacing, image alt/caption/alignment, link URL/title, and table row/column actions. Every change flows through HugeRTE commands and emits the resulting body HTML.

`EditorResourceResolver` rewrites vault-relative `src`/`href` to Obsidian resource URLs only for editor display. It records original values in `data-galley-original-src`/`href` and restores them before session save. Absolute system paths are never written.

Outline entries come from rendered heading elements with source IDs; clicking an entry scrolls the editor iframe and selects the block without changing content.

- [ ] **Step 4: Verify visual controls preserve document semantics**

Run: `npm test -- tests/editor tests/workbench && npm run test:typecheck`

Expected: tests PASS; transform fixtures preserve source IDs, inline content, and theme styling; saved HTML contains vault-relative paths only.

- [ ] **Step 5: Commit visual editing controls**

```bash
git add src/editor src/workbench tests/editor tests/workbench
git commit -m "feat: add visual article controls"
```

### Task 5: Add autosave, conflict UI, history restore, and phase integration tests

**Files:**
- Create: `src/workbench/AutosaveController.ts`, `src/workbench/ConflictBanner.ts`, `src/workbench/HistoryPanel.ts`
- Create: `tests/workbench/AutosaveController.test.ts`, `tests/integration/WorkbenchEditing.test.ts`
- Modify: `src/workbench/GalleyWorkbenchView.ts`, `src/workbench/WorkbenchToolbar.ts`, `styles.css`

**Interfaces:**
- Consumes: `DocumentSession`, workbench state/actions
- Produces: debounced autosave and explicit conflict decisions

- [ ] **Step 1: Write failing autosave and integration tests**

```ts
import { expect, it, vi } from "vitest";
import { AutosaveController } from "../../src/workbench/AutosaveController";

it("saves once 800ms after the latest change", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(undefined);
  const controller = new AutosaveController(800, save);
  controller.changed();
  await vi.advanceTimersByTimeAsync(500);
  controller.changed();
  await vi.advanceTimersByTimeAsync(799);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run workbench integration tests to verify failure**

Run: `npm test -- tests/workbench/AutosaveController.test.ts tests/integration/WorkbenchEditing.test.ts`

Expected: FAIL because autosave and conflict UI modules are missing.

- [ ] **Step 3: Implement user-visible save and recovery behavior**

Autosave schedules `session.save("auto")` after 800 ms, coalesces changes, and cancels when the view closes, a conflict occurs, or the session becomes clean. Toolbar status cycles through `Unsaved`, `Saving…`, `Saved`, and `Conflict`.

Conflict banner actions map exactly to:

- Reload: discard in-memory changes after confirmation, then `session.reload()`.
- Save copy: `session.saveCopy()` and open the returned path.
- Overwrite: explicit confirmation, then `session.save("overwrite")`.

History panel lists newest first, previews a sanitized snapshot, and restores by calling `session.updateBody(snapshotBody)`; restore remains dirty until a normal save.

- [ ] **Step 4: Run the complete Phase 3 gate**

Run: `npm run test:typecheck && npm test && npm run build && git diff --check`

Expected: all checks PASS; integration fixture opens a generated article, edits text, autosaves after 800 ms, detects an external change, saves a copy, and leaves the original external version unchanged.

- [ ] **Step 5: Commit workbench completion**

```bash
git add src/workbench styles.css tests/workbench tests/integration
git commit -m "feat: complete visual editing workbench"
```
