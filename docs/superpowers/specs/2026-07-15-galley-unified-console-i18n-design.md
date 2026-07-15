# Galley Unified Console and Global i18n Design

**Status:** Approved interaction direction; written specification awaiting user review  
**Date:** 2026-07-15  
**Scope:** One integrated delivery for a persistent Galley entry, task-oriented console, page-based operations, and Chinese/English localization

## 1. Outcome

Galley becomes discoverable and operable without the Obsidian command palette.

On every platform, Obsidian shows a persistent Galley ribbon icon. Clicking it always opens or focuses one singleton Galley Console and lands on the console home page. The desktop console exposes every Galley workflow through visible pages, buttons, lists, forms, and confirmations. Article editing and Theme Lab remain dedicated views opened from the console because they need their own large workspace. Mobile uses the same persistent entry but exposes only the safe read-only Galley article library and preview flow.

Galley-owned UI supports Simplified Chinese and English globally. The initial language follows Obsidian. A console header switch can override it, and the choice persists. Changing the language updates all open Galley surfaces without discarding editor state.

Existing commands remain as compatibility and power-user shortcuts, but no primary user workflow depends on them.

## 2. Approved product decisions

- Default destination: always the task-oriented console home, not the last open module.
- Navigation model: hybrid. Home and management functions live in the console; visual editing and Theme Lab open dedicated tabs.
- Language coverage: every Galley-owned surface, including the console, workbench chrome, Theme Lab, export UI, settings, notices, confirmations, status messages, and user-facing error summaries.
- Language default: `auto`, resolved from Obsidian; explicit `zh-CN` or `en` overrides persist.
- Desktop: complete feature set.
- Mobile: persistent Galley entry, article discovery, and safe preview only.

## 3. Information architecture

### 3.1 Persistent ribbon entry

`GalleyPlugin.onload()` registers one accessible ribbon icon on desktop and mobile. Its tooltip is localized. Activating it calls `openGalleyConsole()` directly rather than executing a command.

`openGalleyConsole()` implements singleton behavior:

1. Find an existing `galley-console` leaf.
2. If found, switch it to the home route and reveal/focus it.
3. Otherwise, create one normal workspace tab, set its view type to `galley-console`, and reveal it.

Repeated clicks never create duplicate console tabs.

### 3.2 Desktop console routes

The console has a stable top navigation bar:

- **Console** — current context, primary next action, recent work, system status, and quick management.
- **Articles** — searchable canonical `*.galley.html` library with edit, preview, and open-export actions.
- **Themes** — built-in and custom theme inventory, enable/disable, import, export, delete, and Theme Lab entry.
- **Skill** — bundled/imported Skill inventory, inactive import, explicit activation, active version, and validation status.
- **Export configurations** — create, edit, duplicate, delete, and validate multiple export configurations.
- **Settings** — OpenAI-compatible endpoint, model, SecretStorage selector, generation parameters, output folder, language, and diagnostics.

The console always opens on **Console**, even if another route was active previously.

### 3.3 Task-oriented home

The home page is ordered by the user's next likely action:

1. **Current context card**
   - If the active file is Markdown: show name, basic content statistics, selected/default theme, and `Generate HTML` as the primary action.
   - If the active file is a Galley artifact: show `Open workbench` on desktop or `Preview` on mobile.
   - Otherwise: explain how to select a Markdown or Galley document and provide `Open article library`.
2. **Continue working** — the latest editable article, pending export, and unsaved valid theme draft when available.
3. **Recent articles** — canonical Galley pairs ordered by modification time.
4. **System status** — configured model, connection state, active Skill, and available theme count. Connection checks run only on explicit request.
5. **Quick management** — Theme Lab, theme library, Skill import, export configurations, and settings.

The home never sends a model request or scans imported archives automatically.

### 3.4 Dedicated views

The console opens these existing heavy views directly through typed plugin actions:

- `GalleyWorkbenchView` for desktop visual/source/preview editing and export.
- `ThemeLabView` for desktop AI theme generation and full-page preview.
- `GalleyPreviewView` for mobile and optional desktop read-only preview.

The console does not embed HugeRTE and does not reimplement Theme Lab. Closing a dedicated view leaves the console available as the stable navigation home.

## 4. Architecture

### 4.1 Console shell

Add a lightweight, platform-safe `GalleyConsoleView` with:

- `ConsoleRoute` state;
- a persistent header, locale switch, and route navigation;
- per-route renderer modules;
- abortable asynchronous operations;
- localized empty, loading, success, partial-success, and error states.

