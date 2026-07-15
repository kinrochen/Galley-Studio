# Galley

Galley is an AGPL-3.0 Obsidian publishing studio that asks an
OpenAI-compatible model to load the pinned `gzh-design-skill` and generate
editable HTML directly from Markdown.

## First-release workflow

Use the ribbon newspaper icon or **Galley: Open console / 打开控制台**. The
Desktop console is the primary workflow and keeps six stable routes:

- **Console** shows the current Markdown or Galley document, recent articles,
  catalog health, and the Generate action.
- **Articles** scans paired `.galley.html` and `.galley.json` artifacts. It
  opens the production workbench or safe preview without modifying the source
  Markdown.
- **Themes** manages built-in and custom themes, ZIP import/export,
  enable/disable, delete, and Theme Lab.
- **Skill** imports bounded ZIP packages as inactive references and requires a
  separate confirmed activation.
- **Export configurations** manages reusable Standard Web, Portable Inline,
  and WeChat export settings. The workbench performs the actual exports.
- **Settings** exposes provider, model, SecretStorage selection, generation
  limits, output folder, and an explicit connection/Skill diagnostic.

Theme Lab creates a full-page draft from a text description and an optional,
explicitly selected PNG/JPEG/WebP reference. A valid draft enters the merged
Skill theme index only after **Save theme** is pressed. Long-running console
operations are cancellable and report safe inline status; form input survives
validation or provider failures.

Galley follows Obsidian's locale by default and can be switched live between
English and Simplified Chinese in the console or settings. The selected
language changes plugin chrome only; it never rewrites article or export
artifacts. Compatibility command IDs remain available with permanent bilingual
names.

On Mobile, the same ribbon opens a reduced console with **Console**,
**Articles**, and the language switch. Mobile can inspect the catalog and open
the sandboxed, script-free preview, but it does not load or register generation,
editing, Theme Lab, export repair, diagnostics, or Skill-management runtimes.

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
