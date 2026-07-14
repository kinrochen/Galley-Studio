# Galley Phase 2: Direct-HTML Generation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the active Markdown file into validated, independent `.galley.html` and `.galley.json` artifacts by having a Skill-loaded model directly generate HTML.

**Architecture:** Annotate source blocks before prompting, let the Skill session choose and load one theme, request a complete Authoring document, sanitize and validate it, and use at most two model repair rounds. A vault repository writes the HTML and sidecar atomically without modifying the Markdown source.

**Tech Stack:** Phase 1 stack plus mdast-util-from-markdown 2.0.3, mdast-util-gfm 3.1.0, micromark-extension-gfm 3.0.0, and DOMPurify 3.4.12.

## Global Constraints

- Consume the `SkillSession` and `ChatClient` interfaces created in Phase 1; do not bypass Skill loading.
- The model must generate HTML directly. Source annotations and validators are guardrails, not an AST renderer.
- The Authoring result must be a complete, script-free HTML document with inline article styling and `data-galley-source` markers.
- Preserve every source block exactly once and in source order.
- Run no more than two repair rounds.
- Default context window is 128,000 tokens; enter long-document mode above 85% estimated use.
- Never overwrite an existing verified document without explicit confirmation; the command defaults to a numbered new file.
- Use TDD and commit after every task.

---

## File Map

```text
assets/profiles/galley-authoring.md     model contract layered after the Skill
src/source/SourceAnnotator.ts           stable source-block markers
src/source/LongDocumentPlanner.ts       context estimate and heading batches
src/source/SourceResourceResolver.ts    vault-relative image/embed metadata
src/themes/ThemeIndex.ts                parse Skill theme-index rows
src/themes/BuiltInThemeRepository.ts    built-in theme lookup
src/generation/GenerationTypes.ts       pipeline input/output contracts
src/generation/PromptComposer.ts        theme decision/generation/repair prompts
src/generation/HtmlResponseExtractor.ts isolate HTML from model output
src/documents/GalleyDocumentCodec.ts    full-document parse and serialization
src/security/AuthoringSanitizer.ts      DOMPurify policy
src/security/InlineStyleSanitizer.ts    safe inline-CSS declarations
src/validation/*                        deterministic Authoring validation
src/generation/GenerationPipeline.ts    orchestration and repair loop
src/documents/GalleySidecar.ts          schema v1
src/documents/ArtifactRepository.ts     collision-safe atomic vault writes
src/commands/GenerateCurrentArticle.ts  Obsidian command adapter
```

Test support lives in `tests/support/generationFixtures.ts` and `tests/support/memoryVault.ts`. The first exports `loadFixture`, `makePromptInput`, `makeInput`, `validFixtureHtml`, `invalidHtml`, `makePipelineDeps`, and `makeVerifiedDocument` using only `tests/fixtures/**`. The second exports an in-memory vault adapter plus `memoryVault(initialFiles?)` and `failingRenameVault()`. Both adapters implement the same read/create/modify/rename/remove/stat/exists interface consumed by production repositories.

### Task 1: Annotate Markdown source blocks and plan long-document batches

**Files:**
- Create: `src/source/SourceAnnotator.ts`, `src/source/LongDocumentPlanner.ts`, `src/source/SourceResourceResolver.ts`
- Create: `tests/source/SourceAnnotator.test.ts`, `tests/source/LongDocumentPlanner.test.ts`, `tests/source/SourceResourceResolver.test.ts`
- Create: `tests/support/generationFixtures.ts`, `tests/support/memoryVault.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `annotateMarkdown(markdown): AnnotatedSource`
- Produces: `planDocumentBatches(source, budget): DocumentBatch[]`
- Produces: `resolveSourceResources(markdown, sourcePath, vault): Promise<SourceResource[]>`
- Produces: `SourceBlock { id; kind; markdown; start; end }`

- [ ] **Step 1: Write failing annotation tests**

```ts
import { expect, it } from "vitest";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";

