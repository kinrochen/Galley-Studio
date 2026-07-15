# Galley

Galley is an AGPL-3.0 Obsidian publishing studio that asks an
OpenAI-compatible model to load the pinned `gzh-design-skill` and generate
editable HTML directly from Markdown.

## First-release workflow

On Desktop, run **Galley: AI layout current article**, edit the independent
`.galley.html` document visually, and export Standard Web, Portable Inline, or
WeChat-compatible HTML. **Galley: Open AI Theme Lab** creates a full-page draft
from a text description and an optional, explicitly selected PNG/JPEG/WebP
reference. A valid draft enters the merged Skill theme index only after the
user presses **Save theme**.

Desktop also supports custom-theme ZIP import/export and safe Skill ZIP import.
Imported Skills remain inactive until the user runs the explicit activation
command. Mobile exposes only the sandboxed, script-free Galley preview; it does
not register generation, editing, Theme Lab, export repair, or Skill import.

## Installation and configuration

Build with `npm ci && npm run build`, then place `main.js`, `manifest.json`, and
`styles.css` in `.obsidian/plugins/galley/`. Configure an OpenAI-compatible base
URL, model, and an Obsidian SecretStorage entry in Galley settings. The plugin
stores only the Secret ID, never the API key.

## Source and license

Galley is licensed under AGPL-3.0. Corresponding source and release instructions
for this plugin are at <https://github.com/isjiamu/Galley>. The pinned upstream
Skill source is at <https://github.com/isjiamu/gzh-design-skill>. See
`THIRD_PARTY_NOTICES.md` for bundled dependency source and license texts.
