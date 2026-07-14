import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_HUGERTE_FEATURES,
  HugeRteAdapter,
  type HugeRteEditor,
  type HugeRteInitOptions,
  type HugeRteRuntime
} from "../../src/editor/HugeRteAdapter";
import { HUGERTE_VALID_ELEMENTS } from "../../src/security/AuthoringSanitizer";
import {
  HUGERTE_CONTENT_CSS,
  HUGERTE_INLINE_SKIN_CSS
} from "../../src/generated/hugerteSkin";

type Listener = () => void;

class FakeEditor implements HugeRteEditor {
  readonly contentDocument = document.implementation.createHTMLDocument("editor");
  readonly listeners = new Map<string, Set<Listener>>();
  readonly selection = { getNode: () => this.selectedNode };
  selectedNode: Node | null = this.contentDocument.body;
  html: string;
  focusCount = 0;
  removeCount = 0;

  constructor(readonly targetElm: HTMLElement, initialHtml: string) {
    this.html = initialHtml;
    this.contentDocument.body.innerHTML = initialHtml;
  }

  getContent(): string {
    return this.html;
  }

  setContent(html: string): void {
    this.html = html;
    this.contentDocument.body.innerHTML = html;
    this.emit("input");
    this.emit("change");
  }

  getDoc(): Document {
    return this.contentDocument;
  }

  focus(): void {
    this.focusCount += 1;
  }

  remove(): void {
    this.removeCount += 1;
  }

  on(events: string, listener: Listener): void {
    for (const event of events.split(/\s+/u)) {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }
  }

  off(events: string, listener: Listener): void {
    for (const event of events.split(/\s+/u)) {
      this.listeners.get(event)?.delete(listener);
    }
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0
    );
  }
}

class FakeRuntime implements HugeRteRuntime {
  options: HugeRteInitOptions | undefined;
  editors: FakeEditor[] = [];
  mode:
    | "single"
    | "zero"
    | "multiple"
    | "multi-setup"
    | "extra-setup"
    | "repeat-setup"
    | "mixed"
    | "unexpected"
    | "reject"
    | "deferred"
    | "deferred-multi-setup" = "single";
  rejection = new Error("init failed");
  private resolveDeferred: ((value: unknown) => void) | undefined;

  async init(options: HugeRteInitOptions): Promise<unknown> {
    this.options = options;
    const target = options.target;
    const initial = target instanceof HTMLTextAreaElement ? target.value : target.textContent ?? "";
    const editor = new FakeEditor(target, initial);
    this.editors = [editor];
    options.setup(editor);
    editor.emit("input");
    editor.emit("change");

    if (this.mode === "reject") throw this.rejection;
    if (this.mode === "zero") return [];
    if (this.mode === "multiple") {
      const second = new FakeEditor(target, initial);
      this.editors.push(second);
      return this.editors;
    }
    if (
      this.mode === "multi-setup" ||
      this.mode === "extra-setup" ||
      this.mode === "deferred-multi-setup"
    ) {
      const second = new FakeEditor(target, initial);
      this.editors.push(second);
      options.setup(second);
      if (this.mode === "extra-setup") return [editor];
      if (this.mode === "deferred-multi-setup") {
        return new Promise((resolve) => {
          this.resolveDeferred = resolve;
        });
      }
      return this.editors;
    }
    if (this.mode === "repeat-setup") {
      options.setup(editor);
      return [editor];
    }
    if (this.mode === "mixed") return [editor, { targetElm: target }];
    if (this.mode === "unexpected") {
      const wrongTarget = document.createElement("textarea");
      const unexpected = new FakeEditor(wrongTarget, initial);
      this.editors = [unexpected];
      return [unexpected];
    }
    if (this.mode === "deferred") {
      return new Promise((resolve) => {
        this.resolveDeferred = resolve;
      });
    }
    return [editor];
  }

  resolve(): void {
    this.resolveDeferred?.(this.editors);
  }
}

class CapturedSetupRuntime implements HugeRteRuntime {
  options: HugeRteInitOptions | undefined;
  private readonly pending: Promise<unknown>;
  private resolvePending: ((value: unknown) => void) | undefined;
  private rejectPending: ((reason: unknown) => void) | undefined;

  constructor() {
    this.pending = new Promise((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
    });
  }

  init(options: HugeRteInitOptions): Promise<unknown> {
    this.options = options;
    return this.pending;
  }

