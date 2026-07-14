# Strict Authoring HTML Lexical Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-recovery emulation with one deterministic, fail-closed HTML lexical subset whose accepted token boundaries cannot hide explicit document-shell markup from DOMParser.

**Architecture:** `HtmlShellScanner` remains the single boundary shared by extraction, codec parsing/serialization, and sanitization, but its lexer accepts only canonical doctype syntax, well-formed comments, strict HTML tags/attributes, HTML-namespace markup, and conservative raw/RCDATA content. A shared adversarial test corpus proves recovery-dependent syntax fails at each public boundary, while an accepted corpus compares scanner acceptance with DOMParser's explicit doctype/html/head/body structure.

**Tech Stack:** TypeScript, Vitest, jsdom DOMParser, existing DOMPurify integration; no new runtime or test dependency.

## Global Constraints

- Use strict TDD: add regression tests and record the expected RED result before changing production code.
- Keep ordinary `<script>alert(1)</script>` scanner-valid so DOMPurify removes and logs it.
- Preserve all existing URL, link-target, codec round-trip, and CSS sanitization behavior.
- Do not change dependencies, `package.json`, `package-lock.json`, Task 2.4 validators/repair, rendering, editing, persistence, models, Skills, licenses, or mobile gates.
- Reject browser-recovery-dependent markup rather than adding more recovery states.

---

### Task 1: Shared accepted and adversarial corpus

**Files:**
- Create: `tests/fixtures/htmlBoundaryCorpus.ts`
- Create: `tests/documents/HtmlShellScanner.test.ts`
- Modify: `tests/generation/HtmlResponseExtractor.test.ts`
- Modify: `tests/documents/GalleyDocumentCodec.test.ts`
- Modify: `tests/security/AuthoringSanitizer.test.ts`

**Interfaces:**
- Consumes: `locateHtmlDocument(source, options)` and `assertShellFreeHtmlFragment(fragment, label)`.
- Produces: shared `acceptedHtmlDocuments`, `recoveryDependentFragments`, and `wrapBodyFragment(fragment)` fixtures used by focused public-boundary tests.

- [ ] **Step 1: Add accepted differential cases**

  Add complete documents covering case-insensitive canonical doctype/tag names, ASCII whitespace, strict comments, ordinary quoted and unquoted attributes, shell-looking text inside quoted values, entity-encoded title text, plain textarea text, and ordinary script text. For each document, assert `locateHtmlDocument` returns the full source range and DOMParser exposes one explicit HTML doctype with direct html/head/body structure.

- [ ] **Step 2: Add recovery-dependent fragments**

  Add exact bogus declaration/PI/malformed declaration payloads, `/=` and whitespace/multiple-slash variants, SVG/MathML/casing/namespace variants, malformed comments, malformed end tags, forbidden unquoted characters, controls/NUL, self-closing raw tags, and raw/RCDATA internal-`<` variants.

- [ ] **Step 3: Exercise every public boundary**

  Assert each recovery fragment fails via direct shell scanning, `extractHtmlDocument(wrapBodyFragment(fragment))`, codec fragment serialization, and `sanitizeAuthoringDocument(wrapBodyFragment(fragment))`. Retain explicit positive tests for valid comments, quoted shell strings, title/textarea, and ordinary script removal logging.

- [ ] **Step 4: Run focused tests and record RED**

  Run:

  ```text
  npm test -- tests/documents/HtmlShellScanner.test.ts tests/generation/HtmlResponseExtractor.test.ts tests/documents/GalleyDocumentCodec.test.ts tests/security
  ```

  Expected: exit 1 with failures for bogus declarations/PIs, `/=` variants, foreign content, namespace syntax, recovery-dependent tag grammar, and ambiguous raw/RCDATA content; existing safe behavior should remain passing.

---

### Task 2: Strict unified lexical subset

**Files:**
- Modify: `src/documents/HtmlShellScanner.ts`
- Test: `tests/documents/HtmlShellScanner.test.ts`
- Test: `tests/fixtures/htmlBoundaryCorpus.ts`

