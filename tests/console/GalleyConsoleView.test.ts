import { WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../../src/ai/AiError";
import {
  GALLEY_CONSOLE_VIEW_TYPE,
  GalleyConsoleView
} from "../../src/console/GalleyConsoleView";
import type { GalleyActions } from "../../src/console/GalleyActions";
import type { GenerateArticleFormInput } from "../../src/console/ConsoleTypes";
import { LocaleStore } from "../../src/i18n/LocaleStore";
import type { LocalizedText } from "../../src/i18n/LocalizedText";
import {
  GenerationTaskStore,
  type GenerationTaskController,
  type GenerationTaskSnapshot
} from "../../src/generation/GenerationTask";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GalleyConsoleView", () => {
  it("renders the stable desktop routes and task-oriented current context first", async () => {
    const { view } = fixture({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "notes/current.md",
        name: "current.md",
        words: 42,
        characters: 240
      })
    });

    await view.onOpen();

    expect(view.getViewType()).toBe(GALLEY_CONSOLE_VIEW_TYPE);
    expect(view.route()).toBe("home");
    expect(
      [...view.contentEl.querySelectorAll('[role="tab"]')].map(
        (element) => element.textContent
      )
    ).toEqual([
      "Console",
      "Generation",
      "Articles",
      "Themes",
      "Settings"
    ]);
    expect(view.contentEl.querySelector(".galley-console__task")?.textContent).toContain(
      "current.md"
    );
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(
        '[data-action="generate"]'
      )?.textContent
    ).toBe("Generate HTML");
    expect(view.contentEl.textContent).toContain("article.galley.html");
    expect(view.contentEl.querySelectorAll(".galley-console__article-row")).toHaveLength(1);
    expect(view.contentEl.querySelector('[role="status"]')).not.toBeNull();

    await view.setState({ route: "skills" });
    expect(view.route()).toBe("home");
  });

  it("renders one focused generation workspace without running a connection diagnostic", async () => {
    const runDiagnostic = vi.fn(async () => ({
      ok: true,
      model: "model-home",
      capabilities: { tools: true, streaming: true, vision: false },
      skillVersion: "bundled",
      skillLoadMode: "tool-calls" as const,
      skillFiles: ["SKILL.md"]
    }));
    const openWorkbench = vi.fn(async () => undefined);
    const openThemeLab = vi.fn(async () => undefined);
    const { view } = fixture({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "notes/current.md",
        name: "current.md"
      }),
      desktop: {
        openWorkbench,
        openThemeLab,
        listThemes: async () => [
          { id: "paper", name: "Paper", builtIn: true, enabled: true },
          { id: "custom", name: "Custom", builtIn: false, enabled: true }
        ],
        readSettings: async () => ({
          generationAgent: "plugin",
          codexCliPath: "codex",
          claudeCliPath: "claude",
          baseUrl: "https://api.example.com/v1",
          model: "model-home",
          secretId: "provider-key",
          temperature: 0.4,
          timeoutMs: 120000,
          contextWindow: 128000,
          outputFolder: "Galley",
          language: "en",
          activeSkillVersion: "2026.7"
        }),
        runDiagnostic
      }
    });

    await view.onOpen();

    expect(view.contentEl.querySelector(".galley-console__task")).not.toBeNull();
    expect(view.contentEl.querySelector(".galley-console__recent")).not.toBeNull();
    expect(view.contentEl.querySelector(".galley-console__quick-actions")).toBeNull();
    expect(view.contentEl.textContent).toContain("model-home");
    expect(view.contentEl.textContent).toContain("2026.7");
    expect(view.contentEl.querySelector(".galley-console__readiness")?.textContent)
      .toContain("Themes2");
    expect(runDiagnostic).not.toHaveBeenCalled();
    expect(
      [...view.contentEl.querySelectorAll<HTMLInputElement>('[name="themeId"]')]
        .map((option) => option.value)
    ).toEqual(["paper", "custom"]);
    expect(view.contentEl.querySelectorAll(".galley-theme-preview")).toHaveLength(2);
    expect(view.contentEl.querySelector('[data-action="preview"]')).toBeNull();
    expect(view.contentEl.querySelector('[data-action="edit"]')?.textContent)
      .toBe("Edit");
    for (const action of ["theme-lab", "open-themes", "open-skills", "open-exports"]) {
      expect(view.contentEl.querySelector(`[data-action="${action}"]`)).toBeNull();
    }
    expect(view.contentEl.querySelector('[data-action="open-settings"]')).not.toBeNull();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="edit"]')?.click();
    await vi.waitFor(() => expect(openWorkbench).toHaveBeenCalledWith("article.galley.html"));
  });

  it("mobile renders only Console, Articles, Language and safe preview", async () => {
    const { view } = fixture({ mobile: true });
    await view.onOpen();
    await view.navigate("articles");

    expect(
      [...view.contentEl.querySelectorAll('[role="tab"]')].map(
        (element) => element.textContent
      )
    ).toEqual(["Console", "Articles"]);
    expect(view.contentEl.textContent).toContain("Preview only on mobile");
    expect(view.contentEl.querySelector('[data-action="preview"]')).not.toBeNull();
    expect(
      view.contentEl.querySelector(
        '[data-action="generate"], [data-action="edit"], [data-action="export"], [data-action="theme-lab"], [data-action="skill-import"], [data-action="diagnostic"]'
      )
    ).toBeNull();
    expect(view.contentEl.querySelector('[aria-label="Language"]')).not.toBeNull();
  });

  it("routes with keyboard-accessible tabs and focuses the page heading", async () => {
    const { view } = fixture();
    await view.onOpen();
    const articles = [...view.contentEl.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]'
    )].find((tab) => tab.textContent === "Articles");

    articles?.click();
    await vi.waitFor(() =>
      expect(
        view.contentEl.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent
      ).toBe("Articles")
    );

    expect(articles?.tagName).toBe("BUTTON");
    expect(view.contentEl.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Articles"
    );
    expect(document.activeElement).toBe(view.contentEl.querySelector("main h1"));
  });

  it("persists language through actions before live rerendering", async () => {
    const events: string[] = [];
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const { view } = fixture({
      locale,
      setLanguage: async (language) => {
        events.push("persist");
        locale.configure(language);
        events.push("publish");
      }
    });
    await view.onOpen();
    const language = view.contentEl.querySelector<HTMLSelectElement>(
      '[aria-label="Language"]'
    );
    if (!language) throw new Error("missing language switch");

    language.value = "zh-CN";
    language.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(view.contentEl.textContent).toContain("文章"));

    expect(events).toEqual(["persist", "publish"]);
    expect(view.route()).toBe("home");
  });

  it("retains generation form input on error and renders an accessible alert", async () => {
    const { view } = fixture({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "current.md",
        name: "current.md"
      }),
      generateActiveMarkdown: async () => {
        throw new AiError("missing_secret");
      }
    });
    await view.onOpen();
    const theme = view.contentEl.querySelector<HTMLInputElement>(
      '[name="themeId"]'
    );
    if (!theme) throw new Error("missing theme input");
    theme.click();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.click();
    await vi.waitFor(() =>
      expect(view.contentEl.querySelector('[role="alert"]')).not.toBeNull()
    );

    expect(
      view.contentEl.querySelector<HTMLInputElement>('[name="themeId"]')?.checked
    ).toBe(true);
    expect(view.contentEl.querySelector('[role="alert"]')?.textContent).toBe(
      "Galley Studio: Configure an API key before generating."
    );
    expect(view.contentEl.textContent).not.toContain("missing_secret");
  });

  it("disables only the running action and restores it after completion", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const generateActiveMarkdown = vi.fn(async (input: GenerateArticleFormInput) => {
      input.onProgress?.("generating");
      await pending;
      return {
        status: "committed" as const,
        htmlPath: "current.galley.html",
        sidecarPath: "current.galley.json"
      };
    });
    const { view } = fixture({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "current.md",
        name: "current.md"
      }),
      generateActiveMarkdown
    });
    await view.onOpen();

    view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.click();
    await vi.waitFor(() => expect(generateActiveMarkdown).toHaveBeenCalledTimes(1));
    expect(generateActiveMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ themeId: "paper", sourcePath: "current.md" }),
      expect.any(AbortSignal)
    );

    expect(
      view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.disabled
    ).toBe(true);
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain("3/4 The Agent is using the Skill to generate HTML")
    );
    expect(
      [...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent === "Articles"
      )?.disabled
    ).toBe(false);

    finish?.();
    await vi.waitFor(() =>
      expect(
        view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.disabled
      ).toBe(false)
    );
  });

  it("reports generation partial success with its committed HTML path", async () => {
    const { view } = fixture({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "current.md",
        name: "current.md"
      }),
      generateActiveMarkdown: async () => ({
        status: "partial-success",
        htmlPath: "Galley/current.galley.html",
        sidecarPath: "Galley/current.galley.json"
      })
    });
    await view.onOpen();

    view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.click();
    await vi.waitFor(() =>
      expect(view.contentEl.querySelector('[role="status"]')?.textContent).toContain(
        "Galley/current.galley.html"
      )
    );

    expect(view.contentEl.querySelector('[role="status"]')?.textContent).toContain(
      "metadata was not fully committed"
    );
  });

  it("shows live model output and leaves plugin-owned generation running on close", async () => {
    let receivedInput: GenerateArticleFormInput | undefined;
    let receivedSignal: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    const generationTask = new GenerationTaskStore({
      createTaskId: () => "view-task",
      run: async (input, signal) => {
        receivedInput = input;
        receivedSignal = signal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "committed",
          htmlPath: "current.galley.html",
          sidecarPath: "current.galley.json"
        };
      },
      failureMessage: () => "failed"
    });
    const { view } = fixture({
      generationTask,
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "current.md",
        name: "current.md"
      })
    });
    await view.onOpen();

    view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.click();
    await vi.waitFor(() => expect(view.route()).toBe("generation"));
    receivedInput?.onModelEvent?.({
      type: "prompt",
      text: "INITIAL PROMPT SENT TO AGENT",
      at: 0
    });
    receivedInput?.onModelEvent?.({ type: "request-start", requestId: 1, at: 1 });
    receivedInput?.onModelEvent?.({
      type: "text-delta",
      requestId: 1,
      text: "<article>visible output</article>",
      at: 2
    });
    await vi.waitFor(() =>
      expect(view.contentEl.textContent).toContain("visible output")
    );
    expect(
      view.contentEl.querySelector(".galley-generation__message.is-user")
        ?.textContent
    ).toContain("INITIAL PROMPT SENT TO AGENT");
    expect(
      view.contentEl.querySelector(".galley-generation__message.is-assistant")
        ?.textContent
    ).toContain("visible output");

    await view.onClose();
    expect(receivedSignal?.aborted).toBe(false);
    finish?.();
    await vi.waitFor(() => expect(generationTask.snapshot().status).toBe("succeeded"));
    generationTask.dispose();
  });

  it("preserves page and message scroll positions while generation updates", async () => {
    let notify: (() => void) | undefined;
    let snapshot: GenerationTaskSnapshot = {
      status: "running",
      taskId: "scroll-task",
      sourcePath: "current.md",
      stage: "generating",
      startedAt: 0,
      elapsedMs: 1_000,
      prompt: {
        text: "A long initial prompt that the user has scrolled.",
        at: 0
      },
      turns: [{
        requestId: 1,
        text: "A long model response that the user has scrolled.",
        status: "streaming",
        startedAt: 1,
        truncated: false
      }]
    };
    const generationTask: GenerationTaskController = {
      snapshot: () => snapshot,
      subscribe: (listener) => {
        notify = listener;
        return () => {
          notify = undefined;
        };
      },
      start: () => "scroll-task",
      wait: async () => snapshot,
      cancel: vi.fn(),
      dispose: vi.fn()
    };
    const { view } = fixture({ generationTask });
    await view.onOpen();
    await view.navigate("generation");

    const previousMain = requiredElement(
      view.contentEl,
      ".galley-console__main"
    );
    const previousConversation = requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-conversation"]'
    );
    const previousPrompt = requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-prompt"]'
    );
    const previousTurn = requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-turn-1"]'
    );
    setScrollPosition(previousMain, 180, 1_200, 500);
    setScrollPosition(previousConversation, 140, 900, 420);
    setScrollPosition(previousPrompt, 60, 600, 240);
    setScrollPosition(previousTurn, 90, 800, 300);

    const firstTurn = snapshot.turns[0];
    if (!firstTurn) throw new Error("Missing generation turn");
    snapshot = {
      ...snapshot,
      elapsedMs: 2_000,
      turns: [{
        ...firstTurn,
        text: `${firstTurn.text}\nNew streamed output.`
      }]
    };
    notify?.();

    await vi.waitFor(() =>
      expect(view.contentEl.querySelector(".galley-console__main"))
        .not.toBe(previousMain)
    );
    expect(requiredElement(
      view.contentEl,
      ".galley-console__main"
    ).scrollTop).toBe(180);
    expect(requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-conversation"]'
    ).scrollTop).toBe(140);
    expect(requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-prompt"]'
    ).scrollTop).toBe(60);
    expect(requiredElement(
      view.contentEl,
      '[data-scroll-key="generation-turn-1"]'
    ).scrollTop).toBe(90);
  });

  it("cancels only console-owned work and disposes subscriptions once", async () => {
    let receivedSignal: AbortSignal | undefined;
    const unsubscribeLocale = vi.fn();
    const unsubscribeContext = vi.fn();
    const locale = {
      configuredLanguage: () => "en" as const,
      locale: () => "en" as const,
      t: new LocaleStore({ language: "en", obsidianLocale: () => "en" }).t.bind(
        new LocaleStore({ language: "en", obsidianLocale: () => "en" })
      ),
      subscribe: () => unsubscribeLocale
    };
    const { view } = fixture({
      locale,
      subscribeContext: () => unsubscribeContext,
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "current.md",
        name: "current.md"
      }),
      generateActiveMarkdown: async (_input, signal) => {
        receivedSignal = signal;
        return new Promise(() => undefined);
      }
    });
    await view.onOpen();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="generate"]')?.click();
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());

    await view.onClose();
    await view.onClose();

    expect(receivedSignal?.aborted).toBe(true);
    expect(unsubscribeLocale).toHaveBeenCalledTimes(1);
    expect(unsubscribeContext).toHaveBeenCalledTimes(1);
  });
});

