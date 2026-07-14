# Phase 3 Task 2 Implementation Report

## Outcome

Implemented the local-only HugeRTE visual-editor boundary on base commit
`06cc3c3408bf15b969bb3fb240ea4c375ea2af5f`. The visual editor and its CSS,
icons, model, theme, and selected plugins are bundled into `main.js`, while
mobile capability rejection occurs before the lazy HugeRTE import. Source mode
remains a separate textarea adapter.

## TDD evidence

- Initial RED: `npm test -- tests/editor` failed in five editor test files
  because the requested adapters, factory, generated asset module, and policy
  export did not yet exist. Three collected policy assertions also failed.
- Additional focused RED/GREEN cycles covered malformed mixed init results,
  arbitrary `data-*` attributes surviving the real HugeRTE parser, and event
  listener cleanup at destroy.
- R1 remediation RED/GREEN covered one and multiple `setHtml()` calls while the
  runtime loader or `runtime.init()` was pending, the real bundled runtime, and
  destroy-before-resolve interleavings. Both RED failures rolled `newest` back
  to `old`; the final implementation preserves the last write without emitting
  `onChange`.
- R2 remediation RED/GREEN covered two editors both running `setup`, setup-only
  editors omitted from the init result, extra and repeated setup, and destroy
  racing a malformed multiple init. RED retained seven listeners on the first
  editor; GREEN leaves every listener count at zero and removes each editor
  exactly once.
- Final focused gate: 5 files, 28 tests passed.
- Final type gate: `npm run test:typecheck` passed.
- Final full gate: 38 files, 843 tests passed.
- Final production gate: `npm run build` passed, including deterministic asset
  regeneration, TypeScript, and production esbuild.

The real-runtime smoke test initializes the installed local HugeRTE package in
jsdom, verifies content flow and security filtering, destroys it, and confirms
that temporary `window.hugerte` / `window.hugeRTE` registration does not leak.

## Implementation

- Added `HtmlEditorAdapter`, `SourceBodyEditor`, `EditorFactory`, and
  `HugeRteAdapter` with explicit lifecycle errors and idempotent cleanup.
- `EditorFactory` rejects unsupported mobile editing with
  `visual_editor_unavailable` before evaluating the dynamic visual-editor
  loader.
- HugeRTE accepts exactly one initialized editor for the owned target. Rejected,
  malformed, cancelled, duplicate, and destroyed lifecycles fail closed.
- Every editor passed to `setup` receives its own binding tuple and setup count.
  Acceptance requires one returned editor, one matching setup binding, one
  setup call, and the exact owned target. Failure cleanup de-duplicates returned
  candidates and setup-only editors before detaching and removing each one.
- Programmatic initialization and `setHtml` suppress change callbacks; user
  input/change/undo/redo events bridge to the adapter callback.
- While mounting is asynchronous, `setHtml` updates both the expected body and
  owned target. Once the exact editor is accepted, the latest expected body is
  synchronized under event suppression before the adapter becomes mounted.
- Selection is accepted only from the editor content document. Shared UI skin
  CSS is installed once per document and reference-counted across instances.
- The production esbuild entry receives an uncalled dynamic editor boundary so
  the implementation is included in `main.js` without initializing on startup
  or modifying `src/main.ts` before Phase 3 Task 3.

## Security and local-only policy

- `HUGERTE_VALID_ELEMENTS` is derived from the canonical authoring sanitizer
  tag and attribute policy, excluding document-shell elements.
- Tests assert exact policy drift prevention and absence of shell elements,
  event handlers, arbitrary `data-*`, scripts, SVG, and other forbidden tags.
- A HugeRTE `PreInit` parser/serializer node filter strips every `data-*`
  attribute except the three canonical Galley attributes. This is covered by a
  real HugeRTE test because HugeRTE otherwise preserves arbitrary `data-*`.
- Runtime configuration disables URL conversion, uploads, pasted data images,
  promotion, branding, unsafe embedded data, scripts, SVG data, and remote
  language/skin/content/icon/plugin URLs. No CDN/API key or remote runtime URL
  was added.
- Static audits found no browser-bundle `node:` imports in `src`, no remote URL
  or system-font token in the generated HugeRTE CSS, and no loose release
  `hugerte/` directory.

## Exact dependency and inspected API surface

- Dependency and lockfile both pin `hugerte` exactly to `1.0.12`.
- Inspected local declarations: `node_modules/hugerte/hugerte.d.ts` and package
  metadata in `node_modules/hugerte/package.json`.
- Inspected local side-effect entry points for `icons/default`, `models/dom`,
  `themes/silver`, and plugins `advlist`, `autolink`, `link`, `lists`, `image`,
  `table`, and `charmap`.
- License: MIT, recorded locally at `node_modules/hugerte/license.txt`.

## Deterministic generated assets

`tools/embed-hugerte-assets.mjs` reads the exact installed 1.0.12 oxide UI skin
and default content skin, rejects remote references, replaces upstream system
font stacks with the Galley Inter / Noto Sans SC stack, and emits deterministic
TypeScript constants. Two consecutive generator runs were byte-identical.

- Upstream UI CSS: 82,696 bytes, SHA-256
  `760e17c80fe088482734bb790c7f39eec790f208b13b8f82aa1df117a3cbf2bc`.
- Upstream content CSS: 1,220 bytes, SHA-256
  `f9d04a2d443fdbb00f57cecc825d939993c77578b8d70bae75a1d71c2c5efd07`.
- Normalized UI CSS: 82,184 bytes, SHA-256
  `8b6f044f2d4d3a03c9adbd07e3327fb53685afa77b17d8db45e199bd30f46690`.
- Normalized content CSS: 1,149 bytes, SHA-256
  `37e1d6516b51253ded3aa7880988c72f653b6e38c1e6f32ebf45ba7ae84c1187`.
- Generated module: 84,062 bytes, SHA-256
  `4769411aae4ed3ab3fd4981fe6b53e20a2705c2d89bd8973f1c153a970cee3d0`.

## Build and release evidence

- `main.js`: 2,322,791 bytes, SHA-256
  `c3c61ddccfbc4bc15e88c22fed6a2828d0cca655aed0d6458bc4a1bb89c1b8a8`.
- `styles.css`: 1 byte, SHA-256
  `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`.
- Bundle inspection found the exact plugin list, generated skin marker, and
  `visual_editor_unavailable` error marker in `main.js`.
- Normal `dev` and `build` commands regenerate the embedded HugeRTE CSS.
- `git diff --check` passed. The final commit hash is recorded in the handoff.

## Residual risk

HugeRTE materially increases the minified bundle size, although its module
initialization stays behind the capability-gated lazy boundary. Full Obsidian UI
composition and browser interaction remain Phase 3 Task 3; this task verifies
the adapter contract and the installed runtime in jsdom. Save-boundary
sanitization remains owned by the existing document session in addition to the
editor-side filtering implemented here.
