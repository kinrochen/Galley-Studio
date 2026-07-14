# Galley Phase 5: Theme Lab, Skill Import, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users generate, preview, validate, save, and reuse custom themes; safely import another `gzh-design-skill` version; and produce a tested, attributed, release-ready Obsidian plugin.

**Architecture:** Custom themes are vault data validated by Zod and mounted as read-only virtual Skill files. Theme generation runs in a Skill-loaded model session and produces a draft that is never registered until explicit confirmation. Imported Skill archives pass size, path, structure, license, and component checks before activation. Release gates combine deterministic tests, golden fixtures, long-document benchmarks, license audits, and standard Obsidian assets.

**Tech Stack:** Existing stack plus fflate for ZIP import/export, GitHub Actions for CI, and the repository's TypeScript component validators.

## Global Constraints

- Built-in Skill files remain immutable.
- Custom theme IDs match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and may not collide with any active theme.
- Mount custom component libraries at virtual `references/theme-<id>.md` paths.
- Store custom themes under `.galley/themes/<id>/` with AGPL-3.0 metadata and upstream attribution.
- Only send a PNG/JPEG/WebP reference image up to 10 MiB when the user explicitly selected it and the model capability probe reports vision support.
- A theme draft is not visible to article generation until the user confirms Save.
- Imported ZIPs are limited to 25 MiB uncompressed, reject path traversal/symlinks, and never execute scripts.
- Runtime assets are `main.js`, `manifest.json`, and `styles.css`; the downloadable release archive also includes `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- Use TDD and commit after each task.

---

## File Map

```text
src/themes/ThemeManifest.ts                Zod schema and ID policy
src/themes/CustomThemeRepository.ts        vault persistence
src/themes/MergedThemeRepository.ts        built-in + custom index
src/themes/ThemeVirtualMount.ts             virtual Skill file overlay
src/themes/ThemeArchive.ts                  theme import/export archive
src/theme-lab/ThemeGenerationService.ts     Skill-loaded draft generation
src/theme-lab/ThemeDraft.ts                 in-memory draft contract
src/theme-lab/ComponentLibraryValidator.ts  TypeScript component_lint equivalent
src/theme-lab/ThemeLabView.ts               description/image/preview/save UI
src/theme-lab/ThemePreview.ts               sanitized full-page component preview
src/skill/ImportedSkillRepository.ts        plugin-data package storage
src/skill/SkillArchiveImporter.ts            ZIP validation and package hash
src/skill/SkillPackageValidator.ts           required files/license/theme checks
tools/run-long-document-benchmark.mjs        reproducible benchmark runner
tools/create-release.mjs                     standard release archive
.github/workflows/ci.yml                      automated gates
README.md, CONTRIBUTING.md                    user/developer documentation
```

Test support lives in `tests/support/themeFixtures.ts`, `tests/support/acceptanceHarness.ts`, and `tests/support/releaseZip.ts`. These files export `memoryVault`, `makeThemeDraft`, `makeMergedRepository`, `makeThemeGenerationDeps`, `makeThemeLabDeps`, `fakePng`, `zipOf`, `zipWithDeclaredUncompressedSize`, `createAcceptanceHarness`, `readText`, and `inspectReleaseZip`. Archive helpers generate bytes in memory and never write outside the test temp directory.

### Task 1: Persist custom themes and mount a merged virtual theme index

**Files:**
- Create: `src/themes/ThemeManifest.ts`, `src/themes/CustomThemeRepository.ts`, `src/themes/ThemeArchive.ts`
- Create: `src/themes/MergedThemeRepository.ts`, `src/themes/ThemeVirtualMount.ts`
- Create: `tests/themes/CustomThemeRepository.test.ts`, `tests/themes/MergedThemeRepository.test.ts`, `tests/themes/ThemeArchive.test.ts`
- Create: `tests/support/themeFixtures.ts`, `tests/support/acceptanceHarness.ts`, `tests/support/releaseZip.ts`
- Modify: `src/skill/SkillVirtualFileSystem.ts`

**Interfaces:**
- Produces: `ThemeManifestV1`, `CustomThemeRepository.save/list/get/remove/setEnabled`
- Produces: `exportThemeArchive(id): Uint8Array`, `importThemeArchive(bytes): ThemeArchiveDraft`
- Produces: `MergedThemeRepository.list/get/createSkillOverlay`
- Consumes: built-in `ThemeDefinition`, vault adapter

- [ ] **Step 1: Write failing persistence and collision tests**

```ts
import { expect, it } from "vitest";
import { CustomThemeRepository } from "../../src/themes/CustomThemeRepository";

