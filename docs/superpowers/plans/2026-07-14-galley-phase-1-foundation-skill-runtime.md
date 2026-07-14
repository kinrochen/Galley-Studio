# Galley Phase 1: Foundation and Skill Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a loadable Obsidian plugin that stores model secrets safely, talks to an OpenAI-compatible endpoint, and proves that a model loaded the bundled `gzh-design-skill` through tool calls or deterministic injection fallback.

**Architecture:** Keep Obsidian integration thin. Pure TypeScript modules own settings normalization, provider protocol, Skill package loading, virtual-file access, and the Skill conversation state machine. The plugin entry point composes those modules and exposes a connection/Skill diagnostic command.

**Tech Stack:** TypeScript 5.9.3, Obsidian API 1.11.4, esbuild 0.25.12, Vitest 3.2.7, jsdom 26.1.0, fflate 0.8.3, Zod 4.4.3.

## Global Constraints

- License the repository under AGPL-3.0; preserve `gzh-design-skill` attribution and its pinned commit `ba1f4175519b481cb3566616c9e5178705067904`.
- Set `minAppVersion` to `1.11.4` and `isDesktopOnly` to `false`.
- Store only a SecretStorage ID in settings; never persist the secret value.
- Permit generation only on desktop; mobile code may load but must expose preview-only capabilities.
- Restrict `read_skill_file` to normalized, registered virtual paths.
- Never execute scripts contained in the Skill package.
- Use TDD and commit after each task.

---

## File Map

```text
package.json                         scripts and pinned dependencies
tsconfig.json                        production TypeScript settings
tsconfig.test.json                   test TypeScript settings
vitest.config.ts                     jsdom test runner
esbuild.config.mjs                   Obsidian CJS bundle
manifest.json                        plugin metadata
versions.json                        Obsidian compatibility map
LICENSE                              AGPL-3.0
THIRD_PARTY_NOTICES.md               upstream attribution
src/main.ts                          composition root and commands
src/platform/PlatformCapabilities.ts desktop/mobile feature gates
src/settings/GalleySettings.ts       persisted non-secret settings
src/settings/GalleySettingTab.ts     Obsidian settings UI
src/secrets/SecretStore.ts           secret abstraction and Obsidian adapter
src/ai/AiProtocol.ts                 provider-neutral request/response types
src/ai/AiError.ts                    normalized failures
src/ai/SseDecoder.ts                 OpenAI SSE parsing
src/ai/BaseUrlPolicy.ts               HTTPS/private-network policy
src/ai/Redactor.ts                    secret-safe diagnostics
src/ai/OpenAiCompatibleClient.ts     chat completions client
src/ai/CapabilityProbe.ts            tools/stream/vision diagnostics
src/skill/SkillPackage.ts            package types and path rules
src/skill/BundledSkillLoader.ts       embedded package decompression
src/skill/SkillVirtualFileSystem.ts  read-only allowlisted access
src/skill/SkillAudit.ts               load record
src/skill/SkillSession.ts             tool-first state machine
src/generated/bundledSkill.ts        generated compressed Skill bytes
tools/embed-gzh-skill.mjs             deterministic vendoring generator
tests/**                              unit and integration tests
```

Test support lives in `tests/support/ScriptedChatClient.ts` and `tests/support/phase1Factories.ts`. `ScriptedChatClient` consumes a fixed `ChatTurnResult[]`, records every request message, exposes `messagesText()`, `requestsWithTools()`, and `completionCount`, and never accesses the network. `phase1Factories.ts` exports `makeSession(client, capabilities?: Partial<ProviderCapabilities>)`, merging the partial value over `{ tools: true, streaming: false, vision: false, checkedAt: "2026-07-14T00:00:00.000Z" }`, with an in-memory two-file Skill. It also exports `makeDiagnosticDeps()` with the literal test secret `super-secret`; diagnostic tests must prove that literal never appears in results.