function requiredElement(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

function setScrollPosition(
  element: HTMLElement,
  top: number,
  scrollHeight: number,
  clientHeight: number
): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight }
  });
  element.scrollTop = top;
}

function fixture(
  options: {
    mobile?: boolean;
    locale?: LocalizedText;
    inspectActiveContext?: GalleyActions["inspectActiveContext"];
    generateActiveMarkdown?: GalleyActions["generateActiveMarkdown"];
    setLanguage?: GalleyActions["setLanguage"];
    subscribeContext?: (listener: () => void) => () => void;
    generationTask?: GenerationTaskController;
    desktop?: Partial<NonNullable<GalleyActions["desktop"]>>;
  } = {}
) {
  const locale =
    options.locale ??
    new LocaleStore({ language: "en", obsidianLocale: () => "en" });
  const actions: GalleyActions = {
    inspectActiveContext: options.inspectActiveContext ?? (async () => ({ kind: "empty" })),
    listArticles: async () => ({
      documents: [
        {
          htmlPath: "article.galley.html",
          sidecarPath: "article.galley.json",
          sourcePath: "article.md",
          documentId: "id",
          themeId: "paper-lab",
          model: "model-x",
          generatedAt: "2026-07-15T00:00:00.000Z",
          modifiedAt: 1,
          exportCount: 0,
          validation: "valid"
        }
      ],
      unavailable: []
    }),
    openPreview: async () => undefined,
    generateActiveMarkdown:
      options.generateActiveMarkdown ??
      (async () => ({
        status: "committed",
        htmlPath: "article.galley.html",
        sidecarPath: "article.galley.json"
      })),
    setLanguage:
      options.setLanguage ??
      (async (language) => {
        if (locale instanceof LocaleStore) locale.configure(language);
      }),
    ...(!options.mobile
      ? {
          desktop: {
            openWorkbench: async () => undefined,
            listThemes: async () => [
              { id: "paper", name: "Paper", builtIn: true, enabled: true }
            ],
            listSecrets: async () => ["fixture-key", "provider-key"],
            readSettings: async () => ({
              generationAgent: "plugin",
              codexCliPath: "codex",
              claudeCliPath: "claude",
              baseUrl: "https://api.example.com/v1",
              model: "fixture-model",
              secretId: "fixture-key",
              temperature: 0.4,
              timeoutMs: 120000,
              contextWindow: 128000,
              outputFolder: "",
              language: "en",
              activeSkillVersion: "bundled"
            }),
            ...options.desktop
          }
        }
      : {})
  };
  const view = new GalleyConsoleView(new WorkspaceLeaf(), {
    actions,
    locale,
    mobile: options.mobile ?? false,
    ...(options.subscribeContext
      ? { subscribeContext: options.subscribeContext }
      : {}),
    ...(options.generationTask ? { generationTask: options.generationTask } : {})
  });
  document.body.append(view.containerEl);
  return { view, actions, locale };
}
