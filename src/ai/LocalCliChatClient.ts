import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

import { AiError } from "./AiError";
import type {
  ChatClient,
  ChatMessage,
  ChatRequest,
  ChatTurnResult
} from "./AiProtocol";
import type { GenerationAgent } from "../settings/GalleySettings";
import type { GenerationModelEvent } from "../generation/GenerationProgress";

export type LocalCliAgent = Exclude<GenerationAgent, "plugin">;

export interface LocalCliChatClientOptions {
  readonly agent: LocalCliAgent;
  readonly executable: string;
  readonly cwd?: string;
  readonly skillPath?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly spawnProcess?: typeof spawn;
  readonly onModelEvent?: (event: GenerationModelEvent) => void;
}

const DEFAULT_MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

/**
 * Adapts the authenticated local Codex or Claude Code CLI to Galley's chat
 * boundary. The bundled Skill is materialized outside the vault so the CLI can
 * use it exactly like a normal local Skill without creating article-side files.
 */
export class LocalCliChatClient implements ChatClient {
  readonly #options: LocalCliChatClientOptions;
  #requestSequence = 0;

  constructor(options: LocalCliChatClientOptions) {
    this.#options = options;
  }

  async complete(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatTurnResult> {
    if (request.tools?.length) throw new AiError("tools_unsupported");
    const requestId = ++this.#requestSequence;
    const content = await this.#run(
      localCliArguments(this.#options.agent, this.#options.cwd),
      serializeConversation(request.messages, this.#options.skillPath),
      signal,
      requestId
    );
    if (!content.trim()) throw new AiError("invalid_response");
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      streamed: false
    };
  }

  async checkAvailable(signal: AbortSignal): Promise<string> {
    return (await this.#run(["--version"], "", signal)).trim();
  }

  /** Runs one real model turn without loading a Skill. */
  async checkModelAvailable(signal: AbortSignal): Promise<string> {
    const content = await this.#run(
      localCliArguments(this.#options.agent, this.#options.cwd),
      "Reply with exactly OK.",
      signal,
      ++this.#requestSequence
    );
    if (!content.trim()) throw new AiError("invalid_response");
    return content.trim();
  }

  #run(
    args: readonly string[],
    stdin: string,
    signal: AbortSignal,
    requestId?: number
  ): Promise<string> {
    if (signal.aborted) return Promise.reject(new AiError("aborted"));
    const spawnProcess = this.#options.spawnProcess ?? spawn;
    const maxOutputBytes = this.#options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const environment = localCliEnvironment(process.env);
    const executable = resolveLocalCliExecutable(
      this.#options.agent,
      this.#options.executable,
      environment
    );
    const startedAt = Date.now();
    if (requestId !== undefined) {
      this.#options.onModelEvent?.({
        type: "request-start",
        requestId,
        at: startedAt
      });
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stdoutBytes = 0;
      let stderr = "";
      let timedOut = false;
      let child: ChildProcessWithoutNullStreams;
      const parser = requestId === undefined
        ? null
        : new LocalCliStructuredOutputParser(this.#options.agent, (text) => {
            this.#options.onModelEvent?.({
              type: "text-delta",
              requestId,
              text,
              at: Date.now()
            });
          });
      try {
        child = spawnProcess(executable, [...args], {
          cwd: this.#options.cwd,
          env: environment,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch {
        reject(new AiError("network_error"));
        return;
      }

      const finish = (error?: AiError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(stdout);
      };
      const terminate = (): void => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 1_500).unref?.();
      };
      const abort = (): void => {
        terminate();
        finish(new AiError("aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
        finish(new AiError("timeout"));
      }, this.#options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > maxOutputBytes) {
          terminate();
          finish(new AiError("invalid_response"));
          return;
        }
        if (parser) parser.push(chunk);
        else stdout += chunk;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 8_192) stderr += chunk.slice(0, 8_192 - stderr.length);
      });
      child.on("error", (error) => finish(cliSpawnError(error)));
      child.on("close", (code) => {
        if (settled || timedOut) return;
        if (code !== 0) {
          finish(new AiError("cli_failed", {
            diagnostic: { agent: this.#options.agent, exitCode: code, stderr: stderr.trim() }
          }));
          return;
        }
        if (parser) stdout = parser.finish();
        if (requestId !== undefined) {
          this.#options.onModelEvent?.({
            type: "request-complete",
            requestId,
            elapsedMs: Date.now() - startedAt,
            at: Date.now()
          });
        }
        finish();
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    });
  }
}

