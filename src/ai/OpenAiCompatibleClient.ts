import { AiError, type AiErrorCode } from "./AiError";
import type {
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  ChatTurnResult,
  HttpTransport
} from "./AiProtocol";
import { validateBaseUrl } from "./BaseUrlPolicy";
import { redactDiagnostic } from "./Redactor";
import { SseDecoder } from "./SseDecoder";
import type { SecretStore } from "../secrets/SecretStore";
import type { GalleySettings } from "../settings/GalleySettings";

const RETRY_DELAYS = [500, 1_000] as const;
const DEFAULT_TIMEOUT_MS = 120_000;

export type RetryDelay = (
  milliseconds: number,
  signal: AbortSignal
) => Promise<void>;

export interface OpenAiCompatibleClientOptions {
  timeoutMs?: number;
  delay?: RetryDelay;
}

interface OpenAiToolAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
}

export class OpenAiCompatibleClient {
  private readonly timeoutMs: number;
  private readonly delay: RetryDelay;

  constructor(
    private readonly transport: HttpTransport,
    private readonly getSecret: () => string | null,
    options: OpenAiCompatibleClientOptions = {}
  ) {
    this.timeoutMs =
      typeof options.timeoutMs === "number" &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.delay = options.delay ?? abortableDelay;
  }

  static fromSettings(
    transport: HttpTransport,
    settings: GalleySettings,
    secrets: SecretStore,
    options: OpenAiCompatibleClientOptions = {}
  ): OpenAiCompatibleClient {
    return new OpenAiCompatibleClient(
      transport,
      () => secrets.get(settings.secretId),
      { ...options, timeoutMs: settings.timeoutMs }
    );
  }

  async complete(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatTurnResult> {
    if (signal.aborted) {
      throw new AiError("aborted");
    }

    let baseUrl: string;
    try {
      baseUrl = validateBaseUrl(request.baseUrl);
    } catch {
      throw new AiError("invalid_base_url");
    }

    let secret: string | null;
    try {
      secret = this.getSecret();
    } catch {
      throw new AiError("missing_secret");
    }
    if (!secret) {
      throw new AiError("missing_secret");
    }

    const url = `${baseUrl}/chat/completions`;
    const headers = {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    };
    const useStream = request.stream === true && this.transport.stream !== undefined;
    const body = mapRequest(request, useStream);

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        return await this.runWithTimeout(signal, async (attemptSignal) => {
          if (useStream) {
            return this.readStream(url, headers, body, attemptSignal);
          }
          const response = await this.transport.post(
            url,
            headers,
            body,
            attemptSignal
          );
          if (response.status < 200 || response.status >= 300) {
            throw httpError(response.status, response.json, request, secret);
          }
          return normalizeResponse(response.json, secret);
        });
      } catch (error) {
        const failure = normalizeFailure(error, signal, secret);
        if (!failure.retryable || attempt === RETRY_DELAYS.length) {
          throw failure;
        }

        try {
          await this.delay(RETRY_DELAYS[attempt] as number, signal);
        } catch {
          throw new AiError("aborted");
        }
        if (signal.aborted) {
          throw new AiError("aborted");
        }
      }
    }

    throw new AiError("network_error", { retryable: true });
  }

  private async readStream(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal
  ): Promise<ChatTurnResult> {
    const stream = this.transport.stream;
    if (!stream) {
      throw new AiError("invalid_response");
    }

    const decoder = new SseDecoder();
    let content = "";
    let finishReason: string | null = null;
    let sawChoice = false;
    const toolCalls = new Map<number, OpenAiToolAccumulator>();

    const consume = (events: unknown[]): void => {
      for (const event of events) {
        const choice = firstChoice(event);
        if (!choice) {
          continue;
        }
        sawChoice = true;
        const delta = asRecord(choice.delta);
        if (delta && typeof delta.content === "string") {
          content += delta.content;
        }
        if (delta && Array.isArray(delta.tool_calls)) {
          accumulateToolCalls(delta.tool_calls, toolCalls);
        }
        if (typeof choice.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }
      }
    };

    try {
      for await (const chunk of stream(url, headers, body, signal)) {
        consume(decoder.push(chunk));
      }
      consume(decoder.finish());
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid SSE data")) {
        throw new AiError("invalid_response");
      }
      throw error;
    }

    if (!sawChoice) {
      throw new AiError("invalid_response");
    }

    const normalizedTools = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => {
        if (!toolCall.id || !toolCall.name) {
          throw new AiError("invalid_response");
        }
        return toolCall;
      });

    return { content, toolCalls: normalizedTools, finishReason };
  }

  private async runWithTimeout<T>(
    callerSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (callerSignal.aborted) {
      throw new AiError("aborted");
    }

    const attemptController = new AbortController();
    let rejectCancellation: (reason: AiError) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const forwardAbort = (): void => {
      attemptController.abort();
      rejectCancellation(new AiError("aborted"));
    };
    callerSignal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      attemptController.abort();
      rejectCancellation(new AiError("timeout", { retryable: true }));
    }, this.timeoutMs);

    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(attemptController.signal)),
        cancellation
      ]);
    } finally {
      clearTimeout(timeout);
      callerSignal.removeEventListener("abort", forwardAbort);
    }
  }
}

