import { expect, it, vi } from "vitest";
import { SseDecoder, decodeSseLines } from "../../src/ai/SseDecoder";

it("decodes data frames and ignores DONE", () => {
  expect(decodeSseLines('data: {"x":1}\n\ndata: [DONE]\n\n')).toEqual([
    { x: 1 }
  ]);
});

it("buffers incomplete CRLF-delimited frames across chunks", () => {
  const decoder = new SseDecoder();

  expect(decoder.push('data: {"choices":[{"delta":{"content":"hel')).toEqual([]);
  expect(
    decoder.push('lo"}}]}\r\n\r\ndata: {"x":2}\r\n\r\n')
  ).toEqual([
    { choices: [{ delta: { content: "hello" } }] },
    { x: 2 }
  ]);
  expect(decoder.finish()).toEqual([]);
});

it("flushes a final complete data event without a trailing blank line", () => {
  const decoder = new SseDecoder();

  decoder.push('data: {"x":1}');

  expect(decoder.finish()).toEqual([{ x: 1 }]);
});

it("rejects malformed data without logging or exposing the raw frame", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const rawSecret = "sse-secret-value";

  let thrown: unknown;
  try {
    decodeSseLines(`data: ${rawSecret}\n\n`);
  } catch (caught) {
    thrown = caught;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect(String(thrown)).toContain("Invalid SSE data");
  expect(String(thrown)).not.toContain(rawSecret);
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