  resolve(value: unknown): void {
    this.resolvePending?.(value);
  }

  reject(reason: unknown): void {
    this.rejectPending?.(reason);
  }
}

function makeAdapter(runtime: HugeRteRuntime): HugeRteAdapter {
  return new HugeRteAdapter(async () => runtime);
}

function mountOptions(overrides: Partial<{ onChange(html: string): void; onSelectionChange(element: HTMLElement | null): void }> = {}) {
  return {
    documentBaseUrl: "app://vault/articles/",
    onChange: overrides.onChange ?? vi.fn(),
    ...(overrides.onSelectionChange
      ? { onSelectionChange: overrides.onSelectionChange }
      : {})
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-galley-hugerte-skin]").forEach((node) => node.remove());
});

describe("HugeRteAdapter configuration", () => {
  it("uses only bundled modules, inline styles, the shared policy, and the supplied base URL", async () => {
    const runtime = new FakeRuntime();
    const host = document.createElement("div");
    const adapter = makeAdapter(runtime);

    await adapter.mount(host, "<article><p>Initial</p></article>", mountOptions());

    expect(BUNDLED_HUGERTE_FEATURES).toEqual([
      "icons/default", "models/dom", "themes/silver", "plugins/advlist",
      "plugins/autolink", "plugins/link", "plugins/lists", "plugins/image",
      "plugins/table", "plugins/charmap"
    ]);
    expect(runtime.options).toMatchObject({
      target: host.querySelector("textarea"),
      skin: false,
      content_css: false,
      content_style: HUGERTE_CONTENT_CSS,
      promotion: false,
      branding: false,
      convert_urls: false,
      valid_elements: HUGERTE_VALID_ELEMENTS,
      document_base_url: "app://vault/articles/",
      plugins: "advlist autolink link lists image table charmap"
    });
    expect(runtime.options?.toolbar).toContain("undo redo");
    expect(runtime.options?.toolbar).toContain("blocks");
    expect(runtime.options?.toolbar).toContain("fontfamily fontsize");
    expect(runtime.options?.toolbar).toContain("forecolor backcolor");
    expect(runtime.options?.toolbar).toContain("bullist numlist");
    expect(runtime.options?.toolbar).toContain("link image table");
    expect(runtime.options?.toolbar).not.toMatch(/(?:^|\s)code(?:\s|$)/u);
    expect(runtime.options).not.toHaveProperty("external_plugins");
    expect(runtime.options).not.toHaveProperty("images_upload_url");
    expect(runtime.options).not.toHaveProperty("api_key");
    expect(runtime.editors[0]?.html).toBe("<article><p>Initial</p></article>");
    expect(document.head.querySelector("style[data-galley-hugerte-skin]")?.textContent)
      .toBe(HUGERTE_INLINE_SKIN_CSS);
    adapter.destroy();
  });

  it("loads the bundled runtime without retaining HugeRTE window globals", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    })));
    const hadHugerte = Object.prototype.hasOwnProperty.call(window, "hugerte");
    const hadHugeRte = Object.prototype.hasOwnProperty.call(window, "hugeRTE");
    const adapter = new HugeRteAdapter();
    const host = document.createElement("div");
    document.body.append(host);

    try {
      await adapter.mount(
        host,
        '<section data-galley-source="p-1" data-secret="no" onclick="x()">Bundled</section>',
        mountOptions()
      );

      expect(adapter.getHtml()).toContain('data-galley-source="p-1"');
      expect(adapter.getHtml()).not.toMatch(/data-secret|onclick/u);
      expect(Object.prototype.hasOwnProperty.call(window, "hugerte")).toBe(hadHugerte);
      expect(Object.prototype.hasOwnProperty.call(window, "hugeRTE")).toBe(hadHugeRte);
    } finally {
      adapter.destroy();
    }
  });
});

