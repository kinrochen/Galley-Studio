import { AiError } from "../ai/AiError";
import type {
  ChatClient,
  ChatRequest,
  ChatTool,
  ChatToolCall,
  ChatTurnResult
} from "../ai/AiProtocol";
import type { ProviderCapabilities } from "../ai/CapabilityProbe";
import type { SkillLoadAudit, SkillLoadMode } from "./SkillAudit";
import type { SkillPackage } from "./SkillPackage";
import {
  normalizeSkillPath,
  SkillVirtualFileSystem
} from "./SkillVirtualFileSystem";

export const READ_SKILL_FILE_TOOL: ChatTool = {
  name: "read_skill_file",
  description:
    "Read one registered UTF-8 file from the active gzh-design Skill package.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false
  }
};

export interface SkillSessionOptions {
  client: ChatClient;
  target: Pick<ChatRequest, "baseUrl" | "model">;
  capabilities: ProviderCapabilities;
  skillPackage: SkillPackage;
  vfs: SkillVirtualFileSystem;
  packageHash: string;
}

interface ValidatedRead {
  id: string;
  path: string;
}

const BOOTSTRAP_FILES = [
  "SKILL.md",
  "references/theme-index.md"
] as const;
const MAX_TOOL_ROUNDS = 8;

function invalidToolResponse(): AiError {
  return new AiError("invalid_response");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export class SkillSession {
  readonly #client: ChatClient;
  readonly #target: Pick<ChatRequest, "baseUrl" | "model">;
  readonly #skillId: string;
  readonly #skillVersion: string;
  readonly #vfs: SkillVirtualFileSystem;
  readonly #packageHash: string;
  readonly #messages: ChatRequest["messages"] = [];
  readonly #requiredFiles = new Set<string>();
  readonly #loadedFiles = new Set<string>();
  readonly #auditFiles: string[] = [];
  readonly #seenToolCallIds = new Set<string>();
  readonly #capabilities: ProviderCapabilities;
  #usedToolCalls = false;
  #usedInjection = false;

  constructor(options: SkillSessionOptions) {
    this.#client = options.client;
    this.#target = { ...options.target };
    this.#skillId = options.skillPackage.id;
    this.#skillVersion = options.skillPackage.version;
    this.#vfs = options.vfs;
    this.#packageHash = options.packageHash;
    this.#capabilities = { ...options.capabilities };
  }

  async bootstrap(signal: AbortSignal): Promise<void> {
    await this.ensureFiles(BOOTSTRAP_FILES, signal);
  }

  async ensureFiles(
    paths: readonly string[],
    signal: AbortSignal
  ): Promise<void> {
    this.#throwIfAborted(signal);
    const required = this.#validateRequiredPaths(paths);
    for (const path of required) {
      this.#requiredFiles.add(path);
    }

    let missing = required.filter((path) => !this.#loadedFiles.has(path));
    if (missing.length === 0) {
      return;
    }
    if (!this.#capabilities.tools) {
      this.#injectFiles(missing);
      return;
    }

    let ignoredRounds = 0;
    let toolRounds = 0;
    while (true) {
      missing = required.filter((path) => !this.#loadedFiles.has(path));
      if (missing.length > 0) {
        this.#messages.push({
          role: "system",
          content:
            "Before replying, call read_skill_file once for every missing required Skill path: " +
            JSON.stringify(missing)
        });
      }

      let result: ChatTurnResult;
      try {
        result = await this.#request(true, signal);
      } catch (error) {
        if (!this.#isToolsUnsupported(error)) {
          throw error;
        }
        this.#capabilities.tools = false;
        this.#injectFiles(required, true);
        const retry = await this.#request(false, signal);
        this.#appendAssistant(retry);
        this.#acceptFinalContent(retry);
        return;
      }

      this.#appendAssistant(result);
      if (result.toolCalls.length === 0) {
        this.#acceptFinalContent(result);
        if (missing.length === 0) {
          return;
        }
        ignoredRounds += 1;
        if (ignoredRounds >= 2) {
          this.#injectFiles(
            required.filter((path) => !this.#loadedFiles.has(path))
          );
          return;
        }
        continue;
      }

      toolRounds += 1;
      if (toolRounds > MAX_TOOL_ROUNDS) {
        throw new AiError("tool_round_limit");
      }
      const missingBeforeRound = new Set(missing);
      const reads = this.#processToolCalls(result.toolCalls);
      if (reads.some((read) => missingBeforeRound.has(read.path))) {
        ignoredRounds = 0;
      } else if (missing.length > 0) {
        ignoredRounds += 1;
        if (ignoredRounds >= 2) {
          this.#injectFiles(
            required.filter((path) => !this.#loadedFiles.has(path))
          );
          return;
        }
      }
    }
  }

  async complete(prompt: string, signal: AbortSignal): Promise<string> {
    await this.bootstrap(signal);
    await this.ensureFiles([...this.#requiredFiles], signal);
    this.#throwIfAborted(signal);
    this.#messages.push({ role: "user", content: prompt });

    if (!this.#capabilities.tools) {
      const result = await this.#request(false, signal);
      this.#appendAssistant(result);
      return this.#acceptFinalContent(result);
    }

    let toolRounds = 0;
    while (true) {
      let result: ChatTurnResult;
      try {
        result = await this.#request(true, signal);
      } catch (error) {
        if (!this.#isToolsUnsupported(error)) {
          throw error;
        }
        this.#capabilities.tools = false;
        this.#injectFiles([...this.#requiredFiles], true);
        const retry = await this.#request(false, signal);
        this.#appendAssistant(retry);
        return this.#acceptFinalContent(retry);
      }

      this.#appendAssistant(result);
      if (result.toolCalls.length === 0) {
        return this.#acceptFinalContent(result);
      }

      toolRounds += 1;
      if (toolRounds > MAX_TOOL_ROUNDS) {
        throw new AiError("tool_round_limit");
      }
      this.#processToolCalls(result.toolCalls);
    }
  }

  audit(): SkillLoadAudit {
    return {
      skillId: this.#skillId,
      skillVersion: this.#skillVersion,
      packageHash: this.#packageHash,
      loadMode: this.#loadMode(),
      files: [...this.#auditFiles]
    };
  }

  #validateRequiredPaths(paths: readonly string[]): string[] {
    const unique = new Set<string>();
    for (const path of paths) {
      let normalized: string;
      try {
        normalized = normalizeSkillPath(path);
      } catch {
        throw invalidToolResponse();
      }
      if (normalized !== path || !this.#vfs.has(normalized)) {
        throw invalidToolResponse();
      }
      unique.add(normalized);
    }
    return [...unique];
  }

  #processToolCalls(toolCalls: readonly ChatToolCall[]): ValidatedRead[] {
    const validated = this.#validateToolCalls(toolCalls);
    const contents = validated.map((read) => this.#vfs.read(read.path));
    for (const read of validated) {
      this.#seenToolCallIds.add(read.id);
    }
    validated.forEach((read, index) => {
      const content = contents[index];
      if (content === undefined) {
        throw invalidToolResponse();
      }
      this.#messages.push({
        role: "tool",
        toolCallId: read.id,
        content
      });
      this.#recordLoad(read.path, "tool-calls");
    });
    return validated;
  }

  #validateToolCalls(toolCalls: readonly ChatToolCall[]): ValidatedRead[] {
    const ids = new Set<string>();
    return toolCalls.map((call) => {
      if (
        typeof call.id !== "string" ||
        call.id.length === 0 ||
        ids.has(call.id) ||
        this.#seenToolCallIds.has(call.id) ||
        call.name !== READ_SKILL_FILE_TOOL.name ||
        typeof call.argumentsJson !== "string"
      ) {
        throw invalidToolResponse();
      }
      ids.add(call.id);

      let parsed: unknown;
      try {
        parsed = JSON.parse(call.argumentsJson) as unknown;
      } catch {
        throw invalidToolResponse();
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw invalidToolResponse();
      }
      const keys = Object.keys(parsed);
      if (keys.length !== 1 || keys[0] !== "path") {
        throw invalidToolResponse();
      }
      const path = (parsed as { path?: unknown }).path;
      if (typeof path !== "string") {
        throw invalidToolResponse();
      }

      let normalized: string;
      try {
        normalized = normalizeSkillPath(path);
      } catch {
        throw invalidToolResponse();
      }
      if (normalized !== path || !this.#vfs.has(normalized)) {
        throw invalidToolResponse();
      }
      return { id: call.id, path: normalized };
    });
  }

  #acceptFinalContent(result: ChatTurnResult): string {
    if (
      result.toolCalls.length > 0 ||
      result.finishReason === "tool_calls"
    ) {
      throw invalidToolResponse();
    }
    return result.content;
  }

  #injectFiles(paths: readonly string[], includeLoaded = false): void {
    for (const path of paths) {
      if (!includeLoaded && this.#loadedFiles.has(path)) {
        continue;
      }
      const content = this.#vfs.read(path);
      this.#messages.push({
        role: "system",
        content: `<skill-file path="${escapeAttribute(path)}">\n${content}\n</skill-file>`
      });
      this.#recordLoad(path, "injected");
    }
  }

  #recordLoad(path: string, mode: Exclude<SkillLoadMode, "mixed">): void {
    if (mode === "tool-calls") {
      this.#usedToolCalls = true;
    } else {
      this.#usedInjection = true;
    }
    if (!this.#loadedFiles.has(path)) {
      this.#loadedFiles.add(path);
      this.#auditFiles.push(path);
    }
  }

  #loadMode(): SkillLoadMode {
    if (this.#usedToolCalls && this.#usedInjection) {
      return "mixed";
    }
    return this.#usedInjection ? "injected" : "tool-calls";
  }

  async #request(
    withTools: boolean,
    signal: AbortSignal
  ): Promise<ChatTurnResult> {
    this.#throwIfAborted(signal);
    const request: ChatRequest = {
      ...this.#target,
      messages: this.#messages,
      ...(withTools ? { tools: [READ_SKILL_FILE_TOOL] } : {})
    };
    return this.#client.complete(request, signal);
  }

  #appendAssistant(result: ChatTurnResult): void {
    this.#messages.push({
      role: "assistant",
      content: result.content,
      ...(result.toolCalls.length === 0
        ? {}
        : { toolCalls: result.toolCalls.map((call) => ({ ...call })) })
    });
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AiError("aborted");
    }
  }

  #isToolsUnsupported(error: unknown): error is AiError {
    return error instanceof AiError && error.code === "tools_unsupported";
  }
}
