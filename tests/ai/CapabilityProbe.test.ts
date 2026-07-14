import { expect, it, vi } from "vitest";
import type {
  ChatClient,
  ChatRequest,
  ChatTurnResult
} from "../../src/ai/AiProtocol";
import { CapabilityProbe } from "../../src/ai/CapabilityProbe";

const completed = (overrides: Partial<ChatTurnResult> = {}): ChatTurnResult => ({
  content: "",
  toolCalls: [],
  finishReason: "stop",
  ...overrides
});

const request = { baseUrl: "https://api.example/v1", model: "m" };
const signal = (): AbortSignal => new AbortController().signal;

it("marks tools available only when the echo tool call is returned", async () => {
  const requests: ChatRequest[] = [];
  const client: ChatClient = {
    complete: vi.fn(async (chatRequest) => {
      requests.push(chatRequest);
      return completed({
        toolCalls: [
          {
            id: "call_1",
            name: "galley_capability_echo",
            argumentsJson: "{}"
          }
        ],
        finishReason: "tool_calls"
      });
    })
  };
  const probe = new CapabilityProbe(
    client,
    () => new Date("2026-07-14T00:00:00.000Z")
  );

  await expect(probe.probe(request, signal())).resolves.toEqual({
    tools: true,
    streaming: false,
    vision: false,
    checkedAt: "2026-07-14T00:00:00.000Z"
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.tools).toEqual([
    {
      name: "galley_capability_echo",
      description: expect.any(String),
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  ]);
});

it("does not accept a different returned tool call as proof", async () => {
  const client: ChatClient = {
    complete: vi.fn().mockResolvedValue(
      completed({
        toolCalls: [
          { id: "call_1", name: "different_tool", argumentsJson: "{}" }
        ]
      })
    )
  };

  await expect(
    new CapabilityProbe(client).probe(request, signal())
  ).resolves.toMatchObject({ tools: false });
});

it("runs opted-in streaming and vision requests independently", async () => {
  const requests: ChatRequest[] = [];
  const client: ChatClient = {
    complete: vi.fn(async (chatRequest) => {
      requests.push(chatRequest);
      if (chatRequest.messages[0]?.content.includes("vision")) {
        throw new Error("vision unsupported");
      }
      if (chatRequest.stream) {
        return completed({ content: "stream-ok" });
      }
      return completed({
        toolCalls: [
          {
            id: "call_1",
            name: "galley_capability_echo",
            argumentsJson: "{}"
          }
        ]
      });
    })
  };
  const probe = new CapabilityProbe(client);

  const capabilities = await probe.probe(request, signal(), {
    streaming: true,
    vision: true
  });

  expect(capabilities).toMatchObject({
    tools: true,
    streaming: true,
    vision: false
  });
  expect(requests).toHaveLength(3);
  expect(requests.some((chatRequest) => chatRequest.stream === true)).toBe(true);
  expect(
    requests.some((chatRequest) =>
      chatRequest.messages[0]?.content.includes("vision")
    )
  ).toBe(true);
});

it("keeps one unsupported capability from suppressing other probes", async () => {
  const client: ChatClient = {
    complete: vi.fn(async (chatRequest) => {
      if (chatRequest.tools) {
        throw new Error("tools unsupported");
      }
      return completed({ content: "supported" });
    })
  };

  await expect(
    new CapabilityProbe(client).probe(request, signal(), {
      streaming: true,
      vision: true
    })
  ).resolves.toMatchObject({ tools: false, streaming: true, vision: true });
});

it("propagates caller cancellation instead of reporting it as unsupported", async () => {
  const controller = new AbortController();
  const client: ChatClient = {
    complete: vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    })
  };

  await expect(
    new CapabilityProbe(client).probe(request, controller.signal, {
      streaming: true,
      vision: true
    })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(client.complete).toHaveBeenCalledTimes(1);
});

it("does not start a probe when the caller signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const client: ChatClient = {
    complete: vi.fn().mockResolvedValue(completed())
  };

  await expect(
    new CapabilityProbe(client).probe(request, controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(client.complete).not.toHaveBeenCalled();
});