it("assigns stable markers to every top-level Markdown block", () => {
  const result = annotateMarkdown("# Title\n\nIntro.\n\n- one\n- two\n\n![alt](img.png)");
  expect(result.blocks.map(block => [block.id, block.kind])).toEqual([
    ["heading-001", "heading"],
    ["paragraph-001", "paragraph"],
    ["list-001", "list"],
    ["paragraph-002", "paragraph"]
  ]);
  expect(result.promptMarkdown).toContain("<!-- galley-source:heading-001 -->");
  expect(result.promptMarkdown).toContain("<!-- galley-source:list-001 -->");
});

it("does not mutate fenced code contents", () => {
  const source = "```ts\nconst x = '<!-- galley-source:p -->';\n```";
  expect(annotateMarkdown(source).blocks[0]?.markdown).toBe(source);
});
```

- [ ] **Step 2: Run the source tests to verify failure**

Run: `npm install mdast-util-from-markdown@2.0.3 mdast-util-gfm@3.1.0 micromark-extension-gfm@3.0.0 --save && npm test -- tests/source`

Expected: FAIL because source modules are missing.

- [ ] **Step 3: Implement annotation and batching**

```ts
export type SourceBlockKind = "heading" | "paragraph" | "list" | "code" | "table" | "blockquote" | "thematicBreak" | "html";
export interface SourceBlock { id: string; kind: SourceBlockKind; markdown: string; start: number; end: number; }
export interface AnnotatedSource { original: string; promptMarkdown: string; blocks: SourceBlock[]; }
```

Use `fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })` positions to slice original text, so GFM tables remain one `table` block. Treat one top-level mdast node as one source block; classify an image-only paragraph as `paragraph` so captions and surrounding inline text stay together. Assign counters independently by kind and insert a marker immediately before each original slice in `promptMarkdown`.

Use these long-mode functions:

```ts
export const estimateTokens = (text: string): number => Math.ceil(Array.from(text).length / 1.5);
export function shouldUseLongMode(estimated: number, contextWindow: number): boolean {
  return estimated > Math.floor(contextWindow * 0.85);
}
```

`planDocumentBatches` groups blocks at level-two heading boundaries, never splits a code/list/table block, and throws if one indivisible block exceeds the response budget.

`resolveSourceResources` recognizes Markdown images and Obsidian image embeds, resolves them against the source file, and returns only `{ vaultPath, alt, mediaType, width?, height? }`. Raster dimensions come from a platform adapter that reads local bytes without retaining or uploading them. Reject paths outside the vault, strip absolute system paths, and keep image bytes out of `AnnotatedSource`, prompts, logs, and sidecars.

- [ ] **Step 4: Verify source behavior**

Run: `npm test -- tests/source && npm run test:typecheck`

Expected: source tests PASS; a ten-heading fixture produces ordered batches with no missing IDs.

- [ ] **Step 5: Commit source annotation**

```bash
git add package.json package-lock.json src/source tests/source tests/support/generationFixtures.ts tests/support/memoryVault.ts
git commit -m "feat: annotate Markdown generation sources"
```

### Task 2: Parse themes and compose Skill-compatible prompts

**Files:**
- Create: `assets/profiles/galley-authoring.md`
- Create: `src/themes/ThemeIndex.ts`, `src/themes/BuiltInThemeRepository.ts`
- Create: `src/generation/GenerationTypes.ts`, `src/generation/PromptComposer.ts`
- Create: `tests/themes/ThemeIndex.test.ts`, `tests/generation/PromptComposer.test.ts`
- Modify: `esbuild.config.mjs`

**Interfaces:**
- Consumes: `SkillVirtualFileSystem`, `AnnotatedSource`
- Produces: `ThemeDefinition`, `BuiltInThemeRepository.list/get`
- Produces: `composeThemeDecisionPrompt`, `composeGenerationPrompt`, `composeRepairPrompt`

- [ ] **Step 1: Write failing theme and prompt tests**

```ts
import { expect, it } from "vitest";
import { parseThemeIndex } from "../../src/themes/ThemeIndex";

