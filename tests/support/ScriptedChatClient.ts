import type {
  ChatClient,
  ChatMessage,
  ChatRequest,
  ChatTurnResult
} from "../../src/ai/AiProtocol";

export type ScriptedChatStep =
  | ChatTurnResult
  | Error
  | ((request: ChatRequest) => ChatTurnResult | Promise<ChatTurnResult>);

function cloneMessage(message: ChatMessage): ChatMessage {
  if (message.role === "tool") {
    return { ...message };
  }
  return {
    ...message,
    ...(message.toolCalls === undefined
      ? {}
      : { toolCalls: message.toolCalls.map((call) => ({ ...call })) })
  };
}

function cloneRequest(request: ChatRequest): ChatRequest {
  return {
    ...request,
    messages: request.messages.map(cloneMessage),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            ...tool,
            parameters: structuredClone(tool.parameters)
          }))
        })
  };
}

function cloneResult(result: ChatTurnResult): ChatTurnResult {
  return {
    ...result,
    toolCalls: result.toolCalls.map((call) => ({ ...call }))
  };
}

export class ScriptedChatClient implements ChatClient {
  readonly requests: ChatRequest[] = [];
  readonly #steps: ScriptedChatStep[];

  constructor(steps: readonly ScriptedChatStep[]) {
    this.#steps = [...steps];
  }

  async complete(
    request: ChatRequest,
    _signal: AbortSignal
  ): Promise<ChatTurnResult> {
    this.requests.push(cloneRequest(request));
    const step = this.#steps.shift();
    if (step === undefined) {
      throw new Error("Unexpected ChatClient request after script exhausted");
    }
    if (step instanceof Error) {
      throw step;
    }
    const result =
      typeof step === "function" ? await step(cloneRequest(request)) : step;
    return cloneResult(result);
  }

  requestsWithTools(): ChatRequest[] {
    return this.requests.filter(
      (request) => request.tools !== undefined && request.tools.length > 0
    );
  }

  messagesText(): string {
    return this.requests
      .flatMap((request) => request.messages)
      .map((message) => message.content)
      .join("\n");
  }

  remainingSteps(): number {
    return this.#steps.length;
  }
}
