import { requestUrl } from "obsidian";

import type { HttpTransport } from "../ai/AiProtocol";

export function createObsidianTransport(): HttpTransport {
  return {
    post: async (url, headers, body, signal) => {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const response = await withAbort(
        requestUrl({
          url,
          method: "POST",
          headers,
          body: JSON.stringify(body),
          throw: false
        }),
        signal
      );
      return { status: response.status, json: response.json };
    }
  };
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
