import type {
  GenerateArticleFormInput,
  GeneratedArticleResult
} from "../console/ConsoleTypes";
import type {
  GenerationModelEvent,
  GenerationStage
} from "./GenerationProgress";

export type GenerationTaskStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GenerationTranscriptTurn {
  readonly requestId: number;
  readonly text: string;
  readonly status: "streaming" | "complete";
  readonly startedAt: number;
  readonly elapsedMs?: number;
  readonly truncated: boolean;
}

export interface GenerationPrompt {
  readonly text: string;
  readonly at: number;
}

export interface GenerationTaskSnapshot {
  readonly status: GenerationTaskStatus;
  readonly taskId?: string;
  readonly sourcePath?: string;
  readonly themeId?: string;
  readonly stage?: GenerationStage;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly elapsedMs: number;
  readonly prompt?: GenerationPrompt;
  readonly turns: readonly GenerationTranscriptTurn[];
  readonly result?: GeneratedArticleResult;
  readonly errorMessage?: string;
}

export interface GenerationTaskController {
  snapshot(): GenerationTaskSnapshot;
  subscribe(listener: () => void): () => void;
  start(input: GenerateArticleFormInput): string;
  wait(taskId: string): Promise<GenerationTaskSnapshot>;
  cancel(): void;
  dispose(): void;
}

export interface GenerationTaskStoreOptions {
  readonly run: (
    input: GenerateArticleFormInput,
    signal: AbortSignal
  ) => Promise<GeneratedArticleResult>;
  readonly failureMessage: (error: unknown, signal: AbortSignal) => string;
  readonly now?: () => number;
  readonly createTaskId?: () => string;
}

const MAX_VISIBLE_TURN_CHARACTERS = 240_000;
const OUTPUT_NOTIFICATION_DELAY_MS = 80;