describe("HugeRteAdapter event bridge", () => {
  it("suppresses initialization/setHtml emissions and forwards user input, changes, undo, and redo", async () => {
    const runtime = new FakeRuntime();
    const onChange = vi.fn();
    const adapter = makeAdapter(runtime);
    await adapter.mount(document.createElement("div"), "<p>one</p>", mountOptions({ onChange }));
    const editor = runtime.editors[0]!;

    expect(onChange).not.toHaveBeenCalled();
    adapter.setHtml("<p>programmatic</p>");
    expect(adapter.getHtml()).toBe("<p>programmatic</p>");
    expect(onChange).not.toHaveBeenCalled();

    editor.html = "<p>user</p>";
    for (const event of ["input", "change", "Undo", "Redo"]) editor.emit(event);
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith("<p>user</p>");
    adapter.destroy();
  });

  it("returns selection elements only from the editor content document", async () => {
    const runtime = new FakeRuntime();
    const onSelectionChange = vi.fn();
    const adapter = makeAdapter(runtime);
    await adapter.mount(document.createElement("div"), "<p>one</p>", mountOptions({ onSelectionChange }));
    const editor = runtime.editors[0]!;
    const paragraph = editor.contentDocument.querySelector("p")!;

    editor.selectedNode = paragraph;
    editor.emit("NodeChange");
    editor.selectedNode = document.createElement("p");
    editor.emit("SelectionChange");
    editor.selectedNode = editor.contentDocument.createTextNode("text");
    editor.emit("NodeChange");

    expect(onSelectionChange.mock.calls).toEqual([[paragraph], [null], [null]]);
    adapter.destroy();
  });
});