**Interfaces:**
- Preserves: exported `HtmlDocumentRange`, `HtmlShellOptions`, `locateHtmlDocument`, `containsDocumentShellToken`, and `assertShellFreeHtmlFragment` signatures.
- Replaces: permissive declaration and tag recovery with strict private token-reading helpers.

- [ ] **Step 1: Reject controls and ambiguous markup globally**

  Reject NUL, C0 controls other than tab/LF/CR, C1 controls, literal `<` that does not start an accepted token, processing instructions, and all declarations other than ASCII-case-insensitive exact `<!DOCTYPE html>` spelling.

- [ ] **Step 2: Implement strict comments**

  Accept only `<!-- content -->` with an exact `-->` terminator and content that does not begin with `>`/`->`, contain nested `<!--` or `--`, or end in `-`. Reject abrupt/bang/malformed comment forms.

- [ ] **Step 3: Implement strict start/end tags**

  Parse ASCII-letter-start tag names with ASCII alphanumeric/hyphen continuation. Start-tag attributes must be whitespace-delimited ASCII names, unique case-insensitively, optionally followed by whitespace-tolerant `=` and a complete quoted or valid non-empty unquoted value. Reject recovery characters in unquoted values, adjacent attributes without whitespace, stray or repeated slashes, `/=`, malformed end tags, and self-closing markers unless a single `/` immediately precedes `>` from the between-attributes state.

- [ ] **Step 4: Keep quoted values opaque**

  Permit literal `<`, `>`, and shell-looking strings only inside complete single- or double-quoted attribute values, preserving current valid Authoring attributes without tokenizing their contents.

- [ ] **Step 5: Reject foreign tokenizer modes**

  Reject `svg` and `math` start/end tags case-insensitively, colon-bearing tag/attribute syntax, and `xmlns` attributes before DOMParser.

- [ ] **Step 6: Constrain raw/RCDATA**

  Reject `plaintext`, self-closing raw/RCDATA starts, and every internal `<` that is not the exact strict matching end tag. Accept ordinary text-only `script`, `style`, `iframe`, `noembed`, `noframes`, `xmp`, `title`, and `textarea` bodies; keep `noscript` in ordinary markup mode.

- [ ] **Step 7: Run focused tests for GREEN**

  Run the Task 1 focused command. Expected: all focused files pass with zero failures.

---

### Task 3: Review, verification, commit, and report

**Files:**
- Modify: `.superpowers/sdd/reports/task-2.3-implementer.md` (gitignored report)
- Verify only: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: one remediation commit and an appended RED/GREEN/final-gate audit section.

- [ ] **Step 1: Review the strict grammar against the specification**

  Confirm exact declaration, comment, slash, foreign-content, namespace, end-tag, control, quoted/unquoted, and raw/RCDATA requirements have both positive and negative tests. Confirm no public boundary bypasses `HtmlShellScanner`.

- [ ] **Step 2: Run final gates sequentially**

  With no Vitest process running, run `npm test`, `npm run test:typecheck`, `npm run build`, `git diff --check`, `git diff --exit-code -- package.json package-lock.json`, and the existing lock audit for exact DOMPurify 3.4.12 plus 237 canonical registry URLs.

- [ ] **Step 3: Stage and inspect exact scope**

  Stage only the scanner, shared corpus, four focused test files, and this plan. Run `git diff --cached --check`, inspect the cached stat/diff, and confirm package files are absent.

- [ ] **Step 4: Commit**

  Commit with message:

  ```text
  fix: enforce strict authoring HTML subset
  ```

- [ ] **Step 5: Append the implementation report**

  Record root cause, accepted grammar, rejected recovery classes, exact RED/GREEN counts, sequential final-gate outputs, full commit SHA, self-review, and any remaining conservative-compatibility concern.

## Self-Review

- Spec coverage: every reported declaration, slash, foreign-content, namespace, malformed-comment/tag, raw/RCDATA, and positive compatibility requirement maps to Tasks 1 or 2.
- Placeholder scan: the plan contains no deferred implementation or unspecified error-handling step.
- Type consistency: public scanner signatures remain unchanged; corpus fixtures are test-only and shared by all named boundaries.
