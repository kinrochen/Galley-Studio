export type AiErrorCode =
  | "aborted"
  | "cli_failed"
  | "cli_not_found"
  | "http_error"
  | "invalid_base_url"
  | "invalid_response"
  | "missing_secret"
  | "network_error"
  | "timeout"
  | "tools_unsupported"
  | "tool_round_limit";

export interface AiErrorOptions {
  status?: number;
  retryable?: boolean;
  diagnostic?: unknown;
}

const MESSAGES: Readonly<Record<AiErrorCode, string>> = {
  aborted: "The AI request was cancelled.",
  cli_failed: "The local generation CLI exited with an error.",
  cli_not_found: "The local generation CLI executable was not found.",
  http_error: "The AI provider rejected the request.",
  invalid_base_url: "Invalid provider Base URL.",
  invalid_response: "The AI provider returned an invalid response.",
  missing_secret: "No provider secret is configured.",
  network_error: "The AI provider could not be reached.",
  timeout: "The AI request timed out.",
  tools_unsupported: "The AI provider does not support tool calls.",
  tool_round_limit: "The AI tool-call round limit was reached."
};

export class AiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly diagnostic: unknown;

  constructor(readonly code: AiErrorCode, options: AiErrorOptions = {}) {
    super(MESSAGES[code]);
    this.name = "AiError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.diagnostic = options.diagnostic ?? null;
  }
}
