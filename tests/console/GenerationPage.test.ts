import { describe, expect, it, vi } from "vitest";

import type { GalleyActions } from "../../src/console/GalleyActions";
import { renderGenerationPage } from "../../src/console/GenerationPage";
import type { GenerationTaskController } from "../../src/generation/GenerationTask";
import { ENGLISH_LOCALIZED_TEXT } from "../../src/i18n/LocalizedText";

describe("GenerationPage", () => {
  it("renders one consistent completed state after the final HTML is saved", () => {
    const container = document.createElement("div");
    const task: GenerationTaskController = {
      snapshot: () => ({
        status: "succeeded",
        taskId: "task",
        sourcePath: "notes/article.md",
        themeId: "paper",
        stage: "saving",
        startedAt: 0,
        finishedAt: 5_000,
        elapsedMs: 5_000,
        prompt: { text: "Generate the article.", at: 1 },
        turns: [],
        result: {
          status: "committed",
          htmlPath: "notes/article.html",
          sidecarPath: ""
        }
      }),
      subscribe: () => () => undefined,
      start: () => "task",
      wait: async () => task.snapshot(),
      cancel: vi.fn(),
      dispose: vi.fn()
    };

    renderGenerationPage(container, {
      actions: {
        desktop: {
          openWorkbench: async () => undefined
        }
      } as unknown as GalleyActions,
      task,
      text: ENGLISH_LOCALIZED_TEXT,
      navigate: async () => undefined
    });

    expect(container.querySelector(".galley-generation__status")?.textContent)
      .toBe("Completed");
    expect(container.querySelectorAll(".galley-generation__progress li"))
      .toHaveLength(4);
    expect(container.querySelectorAll(".galley-generation__progress .is-complete"))
      .toHaveLength(4);
    expect(container.querySelector(".galley-generation__progress .is-current"))
      .toBeNull();
    expect(container.textContent).toContain(
      "Generation completed and saved: notes/article.html"
    );
  });

  it("renders a visible failure title and detailed error message", () => {
    const container = document.createElement("div");
    const task: GenerationTaskController = {
      snapshot: () => ({
        status: "failed",
        taskId: "failed-task",
        sourcePath: "notes/article.md",
        stage: "generating",
        startedAt: 0,
        finishedAt: 5_000,
        elapsedMs: 5_000,
        turns: [],
        errorMessage: "The model response did not contain usable HTML."
      }),
      subscribe: () => () => undefined,
      start: () => "failed-task",
      wait: async () => task.snapshot(),
      cancel: vi.fn(),
      dispose: vi.fn()
    };

    renderGenerationPage(container, {
      actions: {} as GalleyActions,
      task,
      text: ENGLISH_LOCALIZED_TEXT,
      navigate: async () => undefined
    });

    const error = container.querySelector(".galley-generation__error");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.querySelector(".galley-generation__error-title")?.textContent)
      .toBe("Generation failed.");
    expect(error?.querySelector(".galley-generation__error-message")?.textContent)
      .toBe("The model response did not contain usable HTML.");
  });

  it("hides completed tool-only rounds and numbers visible messages continuously", () => {
    const container = document.createElement("div");
    const task = {
      snapshot: () => ({
        status: "succeeded" as const,
        sourcePath: "notes/article.md",
        stage: "saving" as const,
        elapsedMs: 5_000,
        turns: [
          {
            requestId: 1,
            text: "",
            status: "complete" as const,
            startedAt: 0,
            elapsedMs: 1_000,
            truncated: false
          },
          {
            requestId: 3,
            text: "<section>done</section>",
            status: "complete" as const,
            startedAt: 2_000,
            elapsedMs: 3_000,
            truncated: false
          }
        ],
        result: {
          status: "committed" as const,
          htmlPath: "notes/article.html",
          sidecarPath: ""
        }
      }),
      subscribe: () => () => undefined,
      start: () => "task",
      wait: async () => task.snapshot(),
      cancel: vi.fn(),
      dispose: vi.fn()
    };

    renderGenerationPage(container, {
      actions: {} as GalleyActions,
      task,
      text: ENGLISH_LOCALIZED_TEXT,
      navigate: async () => undefined
    });

    expect(container.querySelectorAll(".galley-generation__message.is-assistant"))
      .toHaveLength(1);
    expect(container.textContent).toContain("Model rounds1");
    expect(container.textContent).toContain("Model · round 1 · 3s");
    expect(container.textContent).not.toContain("Waiting for visible model output");
  });
});
