import { afterEach, expect, it, vi } from "vitest";
import { AiError } from "../../src/ai/AiError";
import type { HttpTransport } from "../../src/ai/AiProtocol";
import { OpenAiCompatibleClient } from "../../src/ai/OpenAiCompatibleClient";
import { MemorySecretStore } from "../../src/secrets/SecretStore";
import { DEFAULT_SETTINGS } from "../../src/settings/GalleySettings";

const signal = (): AbortSignal => new AbortController().signal;
const success = (content = "ok") => ({
  status: 200,
  json: {
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }
});

afterEach(() => {
  vi.useRealTimers();
});

it("posts Chat Completions messages and normalizes assistant tool calls", async () => {
  const post = vi.fn().mockResolvedValue({
    status: 200,
    json: {
      id: "chatcmpl_1",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "read_skill_file",
                  arguments: '{"path":"SKILL.md"}'
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
  });
  const client = new OpenAiCompatibleClient({ post }, () => "secret");

  const result = await client.complete(
    {
      baseUrl: "https://api.example/v1",
      model: "m",
      messages: [
        { role: "system", content: "system" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "previous", name: "read_skill_file", argumentsJson: "{}" }
          ]
        },
        { role: "tool", content: "contents", toolCallId: "previous" }
      ],
      tools: [
        {
          name: "read_skill_file",
          description: "Read a Skill file",
          parameters: { type: "object" }
        }
      ],
      temperature: 0.4
    },
    signal()
  );

  expect(result).toEqual({
    content: "",
    toolCalls: [
      {
        id: "call_1",
        name: "read_skill_file",
        argumentsJson: '{"path":"SKILL.md"}'
      }
    ],
    finishReason: "tool_calls"
  });
  expect(post).toHaveBeenCalledWith(
    "https://api.example/v1/chat/completions",
    {
      Authorization: "Bearer secret",
      "Content-Type": "application/json"
    },
    {
      model: "m",
      messages: [
        { role: "system", content: "system" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "previous",
              type: "function",
              function: { name: "read_skill_file", arguments: "{}" }
            }
          ]
        },
        { role: "tool", content: "contents", tool_call_id: "previous" }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_skill_file",
            description: "Read a Skill file",
            parameters: { type: "object" }
          }
        }
      ],
      temperature: 0.4,
      stream: false
    },
    expect.any(AbortSignal)
  );
});

it("maps a 401 to a non-retryable secret-safe AiError", async () => {
  const secret = "configured-provider-secret";
  const post = vi.fn().mockResolvedValue({
    status: 401,
    json: {
      error: {
        message: `Invalid credential ${secret}`,
        request: `https://api.example/v1?api_key=${secret}`
      }
    }
  });
  const client = new OpenAiCompatibleClient({ post }, () => secret, {
    delay: vi.fn()
  });

  let thrown: unknown;
  try {
    await client.complete(
      { baseUrl: "https://api.example/v1", model: "m", messages: [] },
      signal()
    );
  } catch (caught) {
    thrown = caught;
  }

  expect(thrown).toBeInstanceOf(AiError);
  expect(thrown).toMatchObject({
    code: "http_error",
    status: 401,
    retryable: false
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(String(thrown)).not.toContain(secret);
  expect(JSON.stringify(thrown)).not.toContain(secret);
});

it("normalizes an unsupported tools response", async () => {
  const post = vi.fn().mockResolvedValue({
    status: 400,
    json: { error: { message: "Tool calling is not supported by this model" } }
  });
  const client = new OpenAiCompatibleClient({ post }, () => "secret");

  await expect(
    client.complete(
      {
        baseUrl: "https://api.example/v1",
        model: "m",
        messages: [],
        tools: [
          { name: "echo", description: "Echo", parameters: { type: "object" } }
        ]
      },
      signal()
    )
  ).rejects.toMatchObject({ code: "tools_unsupported", retryable: false });
});

it("retries 429 twice using the required injected backoff", async () => {
  const post = vi
    .fn()
    .mockResolvedValueOnce({ status: 429, json: { error: { message: "busy" } } })
    .mockResolvedValueOnce({ status: 429, json: { error: { message: "busy" } } })
    .mockResolvedValueOnce(success());
  const delay = vi.fn().mockResolvedValue(undefined);
  const client = new OpenAiCompatibleClient({ post }, () => "secret", { delay });

  await expect(
    client.complete(
      { baseUrl: "https://api.example/v1", model: "m", messages: [] },
      signal()
    )
  ).resolves.toMatchObject({ content: "ok" });

  expect(post).toHaveBeenCalledTimes(3);
  expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
    500, 1_000
  ]);
});

it("retries 5xx twice and then returns the final AiError", async () => {
  const post = vi.fn().mockResolvedValue({
    status: 500,
    json: { error: { message: "upstream failed" } }
  });
  const delay = vi.fn().mockResolvedValue(undefined);
  const client = new OpenAiCompatibleClient({ post }, () => "secret", { delay });

  await expect(
    client.complete(
      { baseUrl: "https://api.example/v1", model: "m", messages: [] },
      signal()
    )
  ).rejects.toMatchObject({ status: 500, retryable: true });

  expect(post).toHaveBeenCalledTimes(3);
  expect(delay).toHaveBeenCalledTimes(2);
});

it("retries network failures twice", async () => {
  const post = vi.fn().mockRejectedValue(new TypeError("connection reset"));
  const delay = vi.fn().mockResolvedValue(undefined);
  const client = new OpenAiCompatibleClient({ post }, () => "secret", { delay });

  await expect(
    client.complete(
      { baseUrl: "https://api.example/v1", model: "m", messages: [] },
      signal()
    )
  ).rejects.toMatchObject({ code: "network_error", retryable: true });

  expect(post).toHaveBeenCalledTimes(3);
  expect(delay).toHaveBeenCalledTimes(2);
});

