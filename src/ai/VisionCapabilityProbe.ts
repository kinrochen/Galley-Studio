import type { ChatClient, ChatRequest } from "./AiProtocol";

const BUILT_IN_PROBE_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
                  text: "If you can inspect the attached built-in one-pixel capability probe, reply with exactly galley_vision_probe."
                },
                {
                  type: "image_url",
                  image_url: { url: BUILT_IN_PROBE_PIXEL, detail: "low" }
                }
              ]
            }
          ]
        },
        signal
      );
      return (
        result.toolCalls.length === 0 &&
        result.content.trim() === "galley_vision_probe"
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
