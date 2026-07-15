export class AutosaveController {
  readonly #delayMs: number;
  readonly #save: () => Promise<void>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending = false;
  #running = false;
  #runningPromise: Promise<void> | null = null;
  #paused = false;
  #disposed = false;

  constructor(delayMs: number, save: () => Promise<void>) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error("Autosave delay must be a non-negative finite number.");
    }
    this.#delayMs = delayMs;
    this.#save = save;
  }

  changed(): void {
    if (this.#disposed || this.#paused) return;
    this.#pending = true;
    if (!this.#running) this.#schedule();
  }

  pause(): void {
    this.#paused = true;
    this.#pending = false;
    this.#clearTimer();
  }

  resume(): void {
    if (this.#disposed) return;
    this.#paused = false;
  }

  cancel(): void {
    this.#pending = false;
    this.#clearTimer();
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }

  async flush(): Promise<void> {
    if (this.#disposed || this.#paused) return;
    this.#clearTimer();
    if (this.#runningPromise) await this.#runningPromise;
    if (this.#pending) await this.#flush();
  }

  #schedule(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#flush();
    }, this.#delayMs);
  }

  async #flush(): Promise<void> {
    if (
      this.#disposed ||
      this.#paused ||
      this.#running ||
      !this.#pending
    ) {
      return;
    }
    this.#pending = false;
    this.#running = true;
    const running = this.#save();
    this.#runningPromise = running;
    try {
      await running;
    } finally {
      this.#running = false;
      if (this.#runningPromise === running) this.#runningPromise = null;
      if (this.#pending && !this.#paused && !this.#disposed) this.#schedule();
    }
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
