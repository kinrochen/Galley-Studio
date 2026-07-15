import { expect, it, vi } from "vitest";

import type { ChatClient, ChatRequest } from "../../src/ai/AiProtocol";
import { VisionCapabilityProbe } from "../../src/ai/VisionCapabilityProbe";

it("requires an answer that is present only in the built-in image", async () => {
  const requests: ChatRequest[] = [];
  const client: ChatClient = {
    complete: vi.fn(async (request) => {
      requests.push(request);
      return {
        content: "RGBR",
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
  const prompt = Array.isArray(content)
    ? content.find((part) => part.type === "text")?.text ?? ""
    : "";
  expect(prompt).not.toContain("RGBR");
  expect(prompt).not.toContain("galley_vision_probe");
});

it("rejects a text-only model that ignores the image but follows the written token", async () => {
  const client: ChatClient = {
    complete: vi.fn(async (request) => {
      const content = request.messages[0]?.content;
      const prompt = Array.isArray(content)
        ? content.find((part) => part.type === "text")?.text ?? ""
        : String(content ?? "");
      return {
        content: prompt.includes("galley_vision_probe")
          ? "galley_vision_probe"
          : "I cannot inspect images.",
        toolCalls: [],
        finishReason: "stop"
      };
    })
  };

  await expect(new VisionCapabilityProbe(client).probe(
    { baseUrl: "https://api.example/v1", model: "text-only" },
    new AbortController().signal
  )).resolves.toBe(false);
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
