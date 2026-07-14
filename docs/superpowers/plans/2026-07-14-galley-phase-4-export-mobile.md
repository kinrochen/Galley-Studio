# Galley Phase 4: Export Profiles and Mobile Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export one Authoring document as standard web, portable inline, or WeChat-compatible HTML, copy rich text safely, and provide sanitized read-only preview on mobile.

**Architecture:** Every exporter implements one profile contract and returns immutable output plus a validation report. Web and inline profiles are deterministic. WeChat first performs deterministic normalization and only uses a Skill-loaded repair session on the export copy if validation still fails. Preview uses sanitized `srcdoc` in a scriptless sandbox.

**Tech Stack:** Existing stack, browser Clipboard API behind a testable port, DOMPurify, and Phase 1 Skill sessions.

## Global Constraints

- Never mutate `.galley.html` while exporting.
- Standard web and portable inline exports never call the model.
- WeChat repair loads the Skill and `wechat.md`, runs at most two rounds, and changes only the export candidate.
- No export may contain scripts, executable event attributes, or unsafe URLs.
- Portable inline has no external CSS/font/script dependency.
- WeChat output is a pure `<section>` fragment with inline styles and `<span leaf="">` text wrappers.
- Mobile supports only sanitized preview and file-menu/command entry points.
- Record successful exports in the sidecar without secrets or request bodies.
- Use TDD and commit after each task.

---

## File Map

```text
assets/profiles/standard-web.md       profile documentation/model repair context
assets/profiles/portable-inline.md    profile contract
assets/profiles/wechat.md             original platform constraints
src/export/ExportProfile.ts           shared profile interface
src/export/ExportService.ts           transform/validate/write/sidecar orchestration
src/export/StandardWebProfile.ts      complete safe web document
src/export/PortableInlineProfile.ts   inline fragment
src/export/WechatProfile.ts           deterministic WeChat normalization
src/export/WechatValidator.ts         TypeScript port of Skill validator rules
src/export/WechatRepair.ts            conditional Skill-loaded repair
src/export/RichTextClipboard.ts       Clipboard API adapter
src/workbench/ExportPanel.ts          profile selection and results
src/preview/SafeHtmlPreview.ts        sandboxed srcdoc renderer from Phase 3
src/preview/GalleyPreviewView.ts      mobile/desktop read-only ItemView
src/commands/OpenGalleyPreview.ts     file-menu and command entry
```

Test support lives in `tests/support/exportFixtures.ts`. It exports `makeDocument`, `makeContext`, `makeExportDeps`, `makeWechatRepairDeps`, and `invalidWechatCandidate`; all fixtures contain the same known Authoring HTML and in-memory sidecar so immutability assertions compare exact bytes.

### Task 1: Define export contracts and immutable output orchestration

**Files:**
- Create: `src/export/ExportProfile.ts`, `src/export/ExportService.ts`
- Create: `tests/export/ExportService.test.ts`
- Create: `tests/support/exportFixtures.ts`
- Modify: `src/documents/GalleySidecar.ts`, `src/documents/GalleyDocumentRepository.ts`

**Interfaces:**
- Produces: `ExportProfile.transform/validate`
- Produces: `ExportService.export(input, signal): Promise<ExportArtifact>`
- Consumes: `GalleyDocument`, document repository, sidecar

- [ ] **Step 1: Write the failing immutability test**

```ts
import { expect, it } from "vitest";
import { ExportService } from "../../src/export/ExportService";

it("writes a derived artifact and leaves the Authoring document unchanged", async () => {
  const deps = makeExportDeps();
  const before = await deps.repository.readHtml("a.galley.html");
  const result = await new ExportService(deps).export({ documentPath: "a.galley.html", profileId: "test" }, new AbortController().signal);
  expect(await deps.repository.readHtml("a.galley.html")).toBe(before);
  expect(await deps.repository.readHtml(result.path)).toBe("derived");
  expect(deps.sidecar().exports).toHaveLength(1);
});
```

- [ ] **Step 2: Run the export service test to verify failure**

Run: `npm test -- tests/export/ExportService.test.ts`

Expected: FAIL because export contracts are missing.

- [ ] **Step 3: Implement the shared interfaces and sidecar record**

