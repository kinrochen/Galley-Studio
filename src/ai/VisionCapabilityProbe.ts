import type { ChatClient, ChatRequest } from "./AiProtocol";

const BUILT_IN_PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAAAgCAYAAADaInAlAAAAe0lEQVR42u3SMQ0AIBAEwVfyNXKoEYscbICMC8kUa2AzdXrcZL1ntnWipf8XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8AeEakeg5F43cxAAAAAElFTkSuQmCC";
const EXPECTED_COLOR_SEQUENCE = "RGBR";

export class VisionCapabilityProbe {
  constructor(private readonly client: ChatClient) {}

  async probe(
    target: Pick<ChatRequest, "baseUrl" | "model">,
    signal: AbortSignal
  ): Promise<boolean> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const result = await this.client.complete(
        {
          ...target,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Inspect the attached image, which contains four equal rectangular color cells. Reply with only the initial letter of each cell's dominant color from left to right, using R, G, or B. If you cannot inspect the image, reply unsupported."
                },
                {
                  type: "image_url",
                  image_url: { url: BUILT_IN_PROBE_IMAGE, detail: "low" }
                }
              ]
            }
          ]
        },
        signal
      );
      return (
        result.toolCalls.length === 0 &&
        result.content.trim().toUpperCase() === EXPECTED_COLOR_SEQUENCE
      );
    } catch (error) {
      if (
        signal.aborted ||
        (typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError")
      ) {
        throw error;
      }
      return false;
    }
  }
}
