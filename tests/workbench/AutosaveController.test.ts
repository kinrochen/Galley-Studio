import { afterEach, describe, expect, it, vi } from "vitest";

import { AutosaveController } from "../../src/workbench/AutosaveController";

afterEach(() => vi.useRealTimers());

describe("AutosaveController", () => {
  it("saves once 800ms after the latest change", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const controller = new AutosaveController(800, save);

    controller.changed();
    await vi.advanceTimersByTimeAsync(500);
    controller.changed();
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling while conflicted and cancels on disposal", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const controller = new AutosaveController(800, save);
    controller.changed();
    controller.pause();
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();

    controller.resume();
    controller.changed();
    controller.dispose();
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
  });

  it("serializes a change that arrives during an in-flight save", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const save = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const controller = new AutosaveController(800, save);
    controller.changed();
    await vi.advanceTimersByTimeAsync(800);
    controller.changed();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flushes a pending debounce before disposal", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const controller = new AutosaveController(800, save);
    controller.changed();
    await vi.advanceTimersByTimeAsync(200);
    await controller.flush();
    controller.dispose();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