```ts
export type ExportProfileId = "standard-web" | "portable-inline" | "wechat";
export interface ExportContext { title: string; lang: string; sourcePath: string; }
export interface ExportCandidate { html: string; suggestedSuffix: ".web.html" | ".inline.html" | ".wechat.html"; }
export interface ExportProfile {
  readonly id: ExportProfileId;
  transform(document: GalleyDocument, context: ExportContext): Promise<ExportCandidate>;
  validate(candidate: ExportCandidate): ValidationReport;
}
export interface ExportArtifact {
  profileId: ExportProfileId;
  path: string;
  htmlHash: string;
  exportedAt: string;
  validation: ValidationReport;
}
```

`ExportService` reads and hashes the Authoring document, calls the selected profile, rejects invalid output unless that profile has an explicit repair adapter, writes to a collision-safe suffix path, then atomically appends `{ profileId, path, htmlHash, exportedAt }` to sidecar `exports`. Re-read the source hash before updating the sidecar; if it changed, keep the exported file but report `sidecar_conflict` without overwriting metadata.

- [ ] **Step 4: Verify service and schema migration**

Run: `npm test -- tests/export/ExportService.test.ts tests/documents && npm run test:typecheck`

Expected: tests PASS; schema v1 sidecars without `exports` normalize to an empty array.

- [ ] **Step 5: Commit the export foundation**

```bash
git add src/export/ExportProfile.ts src/export/ExportService.ts src/documents tests/export tests/documents tests/support/exportFixtures.ts
git commit -m "feat: add immutable export service"
```

### Task 2: Implement standard-web and portable-inline profiles

**Files:**
- Create: `assets/profiles/standard-web.md`, `assets/profiles/portable-inline.md`
- Create: `src/export/StandardWebProfile.ts`, `src/export/PortableInlineProfile.ts`
- Create: `tests/export/StandardWebProfile.test.ts`, `tests/export/PortableInlineProfile.test.ts`

**Interfaces:**
- Implements: `ExportProfile`
- Produces: `.web.html` full document and `.inline.html` fragment

- [ ] **Step 1: Write failing profile tests**

```ts
import { expect, it } from "vitest";
import { StandardWebProfile } from "../../src/export/StandardWebProfile";
import { PortableInlineProfile } from "../../src/export/PortableInlineProfile";

it("produces a responsive complete web document", async () => {
  const result = await new StandardWebProfile().transform(makeDocument(), makeContext());
  expect(result.html).toMatch(/^<!DOCTYPE html>/);
  expect(result.html).toContain('<meta name="viewport"');
  expect(result.html).not.toMatch(/data-galley-(source|role)/);
});

it("produces one dependency-free inline article fragment", async () => {
  const result = await new PortableInlineProfile().transform(makeDocument(), makeContext());
  expect(result.html.trim()).toMatch(/^<section\b/);
  expect(result.html).not.toMatch(/<!DOCTYPE|<html|<head|<style|class=|data-galley-/i);
  expect(result.html).toContain("style=");
});
```

- [ ] **Step 2: Run profile tests to verify failure**

Run: `npm test -- tests/export/StandardWebProfile.test.ts tests/export/PortableInlineProfile.test.ts`

Expected: FAIL because profile implementations are missing.

- [ ] **Step 3: Implement deterministic transformations**

Standard web:

- preserve safe semantic body content and inline styles;
- remove editor-only `data-galley-*` and `data-mce-*` attributes;
- set title/lang/charset/viewport;
- wrap body content in `<main style="max-width:...;margin:0 auto">` if no existing reading container;
- keep safe links, tables, images, video/audio/source; remove scripts and forms;
- convert vault-relative resources to paths relative to the export location.

Portable inline:

- extract article/body children into one `<section>` root;
- remove document shell, class/id/editor data attributes;
- retain only inline styles and safe article attributes;
- reject `@import`, external stylesheets, external fonts, scripts, forms, object/embed, and executable iframe;
- convert unsupported video/audio to a labeled safe link or a textual placeholder without dropping its caption.

- [ ] **Step 4: Run profile fixtures and security validation**

Run: `npm test -- tests/export/StandardWebProfile.test.ts tests/export/PortableInlineProfile.test.ts tests/security`

Expected: tests PASS for links, tables, images, media placeholders, and unsafe-input fixtures.

- [ ] **Step 5: Commit web and inline exporters**

```bash
git add assets/profiles/standard-web.md assets/profiles/portable-inline.md src/export/StandardWebProfile.ts src/export/PortableInlineProfile.ts tests/export/StandardWebProfile.test.ts tests/export/PortableInlineProfile.test.ts
git commit -m "feat: add web and inline export profiles"
```

