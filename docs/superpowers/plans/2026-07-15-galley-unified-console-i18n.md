# Galley Unified Console and Global i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent task-oriented Galley Console that exposes every desktop workflow through pages and provides global Simplified Chinese/English localization while preserving mobile preview-only behavior.

**Architecture:** Register one platform-safe singleton `GalleyConsoleView` behind a persistent ribbon icon. Route console actions through a typed `GalleyActions` facade shared with compatibility commands, keep workbench and Theme Lab as dedicated views, and drive every Galley-owned label/status/error from a live `LocaleStore`. Desktop-only services stay behind a dynamic runtime boundary; mobile receives only article discovery, language selection, and safe preview.

**Tech Stack:** TypeScript, Obsidian Plugin API 1.11.4, Vitest/jsdom, existing Galley transaction/generation/export/theme/Skill services, CSS using Obsidian variables, esbuild.

---

## Integrated execution rule

This plan has five internal TDD workstreams for file ownership and dependency order. They are not separate user-visible tasks and do not get separate implementation/review loops. One phase lead owns the complete delivery, produces one implementation commit, runs one complete gate, and receives one consolidated review. If that review rejects the delivery, all findings are fixed in one batch.

Baseline:

- implementation HEAD: `f8da3809fc839014668cae888bfe178f360cb6de`
- approved design: `docs/superpowers/specs/2026-07-15-galley-unified-console-i18n-design.md`
- design commit: `8484124`

## Planned file map

### Localization

- Create `src/i18n/Resources.ts` — canonical typed English and complete Simplified Chinese resources.
- Create `src/i18n/LocaleStore.ts` — configured language, Obsidian locale resolution, translation interpolation, subscriptions.
- Create `src/i18n/LocalizedText.ts` — stable translator/service types passed into views and panels.
- Modify `src/settings/GalleySettings.ts` — persist `auto | zh-CN | en` with backward-compatible normalization.
- Test in `tests/i18n/LocaleStore.test.ts` and `tests/settings/GalleySettings.test.ts`.

### Console action boundary and discovery

- Create `src/console/GalleyActions.ts` — typed facade consumed by console and compatibility commands.
- Create `src/console/ArticleCatalog.ts` — canonical pair discovery and vault-event invalidation.
- Create `src/console/ConsoleTypes.ts` — routes, snapshots, operation states, capability-filtered navigation.
- Create `src/platform/DesktopConsoleRuntime.ts` — dynamic desktop-only theme/Skill/model/export-configuration action composition.
- Modify `src/main.ts` — compose the facade and remove prompt-only business paths.
- Test in `tests/console/GalleyActions.test.ts`, `tests/console/ArticleCatalog.test.ts`, and existing command/integration tests.

### Console UI

- Create `src/console/GalleyConsoleView.ts` — singleton shell, navigation, lifecycle, locale subscription.
- Create `src/console/ConsoleHome.ts` — active context, primary task, recent work, status, quick management.
- Create `src/console/ArticlePage.ts` — searchable article library and desktop/mobile actions.
- Create `src/console/ThemePage.ts` — built-in/custom theme table and page-based import/export/mutation.
- Create `src/console/SkillPage.ts` — package inventory, import, explicit activation, validation/provenance.
- Create `src/console/ExportConfigurationPage.ts` — configuration CRUD with current normalization.
- Create `src/console/SettingsPage.ts` — settings, language, SecretStorage, diagnostics.
- Modify `styles.css` — responsive task-oriented console using Obsidian variables.
- Test in `tests/console/GalleyConsoleView.test.ts`, route-specific tests, and plugin registration integration tests.

### Existing-surface localization

- Modify `src/workbench/GalleyWorkbenchView.ts`, `WorkbenchToolbar.ts`, `ConflictBanner.ts`, `DocumentOutline.ts`, `HistoryPanel.ts`, `PropertyInspector.ts`, `ExportPanel.ts`.
- Modify `src/theme-lab/ThemeLabView.ts`, `src/preview/GalleyPreviewView.ts`, `src/settings/GalleySettingTab.ts`, and user-facing presentation in `src/main.ts`.
- Test the affected existing suites plus `tests/i18n/LocalizedSurfaces.test.ts`.

### Integration, documentation, and release

