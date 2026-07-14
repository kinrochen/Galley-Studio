import { afterEach, expect, it, vi } from "vitest";

import { createObsidianTransport } from "../../src/diagnostics/ObsidianTransport";
import {
  resetRequestUrlHandler,
  setRequestUrlHandler,
  type RequestUrlParam
} from "../setup/obsidian";

afterEach(() => {
  resetRequestUrlHandler();
});

it("resolves non-2xx status and JSON through throw:false", async () => {
  const json = { error: { code: "unauthorized" } };
  const handler = vi.fn(async () => ({ status: 401, json }));
  setRequestUrlHandler(handler);

  const response = await createObsidianTransport().post(
    "https://api.example/v1/chat/completions",
    { Authorization: "Bearer secret", "Content-Type": "application/json" },
    { model: "m", messages: [] },
    new AbortController().signal
  );

  expect(response).toEqual({ status: 401, json });
  expect(handler).toHaveBeenCalledWith({
    url: "https://api.example/v1/chat/completions",
    method: "POST",
    headers: {
      Authorization: "Bearer secret",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: "m", messages: [] }),
    throw: false
  } satisfies RequestUrlParam);
});

it("does not call requestUrl when the signal is already aborted", async () => {
  const handler = vi.fn(async () => ({ status: 200, json: {} }));
  setRequestUrlHandler(handler);
  const controller = new AbortController();
  controller.abort();

  await expect(
    createObsidianTransport().post(
      "https://api.example/v1/chat/completions",
      {},
      {},
      controller.signal
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(handler).not.toHaveBeenCalled();
});

it("rejects promptly when aborted while requestUrl remains pending", async () => {
  const handler = vi.fn(
    () =>
      new Promise<{ status: number; json: unknown }>(() => {
        // Obsidian requestUrl does not expose transport cancellation.
      })
  );
  setRequestUrlHandler(handler);
  const controller = new AbortController();

  const request = createObsidianTransport().post(
    "https://api.example/v1/chat/completions",
    {},
    {},
    controller.signal
  );
  controller.abort();

  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(handler).toHaveBeenCalledTimes(1);
});