### Task 3: Port WeChat transformation and validation rules to TypeScript

**Files:**
- Create: `assets/profiles/wechat.md`
- Create: `src/export/WechatProfile.ts`, `src/export/WechatValidator.ts`
- Create: `tests/export/WechatProfile.test.ts`, `tests/export/WechatValidator.test.ts`
- Create: `tests/fixtures/wechat/valid.html`, `tests/fixtures/wechat/invalid.html`

**Interfaces:**
- Implements: `ExportProfile`
- Produces: `validateWechatHtml(html): ValidationReport`
- Consumes: original Skill rules; does not execute `validate_gzh_html.py`

- [ ] **Step 1: Write failing WeChat rules tests**

```ts
import { expect, it } from "vitest";
import { validateWechatHtml } from "../../src/export/WechatValidator";

it("rejects platform-forbidden markup and unwrapped text", () => {
  const report = validateWechatHtml("<section><div class='x'><p>Hello</p><script>x()</script></div></section>");
  expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
    "wechat_forbidden_tag", "wechat_forbidden_attribute", "wechat_unwrapped_text"
  ]));
});

it("accepts a pure section fragment with leaf spans", () => {
  const report = validateWechatHtml("<section style='font-size:16px'><p><span leaf=''>你好。</span></p></section>");
  expect(report.valid).toBe(true);
});
```

- [ ] **Step 2: Run WeChat tests to verify failure**

Run: `npm test -- tests/export/WechatProfile.test.ts tests/export/WechatValidator.test.ts`

Expected: FAIL because WeChat modules are missing.

- [ ] **Step 3: Implement the exact platform normalizer and validator**

`WechatProfile.transform` must:

1. Extract body/article content into one `<section>` root.
2. Convert `div`, `article`, `main`, `header`, `footer`, `figure`, and `figcaption` to allowed `section`, `p`, or `span` equivalents without dropping content.
3. Remove `class`, `id`, `data-galley-*`, external stylesheets/fonts, scripts, event attributes, forms, media execution, and unsafe URLs.
4. Remove forbidden CSS: position fixed/absolute/sticky, float, grid, CSS variables, animation/keyframes, media queries, and external font references.
5. Preserve safe inline styles, links, images, tables only when the original Skill validator permits them.
6. Wrap every non-whitespace text node, including code text, in `<span leaf="">` without changing its characters.
7. Keep code punctuation unchanged and normalize only Chinese prose punctuation using the same exceptions as the Skill.

`WechatValidator` ports every deterministic check from the pinned `scripts/validate_gzh_html.py`. Create a fixture-driven mapping where each Python error category has a TypeScript issue-code assertion. The Python script is a reference artifact only and is never spawned.

- [ ] **Step 4: Verify parity fixtures**

Run: `npm test -- tests/export/WechatProfile.test.ts tests/export/WechatValidator.test.ts`

Expected: all tests PASS; valid fixture has zero errors and invalid fixture reports every expected issue code.

- [ ] **Step 5: Commit WeChat transformation and validation**

```bash
git add assets/profiles/wechat.md src/export/WechatProfile.ts src/export/WechatValidator.ts tests/export tests/fixtures/wechat
git commit -m "feat: add WeChat export validation"
```

### Task 4: Add conditional WeChat repair, rich-text copy, and export UI

**Files:**
- Create: `src/export/WechatRepair.ts`, `src/export/RichTextClipboard.ts`
- Create: `src/workbench/ExportPanel.ts`
- Create: `tests/export/WechatRepair.test.ts`, `tests/export/RichTextClipboard.test.ts`, `tests/workbench/ExportPanel.test.ts`
- Modify: `src/export/ExportService.ts`, `src/workbench/GalleyWorkbenchView.ts`

**Interfaces:**
- Consumes: `SkillSession`, WeChat profile/validator, `ExportService`
- Produces: `repairWechatCandidate(candidate, issues, signal)`
- Produces: `RichTextClipboard.write(html, plainText)`

- [ ] **Step 1: Write failing repair and clipboard tests**

```ts
import { expect, it } from "vitest";
import { repairWechatCandidate } from "../../src/export/WechatRepair";

it("loads the WeChat profile and never changes the main document", async () => {
  const deps = makeWechatRepairDeps();
  const result = await repairWechatCandidate(deps, invalidWechatCandidate(), new AbortController().signal);
  expect(deps.session.audit().files).toEqual(expect.arrayContaining(["SKILL.md", "references/common-components.md"]));
  expect(deps.profileContextLoaded).toBe(true);
  expect(deps.mainDocumentHtml).toBe(deps.originalMainDocumentHtml);
  expect(result.validation.valid).toBe(true);
});
```

