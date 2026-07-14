export type ChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | { role: "tool"; content: string; toolCallId: string };

export interface ChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  stream?: boolean;
}

export interface ChatTurnResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  streamed?: boolean;
}

export interface ChatClient {
  complete(
    request: ChatRequest,
    signal: AbortSignal
  ): Promise<ChatTurnResult>;
}

export interface HttpTransport {
  post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal
  ): Promise<{ status: number; json: unknown }>;
  stream?(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    signal: AbortSignal
  ): AsyncIterable<string>;
}