### Task 1: Scaffold a loadable, tested Obsidian plugin

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `esbuild.config.mjs`
- Create: `manifest.json`, `versions.json`, `styles.css`, `LICENSE`, `THIRD_PARTY_NOTICES.md`
- Create: `src/main.ts`, `src/platform/PlatformCapabilities.ts`
- Create: `tests/setup/obsidian.ts`, `tests/platform/PlatformCapabilities.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `derivePlatformCapabilities(isMobile: boolean): PlatformCapabilities`
- Produces: `PlatformCapabilities { canGenerate; canEdit; canImportSkill; canPreview }`

- [ ] **Step 1: Write the failing platform-gate test**

```ts
import { describe, expect, it } from "vitest";
import { derivePlatformCapabilities } from "../../src/platform/PlatformCapabilities";

describe("derivePlatformCapabilities", () => {
  it("allows full desktop features", () => {
    expect(derivePlatformCapabilities(false)).toEqual({
      canGenerate: true,
      canEdit: true,
      canImportSkill: true,
      canPreview: true
    });
  });

  it("limits mobile to preview", () => {
    expect(derivePlatformCapabilities(true)).toEqual({
      canGenerate: false,
      canEdit: false,
      canImportSkill: false,
      canPreview: true
    });
  });
});
```

- [ ] **Step 2: Add the exact project configuration and verify the test fails**

Use these dependency versions in `package.json`:

```json
{
  "name": "galley-obsidian",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs --watch",
    "build": "tsc --noEmit && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:typecheck": "tsc -p tsconfig.test.json --noEmit"
  },
  "dependencies": {
    "fflate": "0.8.3",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "24.10.0",
    "esbuild": "0.25.12",
    "jsdom": "26.1.0",
    "obsidian": "1.11.4",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
```

Set `manifest.json` to:

```json
{
  "id": "galley",
  "name": "Galley",
  "version": "0.1.0",
  "minAppVersion": "1.11.4",
  "description": "AI-driven Markdown-to-HTML publishing studio.",
  "author": "Galley contributors",
  "isDesktopOnly": false
}
```

Use these exact compiler/test/bundle settings:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "useDefineForClassFields": true, "skipLibCheck": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"], "types": ["node"]
  },
  "include": ["src/**/*.ts", "esbuild.config.mjs"]
}
```

Set `tsconfig.test.json` to `{ "extends": "./tsconfig.json", "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"] }`.

```ts
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/setup/obsidian.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"], restoreMocks: true }
});
```

`esbuild.config.mjs` must bundle `src/main.ts` to CommonJS `main.js`, target ES2022/browser, externalize `obsidian`, `electron`, and Node built-ins, use inline source maps only in development, and minify only in production. Set `versions.json` to `{ "0.1.0": "1.11.4" }`. Copy the complete upstream AGPL text with `cp /Users/chen/.codex/skills/gzh-design/LICENSE LICENSE`; `THIRD_PARTY_NOTICES.md` initially identifies the pinned gzh-design commit and its AGPL-3.0 license.

Run: `npm install && npm test -- tests/platform/PlatformCapabilities.test.ts`

Expected: FAIL because `PlatformCapabilities.ts` does not exist.

- [ ] **Step 3: Implement the minimal platform gate and plugin entry**

```ts
// src/platform/PlatformCapabilities.ts
export interface PlatformCapabilities {
  canGenerate: boolean;
  canEdit: boolean;
  canImportSkill: boolean;
  canPreview: boolean;
}

export function derivePlatformCapabilities(isMobile: boolean): PlatformCapabilities {
  return {
    canGenerate: !isMobile,
    canEdit: !isMobile,
    canImportSkill: !isMobile,
    canPreview: true
  };
}
```

```ts
// src/main.ts
import { Platform, Plugin } from "obsidian";
import { derivePlatformCapabilities } from "./platform/PlatformCapabilities";

export default class GalleyPlugin extends Plugin {
  async onload(): Promise<void> {
    const capabilities = derivePlatformCapabilities(Platform.isMobileApp);
    this.addCommand({
      id: "show-capabilities",
      name: "Show Galley capabilities",
      callback: () => console.info("Galley capabilities", capabilities)
    });
  }
}
```

- [ ] **Step 4: Run the phase scaffold checks**

Run: `npm run test:typecheck && npm test -- tests/platform/PlatformCapabilities.test.ts && npm run build`

Expected: typecheck PASS, 2 tests PASS, and esbuild writes `main.js`.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.test.json vitest.config.ts esbuild.config.mjs manifest.json versions.json styles.css LICENSE THIRD_PARTY_NOTICES.md src/main.ts src/platform tests/setup tests/platform .gitignore
git commit -m "chore: scaffold Galley Obsidian plugin"
```

### Task 2: Add normalized settings, SecretStorage, and settings UI

**Files:**
- Create: `src/settings/GalleySettings.ts`
- Create: `src/settings/GalleySettingTab.ts`
- Create: `src/secrets/SecretStore.ts`
- Create: `tests/settings/GalleySettings.test.ts`
- Create: `tests/secrets/SecretStore.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `GalleySettings`, `DEFAULT_SETTINGS`, `normalizeSettings(value)`
- Produces: `SecretStore.get(id): string | null`
- Produces: `ObsidianSecretStore`
- Consumes: `PlatformCapabilities`

- [ ] **Step 1: Write failing settings and secret tests**

```ts
import { expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/settings/GalleySettings";

it("normalizes provider settings without an apiKey field", () => {
  const settings = normalizeSettings({ baseUrl: "https://api.example.com/", model: "x", apiKey: "leak" });
  expect(settings.baseUrl).toBe("https://api.example.com");
  expect(settings).not.toHaveProperty("apiKey");
  expect(settings.secretId).toBe("");
  expect(DEFAULT_SETTINGS.contextWindow).toBe(128_000);
});
```

```ts
import { expect, it } from "vitest";
import { MemorySecretStore } from "../../src/secrets/SecretStore";

it("returns a secret without exposing persistence details", () => {
  const store = new MemorySecretStore(new Map([["galley-key", "secret"]]));
  expect(store.get("galley-key")).toBe("secret");
  expect(store.get("missing")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/settings/GalleySettings.test.ts tests/secrets/SecretStore.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement exact settings and secret interfaces**

```ts
// src/settings/GalleySettings.ts
export interface GalleySettings {
  baseUrl: string;
  model: string;
  secretId: string;
  temperature: number;
  timeoutMs: number;
  contextWindow: number;
  outputFolder: string;
  activeSkillVersion: string;
}

export const DEFAULT_SETTINGS: GalleySettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  secretId: "",
  temperature: 0.4,
  timeoutMs: 120_000,
  contextWindow: 128_000,
  outputFolder: "",
  activeSkillVersion: "bundled"
};

