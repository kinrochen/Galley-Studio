import { describe, expect, it, vi } from "vitest";

import type { GenerateArticleFormInput } from "../../src/console/ConsoleTypes";
import { GenerationTaskStore } from "../../src/generation/GenerationTask";

describe("GenerationTaskStore", () => {
  it("keeps a task alive after the console listener unsubscribes", async () => {
    let finish: ((value: {
      status: "committed";
      htmlPath: string;
      sidecarPath: string;
    }) => void) | undefined;
    let signal: AbortSignal | undefined;
    const store = new GenerationTaskStore({
      createTaskId: () => "task-1",
      run: async (_input, runSignal) => {
        signal = runSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      failureMessage: () => "failed"
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.start({ sourcePath: "notes/article.md", themeId: "paper" });
    unsubscribe();

    expect(signal?.aborted).toBe(false);
    finish?.({
      status: "committed",
      htmlPath: "notes/article.galley.html",
      sidecarPath: "notes/article.galley.json"
    });
    await vi.waitFor(() => expect(store.snapshot().status).toBe("succeeded"));
    expect(store.snapshot().result?.htmlPath).toBe("notes/article.galley.html");
    expect(signal?.aborted).toBe(false);
    store.dispose();
  });

  it("records model rounds while excluding hidden reasoning from the store boundary", async () => {
    let input: GenerateArticleFormInput | undefined;
    let finish: (() => void) | undefined;
    const store = new GenerationTaskStore({
      createTaskId: () => "task-2",
      run: async (value) => {
        input = value;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "committed",
          htmlPath: "article.galley.html",
          sidecarPath: "article.galley.json"
        };
      },
      failureMessage: () => "failed"
    });

    store.start({ sourcePath: "article.md" });
    input?.onModelEvent?.({
      type: "prompt",
      text: "INITIAL PROMPT",
      at: 9
    });
    input?.onProgress?.("generating");
    input?.onModelEvent?.({ type: "request-start", requestId: 1, at: 10 });
    input?.onModelEvent?.({
      type: "text-delta",
      requestId: 1,
      text: "<article>visible</article>",
      at: 11
    });
    input?.onModelEvent?.({
      type: "request-complete",
      requestId: 1,
      elapsedMs: 900,
      at: 910
    });

    expect(store.snapshot()).toMatchObject({
      status: "running",
      stage: "generating",
      prompt: {
        text: "INITIAL PROMPT",
        at: 9
      },
      turns: [{
        requestId: 1,
        text: "<article>visible</article>",
        status: "complete",
        elapsedMs: 900
      }]
    });
    finish?.();
    await vi.waitFor(() => expect(store.snapshot().status).toBe("succeeded"));
    store.dispose();
  });

  it("removes completed tool-only rounds that have no visible model text", async () => {
    let input: GenerateArticleFormInput | undefined;
    let finish: (() => void) | undefined;
    const store = new GenerationTaskStore({
      createTaskId: () => "task-tool-round",
      run: async (value) => {
        input = value;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "committed",
          htmlPath: "article.html",
          sidecarPath: ""
        };
      },
      failureMessage: () => "failed"
    });

    store.start({ sourcePath: "article.md" });
    input?.onModelEvent?.({ type: "request-start", requestId: 1, at: 10 });
    input?.onModelEvent?.({
      type: "request-complete",
      requestId: 1,
      elapsedMs: 900,
      at: 910
    });

    expect(store.snapshot().turns).toEqual([]);
    finish?.();
    await vi.waitFor(() => expect(store.snapshot().status).toBe("succeeded"));
    store.dispose();
  });

  it("aborts only when the user explicitly cancels or the plugin disposes", async () => {
    let signal: AbortSignal | undefined;
    const store = new GenerationTaskStore({
      run: async (_input, runSignal) => {
        signal = runSignal;
        return new Promise((_resolve, reject) => {
          runSignal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
      failureMessage: () => "cancelled"
    });

    store.start({ sourcePath: "article.md" });
    store.cancel();

    await vi.waitFor(() => expect(store.snapshot().status).toBe("cancelled"));
    expect(signal?.aborted).toBe(true);
    store.dispose();
  });
});