export class GenerationTaskStore implements GenerationTaskController {
  readonly #options: GenerationTaskStoreOptions;
  readonly #listeners = new Set<() => void>();
  readonly #waiters = new Map<
    string,
    Array<(snapshot: GenerationTaskSnapshot) => void>
  >();
  #state: GenerationTaskSnapshot = {
    status: "idle",
    elapsedMs: 0,
    turns: []
  };
  #controller: AbortController | null = null;
  #heartbeat: number | null = null;
  #pendingNotification: number | null = null;

  constructor(options: GenerationTaskStoreOptions) {
    this.#options = options;
  }

  snapshot(): GenerationTaskSnapshot {
    const now = this.#now();
    const startedAt = this.#state.startedAt;
    return {
      ...this.#state,
      elapsedMs: startedAt === undefined
        ? 0
        : Math.max(0, (this.#state.finishedAt ?? now) - startedAt),
      ...(this.#state.prompt
        ? { prompt: { ...this.#state.prompt } }
        : {}),
      turns: this.#state.turns.map((turn) => ({ ...turn }))
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(input: GenerateArticleFormInput): string {
    if (this.#state.status === "running" && this.#state.taskId) {
      return this.#state.taskId;
    }
    const taskId = this.#options.createTaskId?.()
      ?? `${this.#now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const controller = new AbortController();
    this.#controller = controller;
    this.#state = {
      status: "running",
      taskId,
      ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
      ...(input.themeId ? { themeId: input.themeId } : {}),
      stage: "reading",
      startedAt: this.#now(),
      elapsedMs: 0,
      turns: []
    };
    this.#startHeartbeat();
    this.#notify();
    void this.#run(taskId, input, controller);
    return taskId;
  }

  cancel(): void {
    if (this.#state.status !== "running") return;
    this.#controller?.abort();
  }

  wait(taskId: string): Promise<GenerationTaskSnapshot> {
    if (this.#state.taskId !== taskId || this.#state.status !== "running") {
      return Promise.resolve(this.snapshot());
    }
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(taskId) ?? [];
      waiters.push(resolve);
      this.#waiters.set(taskId, waiters);
    });
  }

  dispose(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#stopTimers();
    this.#listeners.clear();
  }

  async #run(
    taskId: string,
    input: GenerateArticleFormInput,
    controller: AbortController
  ): Promise<void> {
    try {
      const result = await this.#options.run(
        {
          ...input,
          onProgress: (stage) => {
            input.onProgress?.(stage);
            this.#progress(taskId, stage);
          },
          onModelEvent: (event) => {
            input.onModelEvent?.(event);
            this.#modelEvent(taskId, event);
          }
        },
        controller.signal
      );
      if (!this.#isCurrent(taskId)) return;
      this.#state = {
        ...this.#state,
        status: "succeeded",
        finishedAt: this.#now(),
        result
      };
    } catch (error) {
      if (!this.#isCurrent(taskId)) return;
      const cancelled = controller.signal.aborted;
      this.#state = {
        ...this.#state,
        status: cancelled ? "cancelled" : "failed",
        finishedAt: this.#now(),
        errorMessage: this.#options.failureMessage(error, controller.signal)
      };
    } finally {
      if (this.#isCurrent(taskId)) {
        this.#controller = null;
        this.#stopTimers();
        this.#notify();
        this.#resolveWaiters(taskId);
      }
    }
  }

  #progress(taskId: string, stage: GenerationStage): void {
    if (!this.#isCurrent(taskId) || this.#state.status !== "running") return;
    this.#state = { ...this.#state, stage };
    this.#notify();
  }

  #modelEvent(taskId: string, event: GenerationModelEvent): void {
    if (!this.#isCurrent(taskId) || this.#state.status !== "running") return;
    if (event.type === "prompt") {
      this.#state = {
        ...this.#state,
        prompt: { text: event.text, at: event.at }
      };
      this.#notify();
      return;
    }
    const turns = this.#state.turns.map((turn) => ({ ...turn }));
    const index = turns.findIndex(({ requestId }) => requestId === event.requestId);
    if (event.type === "request-start") {
      if (index < 0) {
        turns.push({
          requestId: event.requestId,
          text: "",
          status: "streaming",
          startedAt: event.at,
          truncated: false
        });
      }
      this.#state = { ...this.#state, turns };
      this.#notify();
      return;
    }
    if (index < 0) return;
    const current = turns[index];
    if (!current) return;
    if (event.type === "text-delta") {
      const combined = current.text + event.text;
      const truncated = combined.length > MAX_VISIBLE_TURN_CHARACTERS;
      turns[index] = {
        ...current,
        text: truncated
          ? combined.slice(-MAX_VISIBLE_TURN_CHARACTERS)
          : combined,
        truncated: current.truncated || truncated
      };
      this.#state = { ...this.#state, turns };
      this.#notifyOutput();
      return;
    }
    if (!current.text.trim()) {
      turns.splice(index, 1);
    } else {
      turns[index] = {
        ...current,
        status: "complete",
        elapsedMs: event.elapsedMs
      };
    }
    this.#state = { ...this.#state, turns };
    this.#notify();
  }

  #startHeartbeat(): void {
    this.#stopTimers();
    this.#heartbeat = window.setInterval(() => this.#notify(), 1_000);
  }

  #stopTimers(): void {
    if (this.#heartbeat !== null) window.clearInterval(this.#heartbeat);
    if (this.#pendingNotification !== null) {
      window.clearTimeout(this.#pendingNotification);
    }
    this.#heartbeat = null;
    this.#pendingNotification = null;
  }

  #notifyOutput(): void {
    if (this.#pendingNotification !== null) return;
    this.#pendingNotification = window.setTimeout(() => {
      this.#pendingNotification = null;
      this.#notify();
    }, OUTPUT_NOTIFICATION_DELAY_MS);
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #isCurrent(taskId: string): boolean {
    return this.#state.taskId === taskId;
  }

  #resolveWaiters(taskId: string): void {
    const waiters = this.#waiters.get(taskId) ?? [];
    this.#waiters.delete(taskId);
    const snapshot = this.snapshot();
    for (const resolve of waiters) resolve(snapshot);
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