- Create `tests/integration/ConsoleDrivenWorkflow.test.ts`.
- Create `tests/platform/ConsoleMobileStaticBoundary.test.ts`.
- Modify `README.md`, `SECURITY.md`, and release/static audit tests as needed.
- Preserve the exact five-file release archive contract.

## Task 1: Typed locale foundation and backward-compatible settings

**Files:**

- Create: `src/i18n/Resources.ts`
- Create: `src/i18n/LocaleStore.ts`
- Create: `src/i18n/LocalizedText.ts`
- Modify: `src/settings/GalleySettings.ts`
- Test: `tests/i18n/LocaleStore.test.ts`
- Test: `tests/settings/GalleySettings.test.ts`

- [ ] **Step 1: Write failing locale/settings tests**

Add tests that require identical resource key sets, Obsidian-locale fallback, persisted overrides, safe interpolation, subscriptions, and lossless migration from existing settings:

```ts
it("keeps English and Chinese resource keys identical", () => {
  expect(Object.keys(ZH_CN).sort()).toEqual(Object.keys(EN).sort());
});

it("follows Obsidian until an explicit language is persisted", () => {
  const store = new LocaleStore({ language: "auto", obsidianLocale: () => "zh-cn" });
  expect(store.locale()).toBe("zh-CN");
  store.configure("en");
  expect(store.locale()).toBe("en");
});

it("migrates old settings to auto language without changing other fields", () => {
  const settings = normalizeSettings({ model: "existing", activeSkillVersion: "bundled" });
  expect(settings.language).toBe("auto");
  expect(settings.model).toBe("existing");
});
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
npm test -- tests/i18n/LocaleStore.test.ts tests/settings/GalleySettings.test.ts
```

Expected: FAIL because the resources, store, and `language` setting do not exist.

- [ ] **Step 3: Implement typed resources and locale store**

Use a canonical resource type and an injected locale source:

```ts
export const EN = {
  "console.title": "Galley console",
  "console.nav.home": "Console",
  "console.action.generate": "Generate HTML",
  "common.language.zh": "中文",
  "common.language.en": "English"
} as const;

export type MessageKey = keyof typeof EN;
export const ZH_CN: Record<MessageKey, string> = {
  "console.title": "Galley 控制台",
  "console.nav.home": "控制台",
  "console.action.generate": "生成 HTML",
  "common.language.zh": "中文",
  "common.language.en": "English"
};

export type GalleyLanguage = "auto" | "zh-CN" | "en";
export interface LocalizedText {
  locale(): "zh-CN" | "en";
  t(key: MessageKey, parameters?: Readonly<Record<string, string | number>>): string;
  subscribe(listener: () => void): () => void;
}
```

`LocaleStore.configure()` publishes only after the new setting is durably saved by its owner. Interpolation replaces only declared `{name}` tokens and returns text for `textContent`, never HTML.

- [ ] **Step 4: Add `language` normalization**

Extend `GalleySettings` and `DEFAULT_SETTINGS` with `language: "auto"`. Accept only `auto`, `zh-CN`, or `en`; invalid input falls back to `auto`. Do not change any existing normalized field or secret handling.

- [ ] **Step 5: Run locale/settings GREEN gate**

Run:

```bash
npm test -- tests/i18n tests/settings
npm run test:typecheck
```

Expected: all locale/settings tests and typecheck pass.

## Task 2: Shared page actions, article catalog, and desktop runtime boundary

**Files:**

- Create: `src/console/ConsoleTypes.ts`
- Create: `src/console/ArticleCatalog.ts`
- Create: `src/console/GalleyActions.ts`
- Create: `src/platform/DesktopConsoleRuntime.ts`
- Modify: `src/main.ts`
- Modify: `src/commands/GenerateCurrentArticle.ts` only if needed to expose the existing typed operation without changing generation semantics
- Test: `tests/console/ArticleCatalog.test.ts`
- Test: `tests/console/GalleyActions.test.ts`
- Modify tests: `tests/commands/GenerateCurrentArticle.test.ts`

- [ ] **Step 1: Write failing action/catalog tests**

Require canonical pair discovery, invalid-pair isolation, active-context snapshots, direct typed action calls, cancellation, and no command/prompt dependency:

```ts
it("lists only canonical Galley pairs and reports invalid pairs without aborting", async () => {
  const catalog = new ArticleCatalog(vault);
  const snapshot = await catalog.snapshot();
  expect(snapshot.documents.map((item) => item.htmlPath)).toEqual(["valid.galley.html"]);
  expect(snapshot.unavailable).toEqual([{ path: "broken.galley.html", reason: "missing_sidecar" }]);
});

it("generates through the typed facade instead of the command registry", async () => {
  await actions.generateActiveMarkdown({ themeId: "paper-lab" }, signal);
  expect(commandRegistry.execute).not.toHaveBeenCalled();
  expect(generation.generate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run RED action tests**

Run:

```bash
npm test -- tests/console/ArticleCatalog.test.ts tests/console/GalleyActions.test.ts
```

Expected: FAIL because console contracts and facade do not exist.

- [ ] **Step 3: Define console contracts**

Use explicit route and operation types:

```ts
export type ConsoleRoute =
  | "home"
  | "articles"
  | "themes"
  | "skills"
  | "exports"
  | "settings";

export type OperationState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly operation: string }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "partial-success"; readonly message: string; readonly path: string }
  | { readonly status: "error"; readonly message: string };
```

Define `GalleyActions` as a typed interface with read methods and mutations. Desktop-only capabilities must be optional/absent in the mobile implementation rather than throwing after rendering forbidden controls.

- [ ] **Step 4: Implement article catalog**

Scan vault files for canonical `*.galley.html`, validate matching sidecars with existing codecs/schemas, and sort valid items by observed modification time then path. Subscribe to create/modify/rename/delete events through an injected vault-event adapter. `dispose()` unregisters every event exactly once.

- [ ] **Step 5: Compose shared actions**

Move orchestration out of prompt-oriented plugin methods into the facade. Commands become thin compatibility adapters. Console actions accept typed form input and call the same generation, document, theme, Skill, export-configuration, settings, and diagnostic services directly.

Desktop theme/Skill/model composition must live in `DesktopConsoleRuntime.ts` and be loaded dynamically only when desktop capabilities are present.

- [ ] **Step 6: Run action/catalog regression gate**

Run:

```bash
npm test -- tests/console tests/commands tests/integration/PluginWorkbenchRegistration.test.ts tests/platform
npm run test:typecheck
```

Expected: all selected tests pass and existing command IDs remain registered.

## Task 3: Persistent singleton console and all page routes

**Files:**

- Create: `src/console/GalleyConsoleView.ts`
- Create: `src/console/ConsoleHome.ts`
- Create: `src/console/ArticlePage.ts`
- Create: `src/console/ThemePage.ts`
- Create: `src/console/SkillPage.ts`
- Create: `src/console/ExportConfigurationPage.ts`
- Create: `src/console/SettingsPage.ts`
- Modify: `src/main.ts`
- Modify: `styles.css`
- Test: `tests/console/GalleyConsoleView.test.ts`
- Test: `tests/console/ConsoleHome.test.ts`
- Test: `tests/console/ManagementPages.test.ts`
- Test: `tests/integration/PluginConsoleRegistration.test.ts`

- [ ] **Step 1: Write failing ribbon/singleton/navigation tests**

```ts
it("registers one persistent ribbon entry and reuses one console leaf", async () => {
  await plugin.onload();
  expect(ribbons).toContainEqual(expect.objectContaining({ icon: expect.any(String) }));
  await ribbons[0].callback();
  await ribbons[0].callback();
  expect(workspace.leavesOfType("galley-console")).toHaveLength(1);
  expect(consoleView.route()).toBe("home");
});