export function normalizeSettings(value: unknown): GalleySettings {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    ...DEFAULT_SETTINGS,
    baseUrl: String(input.baseUrl ?? DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
    model: String(input.model ?? ""),
    secretId: String(input.secretId ?? ""),
    temperature: clamp(Number(input.temperature ?? 0.4), 0, 2),
    timeoutMs: clamp(Number(input.timeoutMs ?? 120_000), 10_000, 600_000),
    contextWindow: clamp(Number(input.contextWindow ?? 128_000), 8_000, 2_000_000),
    outputFolder: String(input.outputFolder ?? ""),
    activeSkillVersion: String(input.activeSkillVersion ?? "bundled")
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
```

```ts
// src/secrets/SecretStore.ts
import type { App } from "obsidian";

export interface SecretStore { get(id: string): string | null; }

export class ObsidianSecretStore implements SecretStore {
  constructor(private readonly app: App) {}
  get(id: string): string | null { return id ? this.app.secretStorage.getSecret(id) : null; }
}

export class MemorySecretStore implements SecretStore {
  constructor(private readonly values: ReadonlyMap<string, string>) {}
  get(id: string): string | null { return this.values.get(id) ?? null; }
}
```

Implement `GalleySettingTab` with `SecretComponent`; its `onChange` stores only the selected Secret ID. Load settings in `main.ts` with `normalizeSettings(await this.loadData())` and save through `this.saveData(settings)`.

- [ ] **Step 4: Verify no persisted secret field exists**

Run: `npm test -- tests/settings/GalleySettings.test.ts tests/secrets/SecretStore.test.ts && rg -n "apiKey" src tests | rg -v "not.toHaveProperty"`

Expected: tests PASS; the search prints no persisted `apiKey` property.

- [ ] **Step 5: Commit settings and secret handling**

```bash
git add src/settings src/secrets src/main.ts tests/settings tests/secrets
git commit -m "feat: add secure provider settings"
```

### Task 3: Implement the OpenAI-compatible protocol and capability probe

**Files:**
- Create: `src/ai/AiProtocol.ts`, `src/ai/AiError.ts`, `src/ai/SseDecoder.ts`
- Create: `src/ai/BaseUrlPolicy.ts`, `src/ai/Redactor.ts`
- Create: `src/ai/OpenAiCompatibleClient.ts`, `src/ai/CapabilityProbe.ts`
- Create: `tests/ai/SseDecoder.test.ts`, `tests/ai/OpenAiCompatibleClient.test.ts`, `tests/ai/CapabilityProbe.test.ts`
- Create: `tests/ai/BaseUrlPolicy.test.ts`, `tests/ai/Redactor.test.ts`

**Interfaces:**
- Produces: `ChatClient.complete(request, signal): Promise<ChatTurnResult>`
- Produces: `ProviderCapabilities { tools; streaming; vision; checkedAt }`
- Consumes: `GalleySettings`, `SecretStore`

- [ ] **Step 1: Write failing protocol tests**

```ts
import { expect, it, vi } from "vitest";
import { OpenAiCompatibleClient } from "../../src/ai/OpenAiCompatibleClient";

it("normalizes assistant tool calls", async () => {
  const transport = { post: vi.fn().mockResolvedValue({
    status: 200,
    json: { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "call_1", type: "function", function: { name: "read_skill_file", arguments: "{\"path\":\"SKILL.md\"}" }
    }] } }] }
  }) };
  const client = new OpenAiCompatibleClient(transport, () => "secret");
  const result = await client.complete({ baseUrl: "https://api.example/v1", model: "m", messages: [] }, new AbortController().signal);
  expect(result.toolCalls).toEqual([{ id: "call_1", name: "read_skill_file", argumentsJson: "{\"path\":\"SKILL.md\"}" }]);
});
```

```ts
import { expect, it } from "vitest";
import { decodeSseLines } from "../../src/ai/SseDecoder";