The shell owns navigation and view lifecycle only. It does not contain generation, document, theme, Skill, export, or settings business logic.

### 4.2 Shared action facade

Extract the operations currently called by command callbacks and prompt-based methods into a typed `GalleyActions` facade. Both compatibility commands and the console call the same facade methods. The console must never call `app.commands.executeCommandById()`.

The facade exposes operations such as:

- inspect active context;
- generate the active Markdown and open the result;
- list/open/preview Galley documents;
- open Theme Lab;
- list/import/export/enable/disable/delete themes;
- list/import/activate Skills;
- list/save/delete export configurations;
- read/save normalized settings;
- run the existing connection and Skill-loading diagnostic.

Operations accept typed input gathered from page forms. They do not invoke `window.prompt()`. Compatibility commands may open the corresponding console route or a small page-backed modal, but the primary implementation remains the page action.

### 4.3 Console state model

Each route receives an immutable snapshot plus actions. Async mutations use an explicit operation state:

`idle | loading | success | partial-success | error`

The view disables only the affected action while it is running. Starting a replacement operation aborts the prior one where cancellation is supported. Closing the console aborts console-owned work but does not close or mutate an already opened workbench.

Lists are refreshed after successful mutations. Theme and Skill operations continue to use the existing atomic repositories, validation, collision rules, and active-pointer CAS.

### 4.4 Article discovery

The article page derives its library from the vault rather than maintaining a second database. It accepts only canonical `*.galley.html` paths and validates the matching sidecar before showing document metadata. Invalid or incomplete pairs appear as unavailable with a localized explanation; they never crash the entire list or get silently treated as valid.

Vault create, modify, rename, and delete events invalidate the derived list. Active-file changes refresh only the current-context card.

### 4.5 Platform boundary

The console shell, article discovery, localization, and safe preview actions are platform-safe.

Desktop-only actions are supplied through a dynamic `DesktopConsoleRuntime`. Mobile startup must not statically import or initialize HugeRTE, generation, Theme Lab model calls, Skill archive management, WeChat repair, clipboard export, or desktop settings secrets. On mobile:

- navigation contains only **Console**, **Articles**, and **Language**;
- article actions contain only safe preview;
- desktop cards and actions are absent, not merely disabled;
- the UI explains the preview-only boundary in the selected language.

## 5. Global localization

### 5.1 Persisted setting

Extend normalized settings with:

```ts
type GalleyLanguage = "auto" | "zh-CN" | "en";
```

The default is `auto`. Existing settings migrate without user action.

### 5.2 Locale resolution

`auto` resolves the current Obsidian locale through a small injected `LocaleSource`. Chinese locales resolve to `zh-CN`; all other locales resolve to `en`. Explicit settings bypass auto detection.

The locale store exposes:

- the configured language;
- the resolved locale;
- `t(key, parameters?)`;
- a subscription for locale changes.

### 5.3 Typed resources

English is the canonical typed key set and Chinese must provide the same keys. Resources cover:

- view titles and navigation;
- labels, descriptions, buttons, placeholders, and accessibility text;
- statuses, confirmations, notices, validation summaries, and safe error messages;
- workbench, history, conflicts, properties, exports, Theme Lab, preview, settings, diagnostics, themes, and Skill management.

User content, filenames, model names, theme names, and provider responses are never translated. Internal error codes remain stable; presentation maps them to localized messages. Unknown errors use a localized safe fallback and never expose secrets.

### 5.4 Live language changes

Changing the language persists settings first, then publishes one locale-change event. Open views update their chrome in place:

- the console rerenders the active route;
- the workbench updates labels and status chrome without remounting HugeRTE or replacing document HTML;
- Theme Lab preserves its description, selected image, draft, issues, and preview;
- the settings tab rerenders normalized values without losing secrets;
- preview content remains byte-identical while its surrounding title/status changes.

Compatibility command names are permanently bilingual because Obsidian does not provide a reliable live command-label update API. Commands remain secondary and do not affect the selected UI locale.

## 6. Page behavior

### 6.1 Generation

The home page generation form shows the active Markdown, theme selection, and normalized generation options. Submission calls the same production generation pipeline used today. While running it shows progress and a cancel action. Success opens the new independent Galley artifact in the workbench. Failure leaves the source and prior artifacts unchanged and displays a localized allowlisted message.

### 6.2 Theme management

The Themes page replaces command prompts with a table and explicit actions. Delete and activation-impacting changes require confirmation. Import checks `File.size` before reading and retains all existing archive validation. Export downloads the deterministic theme archive. `Create theme` opens Theme Lab.