it("forwards cancellation and never retries an aborted request", async () => {
  const controller = new AbortController();
  const post = vi.fn().mockImplementation(
    (_url: string, _headers: Record<string, string>, _body: unknown, requestSignal: AbortSignal) => {
      controller.abort();
      return Promise.reject(requestSignal.reason ?? new DOMException("Aborted", "AbortError"));
    }
  );
  const delay = vi.fn().mockResolvedValue(undefined);
  const client = new OpenAiCompatibleClient({ post }, () => "secret", { delay });

  await expect(
    client.complete(
      { baseUrl: "https://api.example/v1", model: "m", messages: [] },
      controller.signal
    )
  ).rejects.toMatchObject({ code: "aborted", retryable: false });

  expect(post).toHaveBeenCalledTimes(1);
  expect(delay).not.toHaveBeenCalled();
  expect(post.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
  expect((post.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(true);
});

it("falls back to a non-streaming POST when stream transport is unavailable", async () => {
  const post = vi.fn().mockResolvedValue(success("fallback"));
  const client = new OpenAiCompatibleClient({ post }, () => "secret");

  const result = await client.complete(
    {
      baseUrl: "https://api.example/v1",
      model: "m",
      messages: [],
      stream: true
    },
    signal()
  );

  expect(result.content).toBe("fallback");
  expect(post.mock.calls[0]?.[2]).toMatchObject({ stream: false });
});

it("decodes streamed content and fragmented tool-call arguments", async () => {
  const stream = vi.fn().mockImplementation(async function* () {
    yield 'data: {"choices":[{"delta":{"content":"Hel","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"echo","arguments":"{\\"value\\":"}}]},"finish_reason":null}]}\n\n';
    yield 'data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n';
    yield '\ndata: [DONE]\n\n';
  });
  const post = vi.fn();
  const client = new OpenAiCompatibleClient({ post, stream }, () => "secret");

  const result = await client.complete(
    {
      baseUrl: "https://api.example/v1",
      model: "m",
      messages: [],
      stream: true
    },
    signal()
  );

  expect(result).toEqual({
    content: "Hello",
    toolCalls: [
      { id: "call_1", name: "echo", argumentsJson: '{"value":1}' }
    ],
    finishReason: "tool_calls",
    streamed: true
  });
  expect(post).not.toHaveBeenCalled();
  expect(stream.mock.calls[0]?.[2]).toMatchObject({ stream: true });
});

it("preserves the receiver for a stateful stream transport", async () => {
  class StatefulTransport implements HttpTransport {
    readonly post = vi.fn();
    private readonly frame =
      'data: {"choices":[{"delta":{"content":"stateful"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

    async *stream(): AsyncIterable<string> {
      yield this.frame;
    }
  }

  const transport = new StatefulTransport();
  const client = new OpenAiCompatibleClient(transport, () => "secret", {
    delay: vi.fn().mockResolvedValue(undefined)
  });

  await expect(
    client.complete(
      {
        baseUrl: "https://api.example/v1",
        model: "m",
        messages: [],
        stream: true
      },
      signal()
    )
  ).resolves.toMatchObject({ content: "stateful", streamed: true });
  expect(transport.post).not.toHaveBeenCalled();
});

it("rejects an unsafe Base URL before resolving a secret or sending", async () => {
  const post = vi.fn();
  const getSecret = vi.fn().mockReturnValue("secret");
  const client = new OpenAiCompatibleClient({ post }, getSecret);

  await expect(
    client.complete(
      { baseUrl: "http://api.example/v1", model: "m", messages: [] },
      signal()
    )
  ).rejects.toMatchObject({ code: "invalid_base_url", retryable: false });

  expect(getSecret).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("aborts every timed-out attempt using the configured timeout", async () => {
  vi.useFakeTimers();
  const attemptSignals: AbortSignal[] = [];
  const post: HttpTransport["post"] = vi.fn(
    (_url, _headers, _body, requestSignal) => {
      attemptSignals.push(requestSignal);
      return new Promise<never>((_resolve, reject) => {
        requestSignal.addEventListener(
          "abort",
          () => reject(requestSignal.reason),
          { once: true }
        );
      });
    }
  );
  const client = new OpenAiCompatibleClient({ post }, () => "secret", {
    timeoutMs: 25,
    delay: vi.fn().mockResolvedValue(undefined)
  });

  const completion = client.complete(
    { baseUrl: "https://api.example/v1", model: "m", messages: [] },
    signal()
  );
  const rejection = expect(completion).rejects.toMatchObject({
    code: "timeout",
    retryable: true
  });
  await vi.advanceTimersByTimeAsync(75);

  await rejection;
  expect(post).toHaveBeenCalledTimes(3);
  expect(attemptSignals).toHaveLength(3);
  expect(attemptSignals.every((requestSignal) => requestSignal.aborted)).toBe(true);
});

it("can resolve its secret and timeout from provider settings", async () => {
  const post = vi.fn().mockResolvedValue(success());
  const settings = {
    ...DEFAULT_SETTINGS,
    baseUrl: "https://api.example/v1",
    model: "m",
    secretId: "provider-key",
    timeoutMs: 45_000
  };
  const secrets = new MemorySecretStore(
    new Map([["provider-key", "secret-from-storage"]])
  );
  const client = OpenAiCompatibleClient.fromSettings(
    { post },
    settings,
    secrets
  );

  await client.complete(
    { baseUrl: settings.baseUrl, model: settings.model, messages: [] },
    signal()
  );

  expect(post.mock.calls[0]?.[1]).toMatchObject({
    Authorization: "Bearer secret-from-storage"
  });
});