it("parses the six registered theme files", () => {
  const themes = parseThemeIndex(loadFixture("theme-index.md"));
  expect(themes).toHaveLength(6);
  expect(themes[0]).toMatchObject({ id: "moyu-green", file: "references/theme-moyu-green.md" });
});
```

```ts
import { expect, it } from "vitest";
import { composeGenerationPrompt } from "../../src/generation/PromptComposer";

it("requires direct HTML and source markers", () => {
  const prompt = composeGenerationPrompt(makePromptInput());
  expect(prompt).toContain("return one complete HTML document");
  expect(prompt).toContain("data-galley-source");
  expect(prompt).toContain("Do not return a Markdown code fence");
});
```

- [ ] **Step 2: Run tests to verify missing modules**

Run: `npm test -- tests/themes tests/generation/PromptComposer.test.ts`

Expected: FAIL because theme and prompt modules are missing.

- [ ] **Step 3: Implement theme parsing and exact profile layering**

```ts
export interface ThemeDefinition {
  id: string;
  name: string;
  primaryColor: string;
  useCases: string;
  file: string;
  underlineCss: string;
}
```

Parse only the Markdown table beneath the theme-index heading. Derive `id` from `theme-<id>.md`; reject duplicate IDs, missing files, absolute paths, and rows with fewer than five cells.

Configure esbuild with `loader: { ".md": "text" }`. `galley-authoring.md` must state:

```md
# Galley Authoring profile

The gzh-design Skill controls theme selection, component use, article structure, numbering, keyword marking, fidelity, and quality. This profile overrides only WeChat-specific output restrictions.

Return one complete HTML5 document with DOCTYPE, html, head, and body. Keep article styles inline. Scripts, event-handler attributes, executable iframes, forms, object, and embed are forbidden. Every top-level rendered source block must carry the exact `data-galley-source` ID supplied before its Markdown block. Give reusable styled blocks a semantic `data-galley-role`; when a block has a distinct editable content container, mark it `data-galley-slot="content"`. Preserve every source block exactly once and in order. Do not return a Markdown code fence or explanatory prose.
```

Theme decision asks for strict JSON `{ "themeId": string, "articleType": string, "reason": string }`. Repair prompts include only validation issues, current HTML, and the missing source blocks; they explicitly prohibit rewriting already-valid content.

- [ ] **Step 4: Verify all built-in themes and prompt contracts**

Run: `npm test -- tests/themes tests/generation/PromptComposer.test.ts`

Expected: tests PASS and the fixture index yields six unique IDs.

- [ ] **Step 5: Commit theme and prompt foundations**

```bash
git add assets/profiles src/themes src/generation/GenerationTypes.ts src/generation/PromptComposer.ts tests/themes tests/generation/PromptComposer.test.ts esbuild.config.mjs
git commit -m "feat: add generation prompt contracts"
```

### Task 3: Extract, decode, and sanitize Authoring HTML

**Files:**
- Create: `src/generation/HtmlResponseExtractor.ts`
- Create: `src/documents/GalleyDocumentCodec.ts`
- Create: `src/security/AuthoringSanitizer.ts`, `src/security/InlineStyleSanitizer.ts`
- Create: `tests/generation/HtmlResponseExtractor.test.ts`
- Create: `tests/documents/GalleyDocumentCodec.test.ts`
- Create: `tests/security/AuthoringSanitizer.test.ts`, `tests/security/InlineStyleSanitizer.test.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `extractHtmlDocument(modelText): string`
- Produces: `GalleyDocumentCodec.parse/serialize`
- Produces: `sanitizeAuthoringDocument(html): SanitizedDocument`

- [ ] **Step 1: Write failing extraction and security tests**

```ts
import { expect, it } from "vitest";
import { extractHtmlDocument } from "../../src/generation/HtmlResponseExtractor";

it("extracts a fenced full document without keeping prose", () => {
  const text = "Here is the result:\n```html\n<!doctype html><html><body><p>x</p></body></html>\n```";
  expect(extractHtmlDocument(text)).toBe("<!doctype html><html><body><p>x</p></body></html>");
});
```