it("writes the three approved files with AGPL metadata", async () => {
  const vault = memoryVault();
  await new CustomThemeRepository(vault).save(makeThemeDraft({ id: "mist-blue" }));
  expect(vault.paths()).toEqual(expect.arrayContaining([
    ".galley/themes/mist-blue/theme.json",
    ".galley/themes/mist-blue/component-library.md",
    ".galley/themes/mist-blue/preview.html"
  ]));
  expect(JSON.parse(await vault.read(".galley/themes/mist-blue/theme.json"))).toMatchObject({ license: "AGPL-3.0" });
});

it.each(["Mist Blue", "../blue", "blue_1", "moyu-green"])("rejects invalid or colliding ID %s", async id => {
  await expect(makeMergedRepository().save(makeThemeDraft({ id }))).rejects.toThrow();
});

it("keeps disabled themes on disk but removes them from the model index", async () => {
  const repo = makeMergedRepository();
  await repo.save(makeThemeDraft({ id: "mist-blue" }));
  await repo.setEnabled("mist-blue", false);
  expect(await repo.custom.get("mist-blue")).not.toBeNull();
  expect(repo.createSkillOverlay().get("references/theme-index.md")).not.toContain("mist-blue");
});
```

- [ ] **Step 2: Run theme repository tests to verify failure**

Run: `npm test -- tests/themes/CustomThemeRepository.test.ts tests/themes/MergedThemeRepository.test.ts tests/themes/ThemeArchive.test.ts`

Expected: FAIL because custom repository modules are missing.

- [ ] **Step 3: Implement schema, persistence, and virtual mounts**

```ts
export const ThemeManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  useCases: z.array(z.string().min(1)).min(1),
  underlineCss: z.string().min(1),
  createdAt: z.string().datetime(),
  skillVersion: z.string().min(1),
  enabled: z.boolean().default(true),
  license: z.literal("AGPL-3.0"),
  attribution: z.string().min(1)
});
export type ThemeManifestV1 = z.infer<typeof ThemeManifestV1Schema>;

export interface ThemeArchiveDraft {
  manifest: ThemeManifestV1;
  componentLibraryMarkdown: string;
  previewHtml: string;
  validation: ValidationReport;
}
```

Write all three files through temporary paths and roll back on failure. Reject built-in/custom collisions before any write. `createSkillOverlay()` returns a map containing one virtual `references/theme-<id>.md` per enabled custom theme and a generated `references/theme-index.md` that appends enabled custom rows to the built-in table. Disabled themes stay on disk but are absent from selection and model context. `SkillVirtualFileSystem.withOverlay` returns a new immutable VFS and rejects paths that overwrite anything except the specifically replaceable theme-index.

`ThemeArchive` exports exactly `theme.json`, `component-library.md`, and `preview.html` to a `.galley-theme.zip`. Import rejects traversal, symlinks, files outside that set, totals above 5 MiB, invalid manifests/components, and all ID collisions before returning an unsaved draft.

- [ ] **Step 4: Verify merged themes are model-readable**

Run: `npm test -- tests/themes tests/skill/SkillVirtualFileSystem.test.ts && npm run test:typecheck`

Expected: tests PASS; `read("references/theme-mist-blue.md")` returns the saved component library and the merged index references that exact virtual path.

- [ ] **Step 5: Commit custom theme storage**

```bash
git add src/themes src/skill/SkillVirtualFileSystem.ts tests/themes tests/skill/SkillVirtualFileSystem.test.ts tests/support/themeFixtures.ts tests/support/acceptanceHarness.ts tests/support/releaseZip.ts
git commit -m "feat: persist and mount custom themes"
```

### Task 2: Generate and validate complete theme drafts through the Skill

**Files:**
- Create: `src/theme-lab/ThemeDraft.ts`, `src/theme-lab/ThemeGenerationService.ts`
- Create: `src/theme-lab/ComponentLibraryValidator.ts`
- Create: `tests/theme-lab/ThemeGenerationService.test.ts`, `tests/theme-lab/ComponentLibraryValidator.test.ts`
- Create: `tests/fixtures/themes/valid-theme.md`, `tests/fixtures/themes/invalid-theme.md`

**Interfaces:**
- Consumes: `SkillSession`, capability result, theme repositories
- Produces: `ThemeGenerationService.generate(request, signal): Promise<ThemeDraft>`
- Produces: `validateComponentLibrary(markdown): ValidationReport`

- [ ] **Step 1: Write failing generation and component-lint tests**

```ts
import { expect, it } from "vitest";
import { ThemeGenerationService } from "../../src/theme-lab/ThemeGenerationService";