it("decodes data frames and ignores DONE", () => {
  expect(decodeSseLines("data: {\"x\":1}\n\ndata: [DONE]\n\n")).toEqual([{ x: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify missing implementations**

Run: `npm test -- tests/ai`

Expected: FAIL because AI protocol modules are missing.

- [ ] **Step 3: Implement the provider-neutral contract and client**

```ts
// src/ai/AiProtocol.ts
export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; toolCalls?: ChatToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };
export interface ChatToolCall { id: string; name: string; argumentsJson: string; }
export interface ChatTool { name: string; description: string; parameters: Record<string, unknown>; }
export interface ChatRequest {
  baseUrl: string; model: string; messages: ChatMessage[]; tools?: ChatTool[];
  temperature?: number; stream?: boolean;
}
export interface ChatTurnResult { content: string; toolCalls: ChatToolCall[]; finishReason: string | null; }
export interface ChatClient { complete(request: ChatRequest, signal: AbortSignal): Promise<ChatTurnResult>; }
export interface HttpTransport {
  post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<{ status: number; json: unknown }>;
  stream?(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): AsyncIterable<string>;
}
```

`OpenAiCompatibleClient.complete` must POST to `${baseUrl}/chat/completions`, add `Authorization: Bearer <secret>`, map non-2xx responses to `AiError`, and normalize `message.content` plus `message.tool_calls`. When `request.stream` is true and `transport.stream` exists, feed chunks through the stateful SSE decoder; otherwise send a non-streaming request. `SseDecoder` must buffer incomplete lines and never log raw frames.

`validateBaseUrl` requires HTTPS except for `localhost`, loopback, IPv6 loopback, and RFC1918 addresses. It rejects embedded credentials, non-HTTP schemes, query strings, and fragments. The client retries network failures, 429, and 5xx twice with injected delays of 500 ms and 1,000 ms; it never retries 400, 401, 403, or an aborted signal. Wrap each attempt in the configured timeout and forward cancellation through the same signal.

`redactDiagnostic(value, secrets)` recursively replaces Authorization/Cookie values, configured secrets, and credential-shaped query parameters with `[REDACTED]`. Add tests for 401, 429 retry count, 500 retry count, abort without retry, stream fallback, unsafe Base URLs, and error objects containing the configured secret.

`CapabilityProbe.probe` performs a minimal tool request named `galley_capability_echo`; a valid returned tool call sets `tools: true`. Streaming and vision are opt-in probe requests; any unsupported response sets only that capability to `false` without failing the entire probe.

- [ ] **Step 4: Run protocol tests and typecheck**

Run: `npm test -- tests/ai && npm run test:typecheck`

Expected: all AI tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the AI gateway**

```bash
git add src/ai tests/ai
git commit -m "feat: add OpenAI-compatible gateway"
```

### Task 4: Vendor and load the pinned Skill as a read-only virtual filesystem

**Files:**
- Create: `tools/embed-gzh-skill.mjs`
- Create: `src/generated/bundledSkill.ts`
- Create: `src/skill/SkillPackage.ts`, `src/skill/BundledSkillLoader.ts`, `src/skill/SkillVirtualFileSystem.ts`
- Create: `tests/skill/BundledSkillLoader.test.ts`, `tests/skill/SkillVirtualFileSystem.test.ts`
- Modify: `package.json`, `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `SkillPackage { id; version; files: ReadonlyMap<string,string> }`
- Produces: `SkillVirtualFileSystem.read(path): string`
- Produces: `SkillVirtualFileSystem.has(path): boolean`

- [ ] **Step 1: Write failing virtual-filesystem tests**

```ts
import { expect, it } from "vitest";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";

const vfs = new SkillVirtualFileSystem(new Map([
  ["SKILL.md", "workflow"],
  ["references/theme-index.md", "themes"]
]));

it("reads registered normalized paths", () => {
  expect(vfs.read("./references/theme-index.md")).toBe("themes");
});

it.each(["../secret", "/etc/passwd", "https://example.com/x", "references/../../x"])("rejects %s", path => {
  expect(() => vfs.read(path)).toThrow(/Invalid skill path/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/skill/SkillVirtualFileSystem.test.ts`

Expected: FAIL because the VFS does not exist.

- [ ] **Step 3: Implement deterministic embedding and VFS rules**

`tools/embed-gzh-skill.mjs` must:

1. Accept `--source <directory>` and `--version <sha>`.
2. Reject a source whose `git rev-parse HEAD` differs from the provided SHA.
3. Include every regular file except `.git/**` and `.github/**`.
4. Sort paths lexicographically, zip with fflate, and write a base64 constant plus SHA-256 to `src/generated/bundledSkill.ts`.
5. Never execute files from the source package.

Implement path normalization as:

```ts
export function normalizeSkillPath(input: string): string {
  const value = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!value || value.startsWith("/") || /^[a-z]+:\/\//i.test(value)) throw new Error(`Invalid skill path: ${input}`);
  const parts = value.split("/");
  if (parts.some(part => part === "" || part === "." || part === "..")) throw new Error(`Invalid skill path: ${input}`);
  return parts.join("/");
}
```

Run the generator with:

```bash
node tools/embed-gzh-skill.mjs --source /Users/chen/.codex/skills/gzh-design --version ba1f4175519b481cb3566616c9e5178705067904
```

Expected: generated module contains the pinned version, compressed bytes, package hash, and no absolute source path.

- [ ] **Step 4: Verify package contents and traversal protection**

Run: `npm test -- tests/skill/BundledSkillLoader.test.ts tests/skill/SkillVirtualFileSystem.test.ts && rg -n "/Users/chen" src/generated && exit 1 || true`

Expected: tests PASS and the generated source contains no developer path.

- [ ] **Step 5: Commit the embedded Skill runtime**

```bash
git add tools/embed-gzh-skill.mjs src/generated/bundledSkill.ts src/skill package.json package-lock.json THIRD_PARTY_NOTICES.md tests/skill
git commit -m "feat: embed gzh design skill"
```

### Task 5: Implement tool-first Skill sessions with injection fallback and audit

**Files:**
- Create: `src/skill/SkillAudit.ts`, `src/skill/SkillSession.ts`
- Create: `tests/skill/SkillSession.test.ts`, `tests/support/ScriptedChatClient.ts`, `tests/support/phase1Factories.ts`

**Interfaces:**
- Consumes: `ChatClient`, `ProviderCapabilities`, `SkillPackage`, `SkillVirtualFileSystem`
- Produces: `SkillSession.bootstrap(signal): Promise<void>`
- Produces: `SkillSession.ensureFiles(paths, signal): Promise<void>`
- Produces: `SkillSession.complete(prompt, signal): Promise<string>`
- Produces: `SkillSession.audit(): SkillLoadAudit`

- [ ] **Step 1: Write failing tool and fallback tests**

```ts
import { expect, it } from "vitest";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import { SkillSession } from "../../src/skill/SkillSession";

it("records files actually loaded through read_skill_file", async () => {
  const client = new ScriptedChatClient([
    { content: "", toolCalls: [{ id: "1", name: "read_skill_file", argumentsJson: "{\"path\":\"SKILL.md\"}" }], finishReason: "tool_calls" },
    { content: "", toolCalls: [{ id: "2", name: "read_skill_file", argumentsJson: "{\"path\":\"references/theme-index.md\"}" }], finishReason: "tool_calls" },
    { content: "loaded", toolCalls: [], finishReason: "stop" }
  ]);
  const session = makeSession(client);
  await session.bootstrap(new AbortController().signal);
  expect(session.audit()).toMatchObject({ loadMode: "tool-calls", files: ["SKILL.md", "references/theme-index.md"] });
});

it("injects required files after two ignored tool rounds", async () => {
  const client = new ScriptedChatClient([
    { content: "continue", toolCalls: [], finishReason: "stop" },
    { content: "continue", toolCalls: [], finishReason: "stop" }
  ]);
  const session = makeSession(client);
  await session.bootstrap(new AbortController().signal);
  expect(session.audit().loadMode).toBe("injected");
  expect(client.messagesText()).toContain("<skill-file path=\"SKILL.md\">");
});

it("injects immediately when the endpoint has no tool capability", async () => {
  const client = new ScriptedChatClient([]);
  const session = makeSession(client, { tools: false });
  await session.bootstrap(new AbortController().signal);
  expect(session.audit().loadMode).toBe("injected");
  expect(client.requestsWithTools()).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify the state machine is missing**

Run: `npm test -- tests/skill/SkillSession.test.ts`

Expected: FAIL because `SkillSession` and the test scripted client do not exist.

- [ ] **Step 3: Implement the exact Skill session contract**

Use this audit shape:

```ts
export type SkillLoadMode = "tool-calls" | "injected" | "mixed";
export interface SkillLoadAudit {
  skillId: string;
  skillVersion: string;
  packageHash: string;
  loadMode: SkillLoadMode;
  files: string[];
}
```

`bootstrap()` calls `ensureFiles(["SKILL.md", "references/theme-index.md"])`. `ensureFiles` offers exactly one tool:

```ts
export const READ_SKILL_FILE_TOOL = {
  name: "read_skill_file",
  description: "Read one registered UTF-8 file from the active gzh-design Skill package.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false
  }
};
```

When `ProviderCapabilities.tools` is false, inject the required files immediately without sending a tool definition. When tools are marked available but the endpoint returns the normalized `tools_unsupported` error, update the in-memory capability to false and retry once through injection. Process valid tool calls into `role: "tool"` messages. Reject unknown tools or invalid JSON. Ask for missing required reads twice; then append one system message per missing file using `<skill-file path="...">...</skill-file>`. `complete()` continues processing `read_skill_file` calls for at most eight tool rounds and throws `AiError("tool_round_limit")` on the ninth.

- [ ] **Step 4: Run Skill-session tests and the full unit suite**

Run: `npm test -- tests/skill/SkillSession.test.ts && npm test`

Expected: Skill-session tests PASS and all earlier tests remain green.

- [ ] **Step 5: Commit the Skill session state machine**

```bash
git add src/skill/SkillAudit.ts src/skill/SkillSession.ts tests/skill/SkillSession.test.ts tests/support/ScriptedChatClient.ts tests/support/phase1Factories.ts
git commit -m "feat: add tool-first skill sessions"
```

### Task 6: Wire diagnostics into Obsidian and close the phase gate

**Files:**
- Create: `src/diagnostics/ConnectionDiagnostic.ts`
- Create: `tests/diagnostics/ConnectionDiagnostic.test.ts`
- Modify: `src/main.ts`, `src/settings/GalleySettingTab.ts`

**Interfaces:**
- Consumes: settings, `SecretStore`, `CapabilityProbe`, `BundledSkillLoader`, `SkillSession`
- Produces: `runConnectionDiagnostic(deps, signal): Promise<ConnectionDiagnosticResult>`

- [ ] **Step 1: Write the failing diagnostic test**

```ts
import { expect, it } from "vitest";
import { runConnectionDiagnostic } from "../../src/diagnostics/ConnectionDiagnostic";

it("reports capability and audited Skill loading without returning the secret", async () => {
  const result = await runConnectionDiagnostic(makeDiagnosticDeps(), new AbortController().signal);
  expect(result.ok).toBe(true);
  expect(result.skillFiles).toContain("SKILL.md");
  expect(JSON.stringify(result)).not.toContain("super-secret");
});
```

- [ ] **Step 2: Run the diagnostic test to verify it fails**

Run: `npm test -- tests/diagnostics/ConnectionDiagnostic.test.ts`

Expected: FAIL because the diagnostic module is missing.

- [ ] **Step 3: Implement and register the diagnostic**

```ts
export interface ConnectionDiagnosticResult {
  ok: boolean;
  model: string;
  capabilities: { tools: boolean; streaming: boolean; vision: boolean };
  skillVersion: string;
  skillLoadMode: "tool-calls" | "injected" | "mixed";
  skillFiles: string[];
  errorCode?: string;
}
```

Register `Galley: Check model connection and Skill loading` only when `canGenerate` is true. Show a Notice summary and a modal containing model, capabilities, Skill version, load mode, and file list. Do not include request bodies, headers, or secrets. Add the same action to the settings tab.

- [ ] **Step 4: Run the complete phase gate**

Run: `npm run test:typecheck && npm test && npm run build && git diff --check`

Expected: all checks PASS; `main.js`, `manifest.json`, and `styles.css` exist; no tracked secret fixture exists.

- [ ] **Step 5: Commit the diagnostic integration**

```bash
git add src/diagnostics src/main.ts src/settings/GalleySettingTab.ts tests/diagnostics
git commit -m "feat: add model and skill diagnostics"
```