describe("HugeRteAdapter lifecycle", () => {
  it("keeps the last setHtml while the runtime loader is pending without emitting changes", async () => {
    const runtime = new FakeRuntime();
    const onChange = vi.fn();
    let releaseRuntime: ((runtime: HugeRteRuntime) => void) | undefined;
    const runtimePending = new Promise<HugeRteRuntime>((resolve) => {
      releaseRuntime = resolve;
    });
    const adapter = new HugeRteAdapter(() => runtimePending);
    const mounting = adapter.mount(
      document.createElement("div"),
      "<p>old</p>",
      mountOptions({ onChange })
    );

    adapter.setHtml("<p>newer</p>");
    adapter.setHtml("<p>newest</p>");
    expect(adapter.getHtml()).toBe("<p>newest</p>");
    releaseRuntime?.(runtime);
    await mounting;

    expect(runtime.editors[0]?.html).toBe("<p>newest</p>");
    expect(adapter.getHtml()).toBe("<p>newest</p>");
    expect(onChange).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it("keeps pending setHtml in the real bundled runtime without emitting changes", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    })));
    const warmup = new HugeRteAdapter();
    const warmupHost = document.createElement("div");
    document.body.append(warmupHost);
    await warmup.mount(warmupHost, "<p>warmup</p>", mountOptions());
    warmup.destroy();

    const realRuntime = (await import("hugerte")).default as unknown as HugeRteRuntime;
    let realEditor: HugeRteEditor | undefined;
    const observedRuntime: HugeRteRuntime = {
      async init(options): Promise<unknown> {
        const result = await realRuntime.init(options);
        realEditor = Array.isArray(result) ? result[0] as HugeRteEditor : undefined;
        return result;
      }
    };
    let releaseRuntime: ((runtime: HugeRteRuntime) => void) | undefined;
    const runtimePending = new Promise<HugeRteRuntime>((resolve) => {
      releaseRuntime = resolve;
    });
    const onChange = vi.fn();
    const adapter = new HugeRteAdapter(() => runtimePending);
    const host = document.createElement("div");
    document.body.append(host);

    try {
      const mounting = adapter.mount(host, "<p>old</p>", mountOptions({ onChange }));
      adapter.setHtml("<p>new</p>");
      releaseRuntime?.(observedRuntime);
      await mounting;

      expect(realEditor?.getContent()).toBe("<p>new</p>");
      expect(adapter.getHtml()).toBe("<p>new</p>");
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      adapter.destroy();
    }
  });

  it("syncs the last setHtml after init has consumed the target without emitting changes", async () => {
    const runtime = new FakeRuntime();
    runtime.mode = "deferred";
    const onChange = vi.fn();
    const adapter = makeAdapter(runtime);
    const mounting = adapter.mount(
      document.createElement("div"),
      "<p>old</p>",
      mountOptions({ onChange })
    );

    await vi.waitFor(() => expect(runtime.options).toBeDefined());
    expect(runtime.editors[0]?.html).toBe("<p>old</p>");
    adapter.setHtml("<p>newer</p>");
    adapter.setHtml("<p>newest</p>");
    runtime.resolve();
    await mounting;

    expect(runtime.editors[0]?.html).toBe("<p>newest</p>");
    expect(adapter.getHtml()).toBe("<p>newest</p>");
    expect(onChange).not.toHaveBeenCalled();
    adapter.destroy();
  });

  it("rejects zero, multiple, unexpected, and rejected init results and cleans partial state", async () => {
    for (const mode of ["zero", "multiple", "mixed", "unexpected", "reject"] as const) {
      const runtime = new FakeRuntime();
      runtime.mode = mode;
      const host = document.createElement("div");
      const sibling = document.createElement("span");
      host.append(sibling);
      const adapter = makeAdapter(runtime);

      await expect(adapter.mount(host, "<p>one</p>", mountOptions())).rejects.toBeTruthy();
      expect([...host.childNodes]).toEqual(expect.arrayContaining([sibling]));
      expect(host.querySelector("textarea")).toBeNull();
      expect(document.head.querySelector("style[data-galley-hugerte-skin]")).toBeNull();
      expect(runtime.editors.every((editor) => editor.removeCount === 1)).toBe(true);
    }
  });

  it("detaches listeners and removes every editor when multiple editors run setup", async () => {
    const runtime = new FakeRuntime();
    runtime.mode = "multi-setup";
    const adapter = makeAdapter(runtime);

    await expect(
      adapter.mount(document.createElement("div"), "<p>one</p>", mountOptions())
    ).rejects.toMatchObject({ code: "editor_init_invalid" });

    expect(runtime.editors.map((editor) => editor.listenerCount())).toEqual([0, 0]);
    expect(runtime.editors.map((editor) => editor.removeCount)).toEqual([1, 1]);
  });

  it("fails closed for omitted, extra, and repeated setup editors", async () => {
    for (const mode of ["zero", "extra-setup", "repeat-setup"] as const) {
      const runtime = new FakeRuntime();
      runtime.mode = mode;
      const adapter = makeAdapter(runtime);

      await expect(
        adapter.mount(document.createElement("div"), "<p>one</p>", mountOptions())
      ).rejects.toMatchObject({ code: "editor_init_invalid" });

      expect(runtime.editors.every((editor) => editor.listenerCount() === 0)).toBe(true);
      expect(runtime.editors.every((editor) => editor.removeCount === 1)).toBe(true);
    }
  });

  it("cleans every setup editor when destroy races a malformed multiple init", async () => {
    const runtime = new FakeRuntime();
    runtime.mode = "deferred-multi-setup";
    const adapter = makeAdapter(runtime);
    const mounting = adapter.mount(
      document.createElement("div"),
      "<p>one</p>",
      mountOptions()
    );

    await vi.waitFor(() => expect(runtime.editors).toHaveLength(2));
    adapter.destroy();
    runtime.resolve();

    await expect(mounting).rejects.toMatchObject({ code: "editor_mount_cancelled" });
    expect(runtime.editors.map((editor) => editor.listenerCount())).toEqual([0, 0]);
    expect(runtime.editors.map((editor) => editor.removeCount)).toEqual([1, 1]);
  });

  it("removes single, multiple, and repeated late setup editors without waiting for init", async () => {
    const runtime = new CapturedSetupRuntime();
    const host = document.createElement("div");
    const adapter = makeAdapter(runtime);
    const mounting = adapter.mount(host, "<p>one</p>", mountOptions());

    await vi.waitFor(() => expect(runtime.options).toBeDefined());
    adapter.destroy();
    const first = new FakeEditor(runtime.options!.target, "<p>late one</p>");
    runtime.options!.setup(first);
    expect(first.listenerCount()).toBe(0);
    expect(first.removeCount).toBe(1);

    const second = new FakeEditor(runtime.options!.target, "<p>late two</p>");
    runtime.options!.setup(second);
    runtime.options!.setup(first);

    expect([first.listenerCount(), second.listenerCount()]).toEqual([0, 0]);
    expect([first.removeCount, second.removeCount]).toEqual([1, 1]);
    expect(host.querySelector("textarea")).toBeNull();
    expect(document.head.querySelector("style[data-galley-hugerte-skin]")).toBeNull();
    void mounting;
  });

  it("rejects repeated and new late setup after destroying an already-bound editor", async () => {
    const runtime = new CapturedSetupRuntime();
    const adapter = makeAdapter(runtime);
    const mounting = adapter.mount(
      document.createElement("div"),
      "<p>one</p>",
      mountOptions()
    );

    await vi.waitFor(() => expect(runtime.options).toBeDefined());
    const bound = new FakeEditor(runtime.options!.target, "<p>bound</p>");
    runtime.options!.setup(bound);
    expect(bound.listenerCount()).toBe(7);

    adapter.destroy();
    runtime.options!.setup(bound);
    const late = new FakeEditor(runtime.options!.target, "<p>late</p>");
    runtime.options!.setup(late);

    expect([bound.listenerCount(), late.listenerCount()]).toEqual([0, 0]);
    expect([bound.removeCount, late.removeCount]).toEqual([1, 1]);
    void mounting;
  });

  it("keeps late setup cleanup idempotent when cancelled init later resolves or rejects", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const runtime = new CapturedSetupRuntime();
      const onChange = vi.fn();
      const adapter = makeAdapter(runtime);
      const mounting = adapter.mount(
        document.createElement("div"),
        "<p>one</p>",
        mountOptions({ onChange })
      );

      await vi.waitFor(() => expect(runtime.options).toBeDefined());
      adapter.destroy();
      const late = new FakeEditor(runtime.options!.target, "<p>late</p>");
      runtime.options!.setup(late);
      if (outcome === "resolve") runtime.resolve([late]);
      else runtime.reject(new Error("late init rejection"));

      await expect(mounting).rejects.toMatchObject({ code: "editor_mount_cancelled" });
      late.emit("input");
      expect(late.listenerCount()).toBe(0);
      expect(late.removeCount).toBe(1);
      expect(onChange).not.toHaveBeenCalled();
    }
  });

  it("cancels and cleans an exact editor when destroyed during asynchronous mount", async () => {
    const runtime = new FakeRuntime();
    runtime.mode = "deferred";
    const host = document.createElement("div");
    const onChange = vi.fn();
    const adapter = makeAdapter(runtime);
    const mounting = adapter.mount(host, "<p>one</p>", mountOptions({ onChange }));

    await vi.waitFor(() => expect(runtime.options).toBeDefined());
    adapter.setHtml("<p>pending</p>");
    adapter.destroy();
    adapter.setHtml("<p>after destroy</p>");
    runtime.resolve();

    await expect(mounting).rejects.toMatchObject({ code: "editor_mount_cancelled" });
    expect(adapter.getHtml()).toBe("<p>after destroy</p>");
    expect(onChange).not.toHaveBeenCalled();
    expect(runtime.editors[0]?.removeCount).toBe(1);
    expect(host.querySelector("textarea")).toBeNull();
    expect(document.head.querySelector("style[data-galley-hugerte-skin]")).toBeNull();
  });

  it("rejects duplicate mount, detaches callbacks, focuses, and destroys repeatedly", async () => {
    const runtime = new FakeRuntime();
    const onChange = vi.fn();
    const adapter = makeAdapter(runtime);
    const host = document.createElement("div");
    const options = mountOptions({ onChange });
    await adapter.mount(host, "<p>one</p>", options);

    await expect(adapter.mount(host, "<p>two</p>", options)).rejects.toMatchObject({
      code: "editor_already_mounted"
    });
    adapter.focus();
    expect(runtime.editors[0]?.focusCount).toBe(1);
    adapter.destroy();
    adapter.destroy();
    runtime.editors[0]?.emit("input");
    expect(onChange).not.toHaveBeenCalled();
    expect(runtime.editors[0]?.removeCount).toBe(1);
    expect(
      [...(runtime.editors[0]?.listeners.values() ?? [])].every(
        (listeners) => listeners.size === 0
      )
    ).toBe(true);
  });

  it("reference-counts the shared UI skin across simultaneous adapters", async () => {
    const firstRuntime = new FakeRuntime();
    const secondRuntime = new FakeRuntime();
    const first = makeAdapter(firstRuntime);
    const second = makeAdapter(secondRuntime);

    await first.mount(document.createElement("div"), "<p>one</p>", mountOptions());
    await second.mount(document.createElement("div"), "<p>two</p>", mountOptions());
    expect(document.head.querySelectorAll("style[data-galley-hugerte-skin]")).toHaveLength(1);

    first.destroy();
    expect(document.head.querySelectorAll("style[data-galley-hugerte-skin]")).toHaveLength(1);
    second.destroy();
    expect(document.head.querySelectorAll("style[data-galley-hugerte-skin]")).toHaveLength(0);
  });
});
