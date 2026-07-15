import { AiError } from "../ai/AiError";
import type {
  ChatClient,
  ChatRequest,
  ChatTool,
  ChatToolCall,
  ChatTurnResult,
  ChatUserContent
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
  readonly #loadMessages: ChatRequest["messages"] = [];
  readonly #baselineFiles = new Set<string>();
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
        this.#appendLoadMessage({
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

      this.#appendAssistant(result, [this.#messages, this.#loadMessages]);
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
      const reads = this.#processToolCalls(result.toolCalls, [
        this.#messages,
        this.#loadMessages
      ]);
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
      const reads = this.#processToolCalls(result.toolCalls);
      this.#persistReads(reads);
    }
  }

  async completeScoped(prompt: string, signal: AbortSignal): Promise<string> {
    return this.#completeScopedContent(prompt, signal);
  }

  async completeScopedWithImage(
    prompt: string,
    imageDataUrl: string,
    signal: AbortSignal
  ): Promise<string> {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/iu.test(imageDataUrl)) {
      throw invalidToolResponse();
    }
    return this.#completeScopedContent(
      [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } }
      ],
      signal
    );
  }

  async #completeScopedContent(
    content: ChatUserContent,
    signal: AbortSignal
  ): Promise<string> {
    await this.bootstrap(signal);
    await this.ensureFiles([...this.#requiredFiles], signal);
    this.#throwIfAborted(signal);

    let messages = this.#cloneMessages(this.#loadMessages);
    messages.push({ role: "user", content });
    const seenToolCallIds = this.#toolCallIds(messages);
    if (!this.#capabilities.tools) {
      const result = await this.#request(false, signal, messages);
      this.#appendAssistant(result, [messages]);
      return this.#acceptFinalContent(result);
    }

    let toolRounds = 0;
    while (true) {
      let result: ChatTurnResult;
      try {
        result = await this.#request(true, signal, messages);
      } catch (error) {
        if (!this.#isToolsUnsupported(error)) {
          throw error;
        }
        this.#capabilities.tools = false;
        this.#injectFiles([...this.#requiredFiles], true);
        messages = this.#cloneMessages(this.#loadMessages);
        messages.push({ role: "user", content });
        const retry = await this.#request(false, signal, messages);
        this.#appendAssistant(retry, [messages]);
        return this.#acceptFinalContent(retry);
      }

      this.#appendAssistant(result, [messages]);
      if (result.toolCalls.length === 0) {
        return this.#acceptFinalContent(result);
      }

      toolRounds += 1;
      if (toolRounds > MAX_TOOL_ROUNDS) {
        throw new AiError("tool_round_limit");
      }
      const reads = this.#processToolCalls(
        result.toolCalls,
        [messages],
        seenToolCallIds
      );
      this.#persistReads(reads, [this.#messages, this.#loadMessages]);
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

  #processToolCalls(
    toolCalls: readonly ChatToolCall[],
    targets: readonly ChatRequest["messages"][] = [this.#messages],
    seenToolCallIds: Set<string> = this.#seenToolCallIds
  ): ValidatedRead[] {
    const validated = this.#validateToolCalls(toolCalls, seenToolCallIds);
    const contents = validated.map((read) => this.#vfs.read(read.path));
    for (const read of validated) {
      seenToolCallIds.add(read.id);
    }
    validated.forEach((read, index) => {
      const content = contents[index];
      if (content === undefined) {
        throw invalidToolResponse();
      }
      for (const target of targets) {
        target.push({
          role: "tool",
          toolCallId: read.id,
          content
        });
      }
      this.#recordLoad(read.path, "tool-calls");
      if (targets.includes(this.#loadMessages)) {
        this.#baselineFiles.add(read.path);
      }
    });
    return validated;
  }

  #validateToolCalls(
    toolCalls: readonly ChatToolCall[],
    seenToolCallIds: ReadonlySet<string>
  ): ValidatedRead[] {
    const ids = new Set<string>();
    return toolCalls.map((call) => {
      if (
        typeof call.id !== "string" ||
        call.id.length === 0 ||
        ids.has(call.id) ||
        seenToolCallIds.has(call.id) ||
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
      const message = {
        role: "system",
        content: `<skill-file path="${escapeAttribute(path)}">\n${content}\n</skill-file>`
      } as const;
      this.#messages.push(message);
      this.#loadMessages.push({ ...message });
      this.#recordLoad(path, "injected");
      this.#baselineFiles.add(path);
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
    signal: AbortSignal,
    messages: ChatRequest["messages"] = this.#messages
  ): Promise<ChatTurnResult> {
    this.#throwIfAborted(signal);
    const request: ChatRequest = {
      ...this.#target,
      messages,
      ...(withTools ? { tools: [READ_SKILL_FILE_TOOL] } : {})
    };
    return this.#client.complete(request, signal);
  }

  #appendAssistant(
    result: ChatTurnResult,
    targets: readonly ChatRequest["messages"][] = [this.#messages]
  ): void {
    for (const target of targets) {
      target.push({
        role: "assistant",
        content: result.content,
        ...(result.toolCalls.length === 0
          ? {}
          : { toolCalls: result.toolCalls.map((call) => ({ ...call })) })
      });
    }
  }

  #appendLoadMessage(message: ChatRequest["messages"][number]): void {
    this.#messages.push(message);
    const clone = this.#cloneMessages([message])[0];
    if (clone) this.#loadMessages.push(clone);
  }

  #persistReads(
    reads: readonly ValidatedRead[],
    targets: readonly ChatRequest["messages"][] = [this.#loadMessages]
  ): void {
    for (const { path } of reads) {
      if (this.#baselineFiles.has(path)) {
        continue;
      }
      const content = this.#vfs.read(path);
      for (const target of targets) {
        target.push({
          role: "system",
          content: `<skill-file path="${escapeAttribute(path)}">\n${content}\n</skill-file>`
        });
      }
      this.#baselineFiles.add(path);
    }
  }

  #toolCallIds(messages: ChatRequest["messages"]): Set<string> {
    const ids = new Set<string>();
    for (const message of messages) {
      if (message.role === "tool") {
        ids.add(message.toolCallId);
      } else if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          ids.add(call.id);
        }
      }
    }
    return ids;
  }

  #cloneMessages(
    messages: ChatRequest["messages"]
  ): ChatRequest["messages"] {
    return messages.map((message) =>
      message.role === "tool"
        ? { ...message }
        : message.role === "user"
          ? {
              ...message,
              content:
                typeof message.content === "string"
                  ? message.content
                  : message.content.map((part) =>
                      part.type === "text"
                        ? { ...part }
                        : { ...part, image_url: { ...part.image_url } }
                    ) as unknown as ChatUserContent
            }
        : {
            ...message,
            ...(message.toolCalls === undefined
              ? {}
              : {
                  toolCalls: message.toolCalls.map((call) => ({ ...call }))
                })
          }
    );
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
