# Galley Multi-Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the linked plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Galley Obsidian plugin as five independently testable increments.

**Architecture:** The repository is built around an OpenAI-compatible gateway, a read-only Skill Runtime, a direct-HTML generation pipeline, a HugeRTE workbench, profile-based exporters, and a vault-backed theme repository. Each phase fixes public interfaces that the following phase consumes.

**Tech Stack:** TypeScript, Obsidian Plugin API 1.11.4, esbuild, Vitest, jsdom, HugeRTE, DOMPurify, mdast-util-from-markdown, fflate, Zod.

## Global Constraints

- License the complete repository under AGPL-3.0 and preserve the `gzh-design-skill` attribution.
- Keep `minAppVersion` at `1.11.4` and `isDesktopOnly` at `false`.
- Desktop supports generation and visual editing; mobile supports sanitized preview only.
- Models generate HTML directly after loading the Skill; do not replace this with an AST renderer.
- Prefer `read_skill_file` tool calls and fall back to injecting every file required for the current task.
- Never store API keys in plugin settings, vault files, logs, diagnostics, fixtures, or snapshots.
- The Authoring HTML is independent from its Markdown source after generation.
- Do not execute Python or shell scripts imported from Skill packages.
- Generated HTML is untrusted until parsed, sanitized, and validated.
- Commit after every task and run the task's named verification command before committing.

---

## Execution Order

1. [Foundation and Skill Runtime](2026-07-14-galley-phase-1-foundation-skill-runtime.md)
2. [Direct-HTML Generation Loop](2026-07-14-galley-phase-2-generation-loop.md)
3. [Workbench and HugeRTE Editing](2026-07-14-galley-phase-3-workbench-editor.md)
4. [Export Profiles and Mobile Preview](2026-07-14-galley-phase-4-export-mobile.md)
5. [Theme Lab, Skill Import, and Release](2026-07-14-galley-phase-5-theme-lab-release.md)

Each phase starts only after the preceding plan's final verification passes. Do not parallelize phases because later plans consume concrete interfaces introduced earlier.

## Phase Gates

| Phase | Independently testable outcome |
| --- | --- |
| 1 | Plugin loads; settings use SecretStorage; a simulated model loads the bundled Skill through tools or injection fallback. |
| 2 | One command converts the active Markdown into validated `.galley.html` and `.galley.json` files. |
| 3 | Desktop users can open, visually edit, autosave, recover, and resolve conflicts in a Galley document. |
| 4 | The same main document exports to standard web, portable inline, and WeChat HTML; mobile opens sanitized read-only preview. |
| 5 | Users can generate and persist custom themes, import a validated Skill package, and build a release-ready plugin archive. |

## Specification Coverage

| Approved design requirement | Owning plan/task |
| --- | --- |
| Obsidian shell, desktop/mobile gate, SecretStorage | Phase 1 Tasks 1–2 |
| OpenAI-compatible tools, stream fallback, retries, cancellation, redaction | Phase 1 Tasks 3 and 6 |
| Bundled Skill, virtual files, tool-first loading, injection fallback, audit | Phase 1 Tasks 4–6 |
| Source IDs, vault-relative resources, long-document batches | Phase 2 Task 1 |
| Six built-in themes and direct Authoring HTML prompts | Phase 2 Task 2 |
| Sanitization, CSS policy, deterministic validation, two repair rounds | Phase 2 Tasks 3–5 |
| Independent HTML/sidecar artifacts and one-click command | Phase 2 Task 6 |
| HugeRTE, approved workbench layout, visual component editing | Phase 3 Tasks 2–4 |
| Autosave, twenty-version history, source-change notice, conflict recovery | Phase 3 Tasks 1 and 5 |
| Standard web, portable inline, WeChat conversion/repair, rich-text copy | Phase 4 Tasks 1–4 |
| Scriptless mobile preview without claiming unrelated HTML | Phase 4 Task 5 |
| Custom theme generation, reference images, preview, validation, persistence | Phase 5 Tasks 1–3 |
| Theme import/export/disable and merged virtual index | Phase 5 Tasks 1 and 3 |
| Safe Skill ZIP import and explicit activation | Phase 5 Task 4 |
| Six-theme acceptance, long article, secret leakage, licenses, release | Phase 5 Tasks 5–6 |