```ts
import { expect, it } from "vitest";
import { sanitizeAuthoringDocument } from "../../src/security/AuthoringSanitizer";

it("removes executable content before rendering", () => {
  const result = sanitizeAuthoringDocument("<!doctype html><html><body><p onclick='x()'>ok</p><script>alert(1)</script><a href='javascript:x()'>x</a></body></html>");
  expect(result.html).not.toMatch(/script|onclick|javascript:/i);
  expect(result.removed.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm install dompurify@3.4.12 --save && npm test -- tests/generation/HtmlResponseExtractor.test.ts tests/documents tests/security`

Expected: FAIL because implementations are missing.

- [ ] **Step 3: Implement extraction, document codec, and sanitizer**

`extractHtmlDocument` accepts exactly one document, removes one optional `html` fence, finds the first `<!doctype` or `<html`, and rejects multiple documents or missing `<body>`.

```ts
export interface GalleyDocument {
  doctype: "<!DOCTYPE html>";
  lang: string;
  headHtml: string;
  bodyHtml: string;
}

export interface SanitizedDocument {
  html: string;
  removed: Array<{ kind: "element" | "attribute" | "url"; name: string }>;
}
```

Allow article elements including `section`, `article`, headings, paragraphs, spans, strong/em/u/s, lists, blockquote, pre/code, figure/figcaption, img, a, table elements, hr, video/audio/source placeholders. Forbid `script`, `iframe`, `object`, `embed`, `form`, `input`, `button`, `style`, all `on*` attributes, `javascript:` URLs, and non-image data URLs. Preserve `style`, `class`, `data-galley-source`, `data-galley-role`, and `data-galley-slot`.

`sanitizeInlineStyle` parses declarations and keeps a named allowlist of article properties: typography, color/background-color, border, border-radius, box-shadow, spacing, dimensions, display block/inline/inline-block/flex, flex alignment, text alignment/decoration, overflow-wrap, and safe gradients. Remove every `url()`, `expression`, `@import`, `behavior`, `-moz-binding`, CSS variable, animation, transition, transform, filter, position fixed/absolute/sticky, float, and grid declaration. Return removed declaration names for diagnostics. Run this sanitizer on every style attribute before preview or editor mounting.

- [ ] **Step 4: Run extraction/security tests**

Run: `npm test -- tests/generation/HtmlResponseExtractor.test.ts tests/documents tests/security`

Expected: all tests PASS; sanitized output retains inline style and source markers but no executable content.

- [ ] **Step 5: Commit the safe Authoring codec**

```bash
git add package.json package-lock.json src/generation/HtmlResponseExtractor.ts src/documents/GalleyDocumentCodec.ts src/security tests/generation/HtmlResponseExtractor.test.ts tests/documents tests/security
git commit -m "feat: sanitize generated authoring HTML"
```

### Task 4: Add deterministic validation and actionable issues

**Files:**
- Create: `src/validation/ValidationIssue.ts`, `src/validation/DocumentValidator.ts`
- Create: `src/validation/SourceCoverageValidator.ts`, `src/validation/SecurityValidator.ts`, `src/validation/AuthoringContractValidator.ts`
- Create: `tests/validation/SourceCoverageValidator.test.ts`, `tests/validation/DocumentValidator.test.ts`

**Interfaces:**
- Consumes: `AnnotatedSource`, sanitized `GalleyDocument`
- Produces: `validateAuthoringDocument(input): ValidationReport`
- Produces: `ValidationIssue { code; severity; message; sourceId?; selector? }`

- [ ] **Step 1: Write failing validator tests**