it("loads theme-generator and returns an unregistered draft", async () => {
  const deps = makeThemeGenerationDeps({ vision: true });
  const draft = await new ThemeGenerationService(deps).generate({ description: "雾蓝旅行杂志", referenceImage: undefined }, new AbortController().signal);
  expect(deps.session.audit().files).toEqual(expect.arrayContaining([
    "SKILL.md", "references/theme-index.md", "references/theme-generator.md", "references/common-components.md"
  ]));
  expect(draft.validation.valid).toBe(true);
  expect(await deps.repository.list()).toEqual([]);
});

it("refuses an image when the model has no vision capability", async () => {
  const service = new ThemeGenerationService(makeThemeGenerationDeps({ vision: false }));
  await expect(service.generate({ description: "ink", referenceImage: fakePng() }, new AbortController().signal)).rejects.toMatchObject({ code: "vision_not_supported" });
});
```

- [ ] **Step 2: Run theme-generation tests to verify failure**

Run: `npm test -- tests/theme-lab`

Expected: FAIL because theme-lab services are missing.

- [ ] **Step 3: Implement two-output draft generation and TypeScript component lint**

```ts
export interface ThemeGenerationRequest {
  description: string;
  name?: string;
  referenceImage?: { mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string };
}
export interface ThemeDraft {
  manifest: ThemeManifestV1;
  previewHtml: string;
  componentLibraryMarkdown: string;
  validation: ValidationReport;
  skillAudit: SkillLoadAudit;
}
```

Validate the reference image magic bytes against its declared PNG/JPEG/WebP MIME type and reject decoded payloads above 10 MiB. The service then bootstraps Skill, ensures `theme-generator.md` and `common-components.md`, sends the description plus optional image, and requests a strict JSON metadata envelope followed by delimited `PREVIEW_HTML` and `COMPONENT_LIBRARY_MD` sections. The preview must contain the Skill-required 45–75 component blocks in one continuous page; the component library must contain all five standard theme sections. Parse exactly one of each; sanitize preview HTML and validate the component library. The draft remains memory-only.

Port every deterministic rule from pinned `scripts/component_lint.py`: forbidden platform elements/attributes/CSS, `white-space:pre`, unwanted full dashed containers, missing required five theme sections, missing article skeleton/recipe/mapping tables, and missing `<span leaf>` where the standard theme format requires it. Do not spawn Python.

- [ ] **Step 4: Verify theme generation and lint parity**

Run: `npm test -- tests/theme-lab && npm run test:typecheck`

Expected: tests PASS; valid fixture has zero errors; invalid fixture reports the same categories as the pinned component lint; reference image bytes appear only in the vision-enabled request mock.

- [ ] **Step 5: Commit theme generation services**

```bash
git add src/theme-lab tests/theme-lab tests/fixtures/themes
git commit -m "feat: generate validated custom theme drafts"
```

### Task 3: Build the theme lab view with full-page preview and explicit save

**Files:**
- Create: `src/theme-lab/ThemeLabView.ts`, `src/theme-lab/ThemePreview.ts`
- Create: `tests/theme-lab/ThemeLabView.test.ts`, `tests/integration/CustomThemeFlow.test.ts`
- Modify: `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: `ThemeGenerationService`, `CustomThemeRepository`, safe preview
- Produces: view type `galley-theme-lab`