### 6.3 Skill management

The Skill page shows the bundled package, imported immutable versions, active status, validation state, and source provenance. Import never activates. Activation is explicit, confirmed, and uses the existing shared durable CAS boundary. Failures preserve the previous active version and refresh the durable status before reporting.

### 6.4 Export configuration management

The console owns configuration CRUD; actual document export remains in the article workbench because it requires a selected document session. A configuration can be created, edited, duplicated, or deleted using the existing normalizer and validation rules. The workbench observes saved configuration changes without corrupting an in-progress export.

### 6.5 Settings and diagnostics

The Settings route mirrors all Galley settings using page controls and Obsidian SecretStorage. The existing Obsidian plugin setting tab remains available and uses the same localized form model. Diagnostics run only after an explicit button click and render a localized summary plus the existing redacted details.

## 7. Error handling and accessibility

- Every operation has a visible status region with `role="status"` or `role="alert"` as appropriate.
- Buttons, tabs, tables, inputs, upload controls, and the language switch are keyboard accessible.
- Focus moves to the route heading after internal navigation and to the first error summary after failed form submission.
- Destructive actions require localized confirmation and name the target.
- Page forms retain user input after validation or network errors.
- Partial success preserves durable artifact paths and truthful record state, matching existing export semantics.
- Console teardown removes vault/workspace subscriptions and aborts console-owned controllers exactly once.

## 8. Visual direction

The console follows Obsidian light/dark variables for compatibility while using a restrained editorial Galley identity:

- serif wordmark and section headlines;
- compact sans-serif controls and data tables;
- warm paper-like surfaces derived from Obsidian variables rather than fixed light colors;
- one accessible amber editorial accent plus existing success/error semantic colors;
- 8–10 px radii, thin borders, and dense but readable task cards;
- responsive collapse from home main/aside columns to one column.

The interface must work in Obsidian light and dark themes, at 200% zoom, and in narrow desktop panes. It must not depend on remote fonts or images.

## 9. Compatibility and non-goals

### Compatibility

- Preserve existing Galley artifact, sidecar, history, export, theme, Skill, and settings data.
- Preserve existing command IDs and direct file-menu actions.
- Preserve AGPL-3.0 and bundled Skill attribution.
- Preserve the release archive's exact five-file contract.

### Non-goals

- No second HTML renderer or AST-based generation path.
- No embedded HugeRTE inside the console home.
- No mobile generation, editing, export, Theme Lab, model diagnostics, or Skill/theme mutation.
- No cloud account, synchronization service, or telemetry.
- No machine translation of article content or model output.
- No removal of compatibility commands in the first console release.

## 10. Acceptance criteria

### Entry and navigation

- A persistent Galley ribbon icon is registered on desktop and mobile with localized accessible text.
- Repeated activation focuses one console leaf and resets it to home.
- Every desktop feature is reachable through visible console UI without invoking the command palette or `window.prompt()`.
- Workbench and Theme Lab open as dedicated views from console actions.

### Localization

- Fresh installs follow Obsidian Chinese or English.
- Explicit Chinese/English selection persists across reloads.
- All Galley-owned surfaces render from complete typed resources in both languages.
- Live switching does not lose unsaved workbench content, Theme Lab draft state, form input, or preview bytes.
- Error codes and user data remain stable while their presentation changes language.

### Functional flows

- From the console, a desktop user can generate the active Markdown, open/edit/save the result, manage themes and Skills, manage export configurations, run diagnostics, and reach all three export profiles.
- Prompt-based theme/Skill workflows have page equivalents with validation, confirmation, and accessible status.
- Recent article discovery updates after vault create, rename, modify, and delete events.
- Mobile exposes the same persistent entry but can only discover and safely preview valid Galley documents.

### Boundaries and quality gates

- Console code does not execute commands as its action mechanism.
- Mobile startup has no static desktop-heavy dependency path.
- Existing Phase 1–5 transaction, generation, edit, export, Theme Lab, Skill, acceptance, benchmark, license, secret, and release gates remain green.
- New tests cover singleton ribbon behavior, every route, direct action wiring, desktop/mobile capability matrices, locale migration/fallback/live switching, accessibility states, teardown, and an end-to-end console-driven workflow.
- The final release ZIP remains exactly `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.

## 11. Delivery model

Implement this specification as one integrated console/i18n delivery with one consolidated review. Internal code may be organized into focused modules, but it must not be split into many independently reviewed mini-tasks. One batched remediation is allowed if the consolidated review finds issues.