```ts
import { expect, it } from "vitest";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";

it("reports missing, duplicate, and reordered markers", () => {
  const report = validateSourceCoverage(
    ["heading-001", "paragraph-001", "list-001"],
    "<h1 data-galley-source='heading-001'>T</h1><p data-galley-source='list-001'>L</p><p data-galley-source='list-001'>L2</p>"
  );
  expect(report.map(issue => issue.code)).toEqual(expect.arrayContaining(["source_missing", "source_duplicate", "source_order"]));
});
```

- [ ] **Step 2: Run validator tests to verify failure**

Run: `npm test -- tests/validation`

Expected: FAIL because validators are missing.

- [ ] **Step 3: Implement validator composition**

```ts
export type ValidationSeverity = "error" | "warning";
export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  sourceId?: string;
  selector?: string;
}
export interface ValidationReport { valid: boolean; issues: ValidationIssue[]; }
```

Validation order is security, document contract, source coverage. Security validation consumes both sanitized HTML and the sanitizer's removal log: removing a script, event attribute, unsafe URL, or executable CSS creates an `unsafe_content_removed` error so the repair loop corrects the model output instead of silently accepting it. Contract errors include missing doctype/html/head/body/title/charset/viewport, missing article root, or non-inline external stylesheet. Coverage compares exact marker sequence and emits one issue per missing/duplicate ID plus one `source_order` issue if the unique sequence differs.

- [ ] **Step 4: Verify deterministic reports**

Run: `npm test -- tests/validation && npm run test:typecheck`

Expected: tests PASS; repeated validation produces byte-identical issue JSON.

- [ ] **Step 5: Commit Authoring validation**

```bash
git add src/validation tests/validation
git commit -m "feat: validate generated authoring documents"
```

### Task 5: Orchestrate theme choice, direct generation, long mode, and repair

**Files:**
- Create: `src/generation/GenerationPipeline.ts`, `src/generation/ThemeDecision.ts`, `src/generation/RepairLoop.ts`
- Create: `tests/generation/GenerationPipeline.test.ts`, `tests/generation/RepairLoop.test.ts`

**Interfaces:**
- Consumes: `SkillSession`, `AnnotatedSource`, `BuiltInThemeRepository`, sanitizer, validators
- Produces: `GenerationPipeline.generate(input, signal): Promise<GeneratedDocument>`

- [ ] **Step 1: Write the failing happy-path and repair tests**

```ts
import { expect, it } from "vitest";
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";

it("loads the selected theme before accepting direct HTML", async () => {
  const deps = makePipelineDeps({ themeId: "graphite-minimal", html: validFixtureHtml() });
  const result = await new GenerationPipeline(deps).generate(makeInput(), new AbortController().signal);
  expect(deps.session.audit().files).toEqual(expect.arrayContaining([
    "SKILL.md", "references/theme-index.md", "references/theme-graphite-minimal.md", "references/common-components.md"
  ]));
  expect(result.validation.valid).toBe(true);
});

it("stops after two failed repair rounds", async () => {
  const deps = makePipelineDeps({ themeId: "graphite-minimal", htmlSequence: [invalidHtml(), invalidHtml(), invalidHtml()] });
  const result = await new GenerationPipeline(deps).generate(makeInput(), new AbortController().signal);
  expect(result.status).toBe("unverified");
  expect(deps.session.completionCount).toBe(4); // theme + generation + two repairs
});
```

- [ ] **Step 2: Run generation tests to verify failure**

Run: `npm test -- tests/generation/GenerationPipeline.test.ts tests/generation/RepairLoop.test.ts`

Expected: FAIL because orchestration modules are missing.

- [ ] **Step 3: Implement the generation state machine**

```ts
export interface GenerateArticleInput {
  sourcePath: string;
  markdown: string;
  manualThemeId?: string;
  modelContextWindow: number;
}
export interface GeneratedDocument {
  status: "verified" | "unverified";
  html: string;
  theme: ThemeDefinition;
  source: AnnotatedSource;
  validation: ValidationReport;
  skillAudit: SkillLoadAudit;
  diagnostics: ValidationIssue[];
}
```

Exact order:

