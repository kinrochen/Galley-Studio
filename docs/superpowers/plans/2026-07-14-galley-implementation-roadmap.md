# Galley Multi-Phase Implementation Plan

> **For agentic workers:** Phase 1–2 的历史任务保持不变。Phase 3–5 使用 consolidated phase delivery：每阶段一个端到端交付和一个阶段级审查门禁。

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
- Phase 3–5 不再按模块拆独立任务；阶段内部允许 checkpoint commits，但只按整个 phase 执行交付、审查和完成标记。

---

## Execution Order

1. [Foundation and Skill Runtime](2026-07-14-galley-phase-1-foundation-skill-runtime.md)
2. [Direct-HTML Generation Loop](2026-07-14-galley-phase-2-generation-loop.md)
3. [Phase 3 integrated desktop workbench](2026-07-14-galley-phases-3-5-consolidated.md#phase-3-delivery--complete-desktop-workbench)
4. [Phase 4 integrated export and mobile preview](2026-07-14-galley-phases-3-5-consolidated.md#phase-4-delivery--export-profiles-and-mobile-preview)
5. [Phase 5 integrated Theme Lab and release](2026-07-14-galley-phases-3-5-consolidated.md#phase-5-delivery--theme-lab-skill-packages-acceptance-and-010-release)

Each phase starts only after the preceding phase-level review and final verification pass. Do not parallelize phases because later plans consume concrete interfaces introduced earlier. Within one phase, bounded workstreams with non-overlapping file ownership may run in parallel under one integrator.

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
| HugeRTE, approved workbench layout, visual component editing | Phase 3 integrated delivery |
| Autosave, twenty-version history, source-change notice, conflict recovery | Phase 3 integrated delivery |
| Standard web, portable inline, WeChat conversion/repair, rich-text copy | Phase 4 integrated delivery |
| Scriptless mobile preview without claiming unrelated HTML | Phase 4 integrated delivery |
| Custom theme generation, reference images, preview, validation, persistence | Phase 5 integrated delivery |
| Theme import/export/disable and merged virtual index | Phase 5 integrated delivery |
| Safe Skill ZIP import and explicit activation | Phase 5 integrated delivery |
| Six-theme acceptance, long article, secret leakage, licenses, release | Phase 5 integrated delivery |
