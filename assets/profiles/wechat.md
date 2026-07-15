# WeChat editor export and repair profile

This file supplements the pinned `gzh-design` Skill only for deterministic
WeChat export repair. It is reference text and must never be executed.

- Return exactly one top-level `<section>...</section>` fragment.
- Do not return a document shell, Markdown fence, or explanation.
- Use inline `style` only. Never emit `<style>`, `<script>`, `<div>`, `<link>`,
  `class`, `id`, external font dependencies, CSS variables, grid, float,
  `@media`, `@keyframes`, `@import`, or fixed/absolute/sticky position.
- Wrap every non-empty text node in `<span leaf="">...</span>`.
- Preserve article meaning and content; repair only the supplied export copy.
- A repair may run for at most two model rounds and must pass the TypeScript
  `WechatValidator` after final provenance stamping.
