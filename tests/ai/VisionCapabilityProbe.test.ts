import { expect, it, vi } from "vitest";

import type { ChatClient, ChatRequest } from "../../src/ai/AiProtocol";
import { VisionCapabilityProbe } from "../../src/ai/VisionCapabilityProbe";

it("uses only a built-in probe pixel and requires the exact vision token", async () => {
  const requests: ChatRequest[] = [];
  const client: ChatClient = {
    complete: vi.fn(async (request) => {
      requests.push(request);
      return {
        content: "galley_vision_probe",
        toolCalls: [],
        finishReason: "stop"
      };
    })
  };
  await expect(new VisionCapabilityProbe(client).probe(
    { baseUrl: "https://api.example/v1", model: "vision" },
    new AbortController().signal
  )).resolves.toBe(true);

  const content = requests[0]?.messages[0]?.content;
  expect(content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "text" }),
    expect.objectContaining({
      type: "image_url",
      image_url: expect.objectContaining({
        url: expect.stringMatching(/^data:image\/png;base64,/u)
      })
    })
  ]));
});

it("reports unsupported without exposing provider diagnostics", async () => {
  const client: ChatClient = {
    complete: vi.fn(async () => {
      throw new Error("provider secret diagnostic");
    })
  };
  await expect(new VisionCapabilityProbe(client).probe(
    { baseUrl: "https://api.example/v1", model: "text" },
    new AbortController().signal
  )).resolves.toBe(false);
});