export function serializeConversation(
  messages: readonly ChatMessage[],
  skillPath?: string
): string {
  const normalized = messages.map((message) => {
    if (message.role === "user" && typeof message.content !== "string") {
      throw new AiError("invalid_response");
    }
    if (message.role === "tool") {
      return { role: message.role, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
  return [
    "Act as the user's local coding Agent.",
    ...(skillPath
      ? [`Read ${JSON.stringify(skillPath)} completely and follow that gzh-design Skill for the request below.`]
      : ["Use the gzh-design Skill for the request below."]),
    "Treat the JSON conversation below as the complete conversation and continue it as the assistant.",
    "Return only the final content requested by the last user message. Do not create article files yourself; Galley will save the one final HTML response.",
    JSON.stringify(normalized)
  ].join("\n\n");
}

export function localCliArguments(
  agent: LocalCliAgent,
  cwd: string | undefined
): string[] {
  if (agent === "codex-cli") {
    return [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--json",
      ...(cwd ? ["--cd", cwd] : []),
      "-"
    ];
  }
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "plan",
    "--tools",
    "Read,Glob"
  ];
}

export class LocalCliStructuredOutputParser {
  readonly #agent: LocalCliAgent;
  readonly #onText: (text: string) => void;
  #buffer = "";
  #output = "";
  #fallback = "";

  constructor(agent: LocalCliAgent, onText: (text: string) => void) {
    this.#agent = agent;
    this.#onText = onText;
  }

  push(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/u);
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#consume(line);
  }

  finish(): string {
    if (this.#buffer.trim()) this.#consume(this.#buffer);
    this.#buffer = "";
    if (!this.#output && this.#fallback) this.#append(this.#fallback);
    return this.#output;
  }

  #consume(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    if (this.#agent === "codex-cli") {
      const item = asRecord(record.item);
      if (
        record.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        this.#append(item.text);
      }
      return;
    }
    const event = asRecord(record.event);
    const delta = asRecord(event?.delta);
    if (
      record.type === "stream_event" &&
      event?.type === "content_block_delta" &&
      delta?.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      this.#append(delta.text);
    } else if (record.type === "result" && typeof record.result === "string") {
      this.#fallback = record.result;
    }
  }

  #append(text: string): void {
    if (!text) return;
    this.#output += text;
    this.#onText(text);
  }
}

export function localCliEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>
): NodeJS.ProcessEnv {
  const home = environment.HOME?.trim();
  const candidates = [
    environment.PATH,
    "/usr/local/bin",
    "/opt/homebrew/bin",
    ...(home
      ? [
          `${home}/.local/bin`,
          `${home}/.npm-global/bin`,
          `${home}/.volta/bin`
        ]
      : [])
  ];
  const entries = candidates
    .flatMap((value) => value?.split(delimiter) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    ...environment,
    PATH: [...new Set(entries)].join(delimiter)
  };
}

export function resolveLocalCliExecutable(
  agent: LocalCliAgent,
  configured: string,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  canExecute: (path: string) => boolean = isExecutableFile
): string {
  const fallback = agent === "codex-cli" ? "codex" : "claude";
  for (const candidate of localCliApplicationCandidates(
    agent,
    environment.HOME?.trim()
  )) {
    if (canExecute(candidate)) return candidate;
  }

  const commands = [...new Set([configured.trim(), fallback].filter(Boolean))];
  const searchPaths = localCliEnvironment(environment).PATH?.split(delimiter) ?? [];

  for (const command of commands) {
    if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
      if (canExecute(command)) return command;
      continue;
    }
    for (const directory of searchPaths) {
      const candidate = join(directory, command);
      if (canExecute(candidate)) return candidate;
    }
  }
  return fallback;
}

export function localCliApplicationCandidates(
  agent: LocalCliAgent,
  home: string | undefined
): string[] {
  if (agent !== "codex-cli") return [];
  const relativePath = "Contents/Resources/codex";
  return [
    `/Applications/ChatGPT.app/${relativePath}`,
    `/Applications/Codex.app/${relativePath}`,
    ...(home
      ? [
          `${home}/Applications/ChatGPT.app/${relativePath}`,
          `${home}/Applications/Codex.app/${relativePath}`
        ]
      : [])
  ];
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function cliSpawnError(error: Error): AiError {
  return new AiError(
    "code" in error && error.code === "ENOENT"
      ? "cli_not_found"
      : "network_error"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
