import { AiError } from "./AiError";
import type {
  ChatClient,
  ChatRequest,
  ChatTurnResult
} from "./AiProtocol";

export interface ProviderCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  checkedAt: string;
}

export interface CapabilityProbeOptions {
  streaming?: boolean;
  vision?: boolean;
}

export type CapabilityProbeTarget = Pick<ChatRequest, "baseUrl" | "model">;

const ECHO_TOOL = {
  name: "galley_capability_echo",
  description: "Return an empty object to confirm tool-call support.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};

export class CapabilityProbe {
  constructor(
    private readonly client: ChatClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  async probe(
    target: CapabilityProbeTarget,
    signal: AbortSignal,
    options: CapabilityProbeOptions = {}
  ): Promise<ProviderCapabilities> {
    const tools = await this.probeOne(
      {
        ...target,
        messages: [
          {
            role: "user",
            content:
              "Call galley_capability_echo exactly once with an empty object."
          }
        ],
        tools: [ECHO_TOOL]
      },
      signal,
      isValidEcho
    );

    const streaming = options.streaming
      ? await this.probeOne(
          {
            ...target,
            messages: [
              {
                role: "user",
                content: "Reply with the single word galley_stream_probe."
              }
            ],
            stream: true
          },
          signal,
          (result) => result.streamed === true
        )
      : false;

    const vision = false;

    return {
      tools,
      streaming,
      vision,
      checkedAt: this.now().toISOString()
    };
  }

  private async probeOne(
    request: ChatRequest,
    signal: AbortSignal,
    validate: (result: ChatTurnResult) => boolean = () => true
  ): Promise<boolean> {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const result = await this.client.complete(request, signal);
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return validate(result);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw error;
      }
      return false;
    }
  }
}

function isValidEcho(result: ChatTurnResult): boolean {
  return result.toolCalls.some((call) => {
    if (call.name !== ECHO_TOOL.name) {
      return false;
    }
    try {
      const value = JSON.parse(call.argumentsJson) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value);
    } catch {
      return false;
    }
  });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof AiError) {
    return error.code === "aborted";
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
