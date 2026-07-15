# Galley security model

API credentials remain in Obsidian `SecretStorage`; settings contain only a
Secret ID. Diagnostics, sidecars, fixtures, generated artifacts, logs, and the
release archive are checked for API-key-shaped values.

Model HTML is untrusted. Galley sanitizes it before preview/edit, removes scripts
and executable attributes, and renders previews in an empty sandbox with a
restrictive CSP. Mobile is preview-only.

Theme reference images require an explicit file selection, PNG/JPEG/WebP magic
bytes that agree with MIME, and a size no greater than 10 MiB. The selected image
is not sent unless the model first passes a separate built-in vision probe.

Skill and theme ZIP readers reject traversal, absolute paths, symbolic link
entries, duplicate canonical paths, encryption, missing files, and configured
archive/entry/extracted-size limits. Imported Python, shell, and other scripts
are read-only reference text and are never executed. Import does not activate a
Skill; failed explicit activation preserves the prior active version.

Galley and its adapted pinned Skill assets are distributed under AGPL-3.0 with
the upstream commit attribution in `THIRD_PARTY_NOTICES.md` and corresponding
source availability.