1. Annotate source and bootstrap Skill.
2. If no manual theme, call `decideTheme` and reject unknown IDs.
3. `ensureFiles([theme.file, "references/common-components.md"])`.
4. Generate complete HTML or section batches when long mode is active.
5. Extract, sanitize, and validate.
6. For errors, call `composeRepairPrompt` and repeat extraction/sanitize/validate twice.
7. Return verified output or the final unverified draft with all issues.

Do not silently replace an unknown model-selected theme with a default; ask the same session to correct its JSON once, then fail with `theme_invalid`.

- [ ] **Step 4: Run orchestration tests**

Run: `npm test -- tests/generation && npm run test:typecheck`

Expected: tests PASS; long-mode fixture preserves every source ID once and repair count never exceeds two.

- [ ] **Step 5: Commit the generation loop**

```bash
git add src/generation tests/generation
git commit -m "feat: add direct HTML generation loop"
```

### Task 6: Write artifacts atomically and register the one-click command

**Files:**
- Create: `src/documents/GalleySidecar.ts`, `src/documents/ArtifactRepository.ts`
- Create: `src/commands/GenerateCurrentArticle.ts`
- Create: `tests/documents/ArtifactRepository.test.ts`, `tests/commands/GenerateCurrentArticle.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GenerationPipeline`, Obsidian `Vault`, active `TFile`, settings
- Produces: `GalleySidecarV1`, `ArtifactRepository.writeNew`
- Produces: `generateCurrentArticle(context, signal): Promise<ArtifactPaths>`

- [ ] **Step 1: Write failing sidecar and collision tests**

```ts
import { expect, it } from "vitest";
import { ArtifactRepository } from "../../src/documents/ArtifactRepository";

it("uses a numbered name and never overwrites an existing article", async () => {
  const vault = memoryVault({ "notes/a.galley.html": "old" });
  const paths = await new ArtifactRepository(vault).writeNew("notes/a.md", makeVerifiedDocument());
  expect(paths.html).toBe("notes/a-2.galley.html");
  expect(await vault.read("notes/a.galley.html")).toBe("old");
});

it("removes temporary files when the sidecar rename fails", async () => {
  const vault = failingRenameVault();
  await expect(new ArtifactRepository(vault).writeNew("a.md", makeVerifiedDocument())).rejects.toThrow();
  expect(vault.paths()).not.toContainEqual(expect.stringMatching(/\.galley-tmp/));
});
```

- [ ] **Step 2: Run artifact tests to verify failure**

Run: `npm test -- tests/documents/ArtifactRepository.test.ts tests/commands`

Expected: FAIL because repository and command modules are missing.

- [ ] **Step 3: Implement schema, atomic writes, and command adapter**

Define `GalleySidecarV1` with the fields approved in the design: schema/document IDs, source and HTML SHA-256, theme, Skill version/mode/files, model, prompt version, timestamp, validation, and exports. Validate it with Zod. Hash text with `crypto.subtle.digest("SHA-256", ...)`.

`ArtifactRepository.writeNew` must:

1. Resolve the source directory or configured output folder.
2. Choose `name.galley.*`, then `name-2.galley.*`, incrementing until both paths are free.
3. Write HTML and JSON to UUID temporary paths.
4. Rename HTML, then sidecar.
5. If the second rename fails, remove the newly renamed HTML and both temporary files.

Register `Galley: AI layout current article` only on desktop. It reads the active Markdown via `vault.read`, creates an `AbortController`, shows stage Notices, calls the pipeline, writes verified or clearly labeled unverified artifacts, and reports both paths. It never modifies the source file.

- [ ] **Step 4: Run the complete Phase 2 gate**

Run: `npm run test:typecheck && npm test && npm run build && git diff --check`

Expected: all checks PASS; command integration fixture writes matching HTML/sidecar hashes and leaves source Markdown byte-identical.

- [ ] **Step 5: Commit the one-click generation path**

```bash
git add src/documents src/commands src/main.ts tests/documents tests/commands
git commit -m "feat: generate independent Galley artifacts"
```