- [ ] **Step 1: Write the failing theme-lab flow test**

```ts
import { expect, it } from "vitest";
import { ThemeLabController } from "../../src/theme-lab/ThemeLabView";

it("does not register a theme until Save is confirmed", async () => {
  const deps = makeThemeLabDeps();
  const controller = new ThemeLabController(deps);
  await controller.generate({ description: "black and white editorial" });
  expect(await deps.repository.list()).toEqual([]);
  await controller.saveDraft();
  expect((await deps.repository.list()).map(theme => theme.id)).toEqual(["mono-editorial"]);
});
```

- [ ] **Step 2: Run view tests to verify failure**

Run: `npm test -- tests/theme-lab/ThemeLabView.test.ts tests/integration/CustomThemeFlow.test.ts`

Expected: FAIL because the view/controller is missing.

- [ ] **Step 3: Implement the theme lab interaction**

The view contains description, optional name/color/font fields, reference-image picker only when vision is available, Generate/Cancel actions, validation summary, full-page preview iframe, Regenerate, Discard, and Save. Preview uses the same scriptless safe-frame policy as article preview, but displays all generated components continuously. A theme library section provides Import, Export, Enable/Disable, and Delete actions; all destructive actions require confirmation.

Disable Save when validation has any error. Save first checks ID collisions again, writes the repository files, refreshes the merged theme repository, then displays the theme in both the workbench selector and future model theme index. Discard removes all in-memory draft data, including reference-image bytes.

- [ ] **Step 4: Run end-to-end custom-theme tests**

Run: `npm test -- tests/theme-lab tests/integration/CustomThemeFlow.test.ts && npm run build`

Expected: tests PASS; saved theme appears in merged index and can be ensured/read by a new Skill session.

- [ ] **Step 5: Commit the theme lab UI**

```bash
git add src/theme-lab src/main.ts styles.css tests/theme-lab tests/integration/CustomThemeFlow.test.ts
git commit -m "feat: add custom theme lab"
```

### Task 4: Import, validate, store, and activate Skill ZIP packages

**Files:**
- Create: `src/skill/SkillArchiveImporter.ts`, `src/skill/SkillPackageValidator.ts`, `src/skill/ImportedSkillRepository.ts`
- Create: `src/settings/SkillPackageSettings.ts`
- Create: `tests/skill/SkillArchiveImporter.test.ts`, `tests/skill/SkillPackageValidator.test.ts`, `tests/skill/ImportedSkillRepository.test.ts`
- Modify: `src/settings/GalleySettingTab.ts`, `src/main.ts`

**Interfaces:**
- Produces: `importSkillArchive(bytes): ValidatedSkillPackage`
- Produces: `ImportedSkillRepository.save/list/activate/remove`
- Consumes: active settings and Skill Runtime

- [ ] **Step 1: Write failing archive security tests**

```ts
import { expect, it } from "vitest";
import { importSkillArchive } from "../../src/skill/SkillArchiveImporter";

it.each([
  ["path traversal", zipOf({ "../escape": "x" }), "archive_path_traversal"],
  ["absolute path", zipOf({ "/escape": "x" }), "archive_path_traversal"],
  ["oversize", zipWithDeclaredUncompressedSize(25 * 1024 * 1024 + 1), "archive_too_large"]
])("rejects %s", async (_name, bytes, code) => {
  await expect(importSkillArchive(bytes)).rejects.toMatchObject({ code });
});
```

