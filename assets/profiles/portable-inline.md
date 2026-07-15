# Portable Inline export profile

- Output a body fragment without `doctype`, `html`, `head`, or `body` shell.
- Inline author CSS required by the fragment.
- Do not depend on `<style>`, external stylesheets, external fonts, or scripts.
- Remove authoring-only `data-galley-*` editing metadata.
- Keep a non-executable provenance comment so the standalone artifact remains traceable.
- Never modify the source `*.galley.html` document.