function mapRequest(request: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(mapMessage),
    stream
  };
  if (request.tools !== undefined) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  return body;
}

function mapMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId
    };
  }

  const mapped: Record<string, unknown> = {
    role: message.role,
    content: message.content
  };
  if (message.role === "assistant" && message.toolCalls !== undefined) {
    mapped.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.argumentsJson
      }
    }));
  }
  return mapped;
}

function normalizeResponse(json: unknown, secret: string): ChatTurnResult {
  const choice = firstChoice(json);
  const message = choice ? asRecord(choice.message) : null;
  if (!choice || !message) {
    throw new AiError("invalid_response", {
      diagnostic: redactDiagnostic(json, [secret])
    });
  }

  const content = message.content === null ? "" : message.content;
  if (typeof content !== "string") {
    throw new AiError("invalid_response", {
      diagnostic: redactDiagnostic(json, [secret])
    });
  }

  const toolCalls = normalizeToolCalls(message.tool_calls, json, secret);
  return {
    content,
    toolCalls,
    finishReason:
      typeof choice.finish_reason === "string" ? choice.finish_reason : null
  };
}

function normalizeToolCalls(
  value: unknown,
  response: unknown,
  secret: string
): ChatToolCall[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AiError("invalid_response", {
      diagnostic: redactDiagnostic(response, [secret])
    });
  }

  return value.map((item) => {
    const call = asRecord(item);
    const functionCall = call ? asRecord(call.function) : null;
    if (
      !call ||
      call.type !== "function" ||
      typeof call.id !== "string" ||
      !functionCall ||
      typeof functionCall.name !== "string" ||
      typeof functionCall.arguments !== "string"
    ) {
      throw new AiError("invalid_response", {
        diagnostic: redactDiagnostic(response, [secret])
      });
    }
    return {
      id: call.id,
      name: functionCall.name,
      argumentsJson: functionCall.arguments
    };
  });
}

function firstChoice(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.choices) || record.choices.length === 0) {
    return null;
  }
  return asRecord(record.choices[0]);
}

function accumulateToolCalls(
  values: unknown[],
  target: Map<number, OpenAiToolAccumulator>
): void {
  for (const value of values) {
    const chunk = asRecord(value);
    if (!chunk || typeof chunk.index !== "number") {
      throw new AiError("invalid_response");
    }
    const current = target.get(chunk.index) ?? {
      id: "",
      name: "",
      argumentsJson: ""
    };
    const functionChunk = asRecord(chunk.function);
    if (typeof chunk.id === "string") {
      current.id += chunk.id;
    }
    if (functionChunk && typeof functionChunk.name === "string") {
      current.name += functionChunk.name;
    }
    if (functionChunk && typeof functionChunk.arguments === "string") {
      current.argumentsJson += functionChunk.arguments;
    }
    target.set(chunk.index, current);
  }
}

function httpError(
  status: number,
  json: unknown,
  request: ChatRequest,
  secret: string
): AiError {
  const retryable = status === 429 || status >= 500;
  const code: AiErrorCode = isToolsUnsupported(status, json, request)
    ? "tools_unsupported"
    : "http_error";
  return new AiError(code, {
    status,
    retryable,
    diagnostic: redactDiagnostic(json, [secret])
  });
}

function isToolsUnsupported(
  status: number,
  json: unknown,
  request: ChatRequest
): boolean {
  if (!request.tools?.length || status < 400 || status >= 500) {
    return false;
  }
  const redacted = JSON.stringify(redactDiagnostic(json, []));
  return /(?:tool|function).{0,40}(?:unsupported|not supported|unknown|invalid)/i.test(
    redacted
  );
}

function normalizeFailure(
  error: unknown,
  callerSignal: AbortSignal,
  secret: string
): AiError {
  if (callerSignal.aborted || isAbortError(error)) {
    return new AiError("aborted");
  }
  if (error instanceof AiError) {
    return new AiError(error.code, {
      ...(error.status === null ? {} : { status: error.status }),
      retryable: error.retryable,
      diagnostic: redactDiagnostic(error.diagnostic, [secret])
    });
  }
  return new AiError("network_error", {
    retryable: true,
    diagnostic: redactDiagnostic(error, [secret])
  });
}

function isAbortError(error: unknown): boolean {
  const record = asRecord(error);
  return record?.name === "AbortError";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AiError("aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new AiError("aborted"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
