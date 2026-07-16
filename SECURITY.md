# Galley Studio security model

API credentials remain in Obsidian `SecretStorage`; settings contain only a
Secret ID. Diagnostics, sidecars, fixtures, generated artifacts, logs, and the
release archive are checked for API-key-shaped values.

Model HTML is untrusted. Galley Studio sanitizes it before preview/edit, removes scripts
and executable attributes, and renders previews in an empty sandbox with a
restrictive CSP. Console errors are allowlisted and never render provider
payloads, credentials, source Markdown, or raw model HTML. Galley Studio workflows do
not use `window.prompt`; sensitive choices come from Obsidian SecretStorage and
destructive or activating actions require explicit confirmation.

Mobile is preview-only. The console shell and catalog remain available, while
the desktop generation, HugeRTE, Theme Lab, export/clipboard, diagnostics, and
theme-management dependency graph stays behind a desktop-only dynamic import.
The mobile audit fails if those modules enter the static startup graph.

Theme reference images require an explicit file selection, PNG/JPEG/WebP magic
bytes that agree with MIME, and a size no greater than 10 MiB. The selected image
is not sent unless the model first passes a separate built-in vision probe.

Theme ZIP readers and the retained Skill-package validation primitives reject
traversal, absolute paths, symbolic link entries, duplicate canonical paths,
encryption, missing files, and configured archive/entry/extracted-size limits.
The UI rejects oversized `File.size` values before allocating an `ArrayBuffer`;
extraction then reconciles local and central headers and streams actual output
through length, aggregate-limit, and CRC checks. Python, shell, and other
scripts are read-only reference text and are never executed. Galley Studio 0.2.3 does
not expose Skill import or activation in the UI; its bundled Skill is pinned to
an audited upstream commit.

Language selection is persisted before it is published to live views. Locale
changes rerender only Galley Studio-owned chrome and preserve the active route, form
state, editor adapter, Theme Lab draft/preview, and exact artifact bytes.

Galley Studio and its adapted pinned Skill assets are distributed under AGPL-3.0 with
the upstream commit attribution in `THIRD_PARTY_NOTICES.md` and corresponding
source availability.
Production CI builds the five-file release first, then fails closed unless both
the current `main.js` and release ZIP exist and pass the API-key canary scan.