- [ ] **Step 2: Run repair/UI tests to verify failure**

Run: `npm test -- tests/export/WechatRepair.test.ts tests/export/RichTextClipboard.test.ts tests/workbench/ExportPanel.test.ts`

Expected: FAIL because repair, clipboard, and export panel modules are missing.

- [ ] **Step 3: Implement repair and user actions**

Repair starts only after deterministic WeChat validation fails. Create a fresh Skill session, bootstrap it, ensure the article's theme file plus `references/common-components.md`, inject `wechat.md` as the active profile, and ask the model to fix only listed errors while preserving text and order. Extract, sanitize, and validate each response; stop after two attempts.

```ts
export interface ClipboardPort {
  write(items: Array<{ mime: "text/html" | "text/plain"; data: string }>): Promise<void>;
}
```

Browser implementation uses `ClipboardItem` with both MIME types. If unavailable, use a hidden contenteditable selection and `document.execCommand("copy")`; remove it in `finally`. The export panel lists all three profiles, validation status, `Save file`, and `Copy rich text`. A failed profile shows issues and does not display success.

- [ ] **Step 4: Verify export UI and repair limits**

Run: `npm test -- tests/export tests/workbench/ExportPanel.test.ts && npm run test:typecheck`

Expected: tests PASS; repair never exceeds two calls; clipboard always includes HTML and plain text; failed copy leaves no temporary DOM node.

- [ ] **Step 5: Commit export delivery UI**

```bash
git add src/export src/workbench/ExportPanel.ts src/workbench/GalleyWorkbenchView.ts tests/export tests/workbench/ExportPanel.test.ts
git commit -m "feat: deliver and copy export profiles"
```

### Task 5: Add mobile-safe preview and close the phase gate

**Files:**
- Modify: `src/preview/SafeHtmlPreview.ts`
- Create: `src/preview/GalleyPreviewView.ts`
- Create: `src/commands/OpenGalleyPreview.ts`
- Modify: `tests/preview/SafeHtmlPreview.test.ts`
- Create: `tests/integration/MobileCapabilities.test.ts`
- Modify: `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: Authoring sanitizer, platform capabilities, vault file
- Produces: view type `galley-preview`
- Produces: explicit preview command and file-menu action for `*.galley.html`

- [ ] **Step 1: Write failing sandbox and mobile-gate tests**

```ts
import { expect, it } from "vitest";
import { createSafePreviewFrame } from "../../src/preview/SafeHtmlPreview";

it("renders sanitized srcdoc in a scriptless sandbox", () => {
  const frame = createSafePreviewFrame("<p>ok</p><script>alert(1)</script>");
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.srcdoc).toContain("<p>ok</p>");
  expect(frame.srcdoc).not.toContain("script");
});
```

- [ ] **Step 2: Run preview tests to verify failure**

Run: `npm test -- tests/preview tests/integration/MobileCapabilities.test.ts`

Expected: FAIL because preview modules are missing.

- [ ] **Step 3: Implement explicit Galley preview without claiming all HTML files**

`createSafePreviewFrame` sanitizes first, creates an iframe with `sandbox=""`, `referrerpolicy="no-referrer"`, and a complete `srcdoc` containing a restrictive CSP: `default-src 'none'; img-src data: app: https: http:; style-src 'unsafe-inline'`. It never enables scripts, forms, popups, or same-origin.

Register `Open Galley preview` for the active file and a file-menu entry only when the path ends with `.galley.html`. Do not call `registerExtensions(["html"], ...)`, because Galley must not claim unrelated HTML files. On mobile, register preview but omit generation, editing, import, and export-repair commands. On desktop, preview remains available beside the workbench.

- [ ] **Step 4: Run the complete Phase 4 gate**

Run: `npm run test:typecheck && npm test && npm run build && git diff --check`

Expected: all checks PASS; mobile integration fixture registers preview only; three export fixtures pass their validators; main Authoring fixture remains byte-identical after all exports.

- [ ] **Step 5: Commit export and mobile completion**

```bash
git add src/preview src/commands/OpenGalleyPreview.ts src/main.ts styles.css tests/preview tests/integration
git commit -m "feat: add mobile-safe Galley preview"
```