it("opens heavy views through typed actions, never command execution", async () => {
  click(screen.getByRole("button", { name: "打开工作台" }));
  expect(actions.openWorkbench).toHaveBeenCalledWith("article.galley.html");
  expect(commandRegistry.execute).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing route/form/accessibility tests**

Cover:

- current Markdown, Galley artifact, and empty context cards;
- recent work and article sorting/search;
- theme import/export/enable/disable/delete with file-size precheck and confirmation;
- Skill import/inactive state/explicit CAS activation;
- export-configuration create/edit/duplicate/delete validation;
- settings persistence, SecretStorage component, diagnostics;
- `role=status`, `role=alert`, keyboard navigation, focus after route/error;
- retained form input after errors;
- abort and teardown behavior.

- [ ] **Step 3: Run console RED gate**

Run:

```bash
npm test -- tests/console tests/integration/PluginConsoleRegistration.test.ts
```

Expected: FAIL because the view/pages/ribbon are absent.

- [ ] **Step 4: Implement singleton shell and ribbon**

Register `GALLEY_CONSOLE_VIEW_TYPE = "galley-console"` on every platform and one ribbon icon. `openGalleyConsole()` searches `workspace.getLeavesOfType`, resets an existing view to `home`, or creates one normal tab. The view owns one route, one locale subscription, vault/workspace subscriptions, and abort controllers; `onClose()` disposes each exactly once.

- [ ] **Step 5: Implement task-oriented home**

Render current context first, then continue-work cards, recent articles, system status, and quick management. No model diagnostic or archive scan runs automatically. Use Obsidian variables and text nodes only.

- [ ] **Step 6: Implement all management pages**

Use page forms and tables; do not call `window.prompt()` or `app.commands.executeCommandById()`. Destructive actions use localized confirmations. Heavy editor and Theme Lab actions open their existing views through the facade. Actual document export stays in the workbench; the console manages reusable configurations.

- [ ] **Step 7: Implement responsive visual system**

Add `.galley-console*` styles using Obsidian variables, warm derived surfaces, accessible accent/focus rings, 8–10 px radii, two-column home layout collapsing to one column, dark-theme compatibility, and 200% zoom/narrow-pane behavior. Do not load remote fonts/assets.

- [ ] **Step 8: Run console GREEN gate**

Run:

```bash
npm test -- tests/console tests/integration/PluginConsoleRegistration.test.ts
npm run test:typecheck
npm run build
```

Expected: all console tests, typecheck, and build pass.

## Task 4: Localize every existing Galley surface without losing live state

**Files:**

- Modify: `src/workbench/GalleyWorkbenchView.ts`
- Modify: `src/workbench/WorkbenchToolbar.ts`
- Modify: `src/workbench/ConflictBanner.ts`
- Modify: `src/workbench/DocumentOutline.ts`
- Modify: `src/workbench/HistoryPanel.ts`
- Modify: `src/workbench/PropertyInspector.ts`
- Modify: `src/workbench/ExportPanel.ts`
- Modify: `src/theme-lab/ThemeLabView.ts`
- Modify: `src/preview/GalleyPreviewView.ts`
- Modify: `src/settings/GalleySettingTab.ts`
- Modify: `src/main.ts`
- Test: `tests/i18n/LocalizedSurfaces.test.ts`
- Modify: affected existing workbench/theme-lab/preview/settings tests

- [ ] **Step 1: Write failing complete-surface localization tests**

Require both resource sets to render the console, workbench toolbar/panels/conflicts, Theme Lab, preview chrome, settings, confirmations, notices, and error fallbacks. Add live-switch fixtures:

```ts
it("switches workbench chrome without remounting the editor or changing HTML", async () => {
  const adapter = mountedAdapter();
  const before = adapter.getHtml();
  await language.select("zh-CN");
  expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  expect(adapter.mountCount).toBe(1);
  expect(adapter.getHtml()).toBe(before);
});

it("preserves Theme Lab draft and form state across locale changes", async () => {
  description.value = "Warm editorial paper";
  await generateValidDraft();
  locale.configure("zh-CN");
  expect(description.value).toBe("Warm editorial paper");
  expect(previewFrame()).toBe(originalPreviewFrame);
});
```

- [ ] **Step 2: Run localized-surface RED gate**

Run:

```bash
npm test -- tests/i18n/LocalizedSurfaces.test.ts tests/workbench tests/theme-lab tests/preview tests/settings
```

Expected: FAIL because existing views still own hard-coded English UI strings.

- [ ] **Step 3: Inject translator into render boundaries**

Every view/panel accepts `LocalizedText` or a narrower `Pick<LocalizedText, "t" | "subscribe">`. Keep domain error codes stable and localize only presentation. Replace hard-coded labels, placeholders, ARIA text, statuses, confirmations, notices, and safe fallbacks with message keys.

- [ ] **Step 4: Implement live updates without remounting stateful content**

Workbench locale updates modify chrome nodes/render stateless panels without recreating HugeRTE. Theme Lab updates labels/status presentation while retaining description, file selection, draft, issues, and iframe. Preview replaces only chrome. Settings preserves normalized values and SecretStorage selection.

Compatibility command labels are registered as permanent bilingual labels; primary UI follows the selected locale.

- [ ] **Step 5: Run localized-surface GREEN gate**

Run:

```bash
npm test -- tests/i18n tests/workbench tests/theme-lab tests/preview tests/settings
npm run test:typecheck
```

Expected: all selected tests pass with no editor/draft state loss.

## Task 5: Mobile boundary, console-driven acceptance, documentation, and release

**Files:**

- Create: `tests/integration/ConsoleDrivenWorkflow.test.ts`
- Create: `tests/platform/ConsoleMobileStaticBoundary.test.ts`
- Modify: `tests/integration/PluginExportMobileRegistration.test.ts`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: release/static audits only when required to include new runtime files without weakening checks
- Update ignored implementation report: `.superpowers/sdd/console-i18n-implementation-report.md`

- [ ] **Step 1: Write failing desktop console-driven acceptance**

Exercise the real recorded path through visible console actions:

1. open console from ribbon;
2. observe active Markdown;
3. select a bundled theme and generate through `GenerationPipeline`;
4. open the generated production pair in `GalleyWorkbenchView`;
5. visually edit and save through `DocumentSession`;
6. manage an export configuration through the console;
7. export Standard Web, Portable Inline, and WeChat through `ExportService`/writer;
8. create and save a valid Theme Lab draft;
9. import an inactive Skill and explicitly activate it through durable CAS;
10. switch Chinese/English without changing artifact bytes.

Assert the console never calls the command registry or `window.prompt()`.

- [ ] **Step 2: Write failing mobile capability/static tests**

Load the plugin with mobile capabilities and assert:

- ribbon and console are present;
- only home/articles/language routes exist;
- only canonical safe preview actions render;
- generation/edit/export/theme/Skill/diagnostic controls are absent;
- no static import path reaches HugeRTE, desktop generation, Theme Lab model calls, Skill archive mutation, repair, or clipboard export.

- [ ] **Step 3: Run integration/mobile RED gate**

Run:

```bash
npm test -- tests/integration/ConsoleDrivenWorkflow.test.ts tests/platform/ConsoleMobileStaticBoundary.test.ts tests/integration/PluginExportMobileRegistration.test.ts
```

Expected: FAIL until console composition and mobile filtering are complete.

- [ ] **Step 4: Complete platform composition and docs**

Wire desktop actions only through dynamic import. Render the mobile preview-only explanation in the selected locale. Update README with ribbon/console workflows and bilingual behavior. Update SECURITY with console upload boundaries, direct action boundary, localization rules, and unchanged mobile capability policy.

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
npm test -- tests/console tests/i18n tests/workbench tests/theme-lab tests/preview tests/settings tests/integration tests/platform
npm run test:typecheck
npm test
npm run test:acceptance
npm run benchmark:long
npm run build
npm run audit:licenses
npm run release
npm test -- tests/release
npm run audit:package
npm run audit:secrets
npm run audit:mobile
npm run audit:static
git diff --check
```

Expected:

- every command exits `0`;
- no skipped/failing test;
- release ZIP contains exactly `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`;
- archived `main.js` hash equals the just-built worktree `main.js`;
- post-release secret scan requires and scans the current `main.js` and every ZIP entry.

- [ ] **Step 6: Audit the delivery against the specification**

Record in `.superpowers/sdd/console-i18n-implementation-report.md`:

- exact base and HEAD;
- files/contracts added;
- desktop and mobile capability evidence;
- Chinese/English resource completeness and live-state evidence;
- focused/full/acceptance/benchmark/release command outputs;
- release ZIP entries, byte size, SHA-256, and `main.js` parity;
- known limits, which must not contradict the approved specification.

- [ ] **Step 7: Create the single implementation commit**

```bash
git add src tests styles.css README.md SECURITY.md package.json .github tools
git commit -m "feat: add unified Galley console and localization"
```

Expected: one implementation commit after the plan commit and a clean tracked worktree. Do not commit generated `release/` or ignored `.superpowers/` working reports.

- [ ] **Step 8: One consolidated review**

An independent reviewer checks the complete plan-base-to-HEAD range once. Findings are recorded in one report. If rejected, the implementation lead fixes the entire frozen finding list in one batch and the same reviewer performs one targeted follow-up.