- [ ] **Step 2: Run importer tests to verify failure**

Run: `npm test -- tests/skill/SkillArchiveImporter.test.ts tests/skill/SkillPackageValidator.test.ts tests/skill/ImportedSkillRepository.test.ts`

Expected: FAIL because importer modules are missing.

- [ ] **Step 3: Implement strict import and explicit activation**

Decompress with fflate while summing uncompressed sizes before materializing strings. Reject absolute paths, `..`, empty segments, NUL bytes, duplicate normalized paths, symlink metadata, non-UTF-8 required files, and totals above 25 MiB.

Require `SKILL.md`, `LICENSE`, `references/theme-index.md`, `references/common-components.md`, every theme file referenced by the index, `scripts/component_lint.py`, and `scripts/validate_gzh_html.py`. Validate theme index and component libraries with Galley's TypeScript validators. Record SHA-256 as the import version; imported scripts are retained as reference text but never executed.

Store validated packages in plugin data under `skills/<package-hash>/package.zip` plus `metadata.json`. Importing does not activate. Settings show version/hash, source filename, validation date, and Activate/Remove. Activation updates `activeSkillVersion`, rebuilds VFS, reads every required file through the local VFS, and runs local theme/component validators. It rolls back without a network call if any local check fails.

- [ ] **Step 4: Verify import, rollback, and mobile gating**

Run: `npm test -- tests/skill tests/integration/MobileCapabilities.test.ts && npm run test:typecheck`

Expected: tests PASS; invalid archives write nothing; failed activation retains the prior active version; import controls are absent on mobile.

- [ ] **Step 5: Commit Skill package management**

```bash
git add src/skill src/settings src/main.ts tests/skill tests/integration/MobileCapabilities.test.ts
git commit -m "feat: import validated skill packages"
```

### Task 5: Add golden fixtures, long-document benchmark, and full acceptance tests

**Files:**
- Create: `tests/fixtures/articles/sample-article.md`, `tests/fixtures/articles/long-article.md`
- Create: `tests/fixtures/model-responses/<theme-id>.json` for all six built-in themes
- Create: `tests/acceptance/BuiltInThemes.test.ts`, `tests/acceptance/GalleyWorkflow.test.ts`, `tests/acceptance/SecretLeak.test.ts`
- Create: `tools/run-long-document-benchmark.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete plugin services with a recorded-response ChatClient
- Produces: deterministic acceptance report and benchmark JSON

- [ ] **Step 1: Write failing acceptance tests from the approved criteria**

```ts
import { expect, it } from "vitest";

for (const themeId of ["moyu-green", "red-white", "graphite-minimal", "zen-whitespace", "moyu-ticket", "olive-journal"]) {
  it(`generates, edits, and exports ${themeId}`, async () => {
    const app = createAcceptanceHarness({ themeId });
    const artifact = await app.generate("tests/fixtures/articles/sample-article.md");
    expect(artifact.sidecar.skillFiles).toContain(`references/theme-${themeId}.md`);
    await app.edit(artifact.htmlPath, body => body.replace("原句", "修改句"));
    for (const profile of ["standard-web", "portable-inline", "wechat"] as const) {
      expect((await app.export(artifact.htmlPath, profile)).validation.valid).toBe(true);
    }
  });
}
```

- [ ] **Step 2: Run acceptance tests to expose missing fixtures/reporting**

Run: `npm test -- tests/acceptance`

Expected: FAIL until recorded responses, harness, and benchmark report are complete.

- [ ] **Step 3: Add reproducible recordings and benchmark runner**

Record one deterministic valid response per built-in theme, one tool-call sequence, one injection-fallback sequence, and repair failures. Fixtures contain no real keys or user data.

`run-long-document-benchmark.mjs` uses the recorded client with `long-article.md` containing at least 10,000 Chinese characters, ten level-two headings, local images, code, table, list, quote, and signature. It writes `dist/benchmark-report.json` with source-block count, preserved count, missing/duplicate IDs, batch count, validation issues, elapsed milliseconds, and output bytes. Exit nonzero unless missing/duplicate counts are zero and final validation is valid.

Add `test:acceptance` and `benchmark:long` scripts.

- [ ] **Step 4: Run every acceptance gate**

Run: `npm run test:typecheck && npm test && npm run test:acceptance && npm run benchmark:long && npm run build && git diff --check`

Expected: all commands PASS; six themes each generate/edit/export; benchmark reports zero missing/duplicate source IDs; secret scan test finds no credential-shaped values.

- [ ] **Step 5: Commit acceptance coverage**

```bash
git add tests/fixtures tests/acceptance tools/run-long-document-benchmark.mjs package.json package-lock.json
git commit -m "test: add Galley acceptance coverage"
```

### Task 6: Add documentation, license audits, CI, and release packaging

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`, `docs/security.md`, `docs/skill-runtime.md`, `docs/export-profiles.md`
- Create: `tools/audit-licenses.mjs`, `tools/create-release.mjs`, `.github/workflows/ci.yml`
- Modify: `THIRD_PARTY_NOTICES.md`, `package.json`, `manifest.json`, `versions.json`
- Test: `tests/release/ReleasePackage.test.ts`, `tests/release/LicenseAudit.test.ts`

**Interfaces:**
- Produces: `dist/galley-0.1.0.zip`
- Produces: license audit JSON and CI gate

- [ ] **Step 1: Write failing release-package tests**

```ts
import { expect, it } from "vitest";
import { inspectReleaseZip } from "../support/releaseZip";

it("contains standard runtime assets plus license notices", async () => {
  const entries = await inspectReleaseZip("dist/galley-0.1.0.zip");
  expect(entries.sort()).toEqual(["LICENSE", "THIRD_PARTY_NOTICES.md", "main.js", "manifest.json", "styles.css"]);
});

it("keeps required attribution embedded in the bundle and repository", async () => {
  expect(await readText("LICENSE")).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
  expect(await readText("THIRD_PARTY_NOTICES.md")).toContain("gzh-design-skill");
  expect(await readText("main.js")).toContain("AGPL-3.0");
});
```

- [ ] **Step 2: Run release tests to verify missing tooling**

Run: `npm test -- tests/release`

Expected: FAIL because release archive and audit tooling are missing.

- [ ] **Step 3: Implement docs, audits, release archive, and CI**

README documents install, OpenAI-compatible configuration, SecretStorage, one-click generation, workbench, exports, custom themes, mobile limitations, privacy, AGPL source availability, and upstream attribution. Security docs explicitly state article text is sent to the configured endpoint and images are sent only by explicit theme-reference selection.

`audit-licenses.mjs` reads direct production dependencies and fails unless each license is in an allowlist compatible with AGPL distribution and appears in `THIRD_PARTY_NOTICES.md`. It also verifies bundled Skill version/hash and attribution.

`create-release.mjs` runs build, copies `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and `THIRD_PARTY_NOTICES.md` into a temporary directory, zips them to `dist/galley-0.1.0.zip`, and verifies manifest version equality. CI runs typecheck, unit tests, acceptance tests, long benchmark, build, license audit, and release tests on Node 24.

- [ ] **Step 4: Run the final release gate**

Run: `npm run test:typecheck && npm test && npm run test:acceptance && npm run benchmark:long && npm run build && npm run audit:licenses && npm run release && npm test -- tests/release && git diff --check`

Expected: every command PASS; release ZIP contains three runtime files and two license/notice files; repository is clean except intentionally generated ignored output.

- [ ] **Step 5: Commit the release-ready plugin**

```bash
git add README.md CONTRIBUTING.md docs tools/audit-licenses.mjs tools/create-release.mjs .github/workflows/ci.yml THIRD_PARTY_NOTICES.md package.json package-lock.json manifest.json versions.json tests/release
git commit -m "chore: prepare Galley 0.1.0 release"
```
