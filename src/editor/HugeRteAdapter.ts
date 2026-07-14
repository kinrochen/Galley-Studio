import {
  HUGERTE_CONTENT_CSS,
  HUGERTE_INLINE_SKIN_CSS
} from "../generated/hugerteSkin";
import { HUGERTE_VALID_ELEMENTS } from "../security/AuthoringSanitizer";
import {
  EditorLifecycleError,
  type HtmlEditorAdapter,
  type HtmlEditorMountOptions
} from "./HtmlEditorAdapter";

export const BUNDLED_HUGERTE_FEATURES = [
  "icons/default",
  "models/dom",
  "themes/silver",
  "plugins/advlist",
  "plugins/autolink",
  "plugins/link",
  "plugins/lists",
  "plugins/image",
  "plugins/table",
  "plugins/charmap"
] as const;

const CHANGE_EVENTS = "input change Undo Redo";
const SELECTION_EVENTS = "NodeChange SelectionChange";
const ALLOWED_DATA_ATTRIBUTES = new Set([
  "data-galley-source",
  "data-galley-role",
  "data-galley-slot"
]);
const HUGERTE_BODY_ELEMENT_NAMES = HUGERTE_VALID_ELEMENTS
  .split(",")
  .slice(1)
  .map((rule) => rule.split("[", 1)[0])
  .filter((name): name is string => Boolean(name))
  .join(",");
const TOOLBAR = [
  "undo redo",
  "blocks fontfamily fontsize",
  "bold italic underline forecolor backcolor",
  "alignleft aligncenter alignright alignjustify",
  "bullist numlist",
  "link image table"
].join(" | ");

export interface HugeRteEditor {
  readonly targetElm: HTMLElement;
  readonly selection: { getNode(): Node | null };
  readonly parser?: HugeRteParser;
  readonly serializer?: HugeRteParser;
  getContent(): string;
  setContent(html: string): unknown;
  getDoc(): Document;
  focus(): void;
  remove(): void;
  on(events: string, listener: () => void): void;
  off(events: string, listener: () => void): void;
}

interface HugeRteAstNode {
  readonly attributes?: { readonly map: Record<string, string> };
  attr(name: string, value: null): unknown;
}

interface HugeRteParser {
  addNodeFilter(
    names: string,
    callback: (nodes: HugeRteAstNode[]) => void
  ): void;
}

export interface HugeRteInitOptions {
  target: HTMLElement;
  skin: false;
  content_css: false;
  content_style: string;
  promotion: false;
  branding: false;
  convert_urls: false;
  valid_elements: string;
  document_base_url: string;
  plugins: string;
  toolbar: string;
  setup(editor: HugeRteEditor): void;
  [name: string]: unknown;
}

export interface HugeRteRuntime {
  init(options: HugeRteInitOptions): Promise<unknown>;
}

export type HugeRteRuntimeLoader = () => Promise<HugeRteRuntime>;

interface MountToken {
  cancelled: boolean;
}

interface SharedSkin {
  count: number;
  style: HTMLStyleElement;
}

const sharedSkins = new WeakMap<Document, SharedSkin>();
let bundledRuntimePromise: Promise<HugeRteRuntime> | undefined;

export class HugeRteAdapter implements HtmlEditorAdapter {
  private phase: "idle" | "mounting" | "mounted" | "destroyed" = "idle";
  private html = "";
  private target: HTMLTextAreaElement | undefined;
  private editor: HugeRteEditor | undefined;
  private setupEditor: HugeRteEditor | undefined;
  private mountToken: MountToken | undefined;
  private releaseSkin: (() => void) | undefined;
  private policyListener: (() => void) | undefined;
  private changeListener: (() => void) | undefined;
  private selectionListener: (() => void) | undefined;
  private suppressChanges = true;
  private pendingHtmlWrite = false;
  private readonly removedEditors = new WeakSet<object>();

  constructor(private readonly runtimeLoader: HugeRteRuntimeLoader = loadBundledRuntime) {}

  async mount(
    container: HTMLElement,
    bodyHtml: string,
    options: HtmlEditorMountOptions
  ): Promise<void> {
    if (this.phase !== "idle") {
      throw new EditorLifecycleError(
        "editor_already_mounted",
        "This visual editor has already been mounted"
      );
    }

    this.phase = "mounting";
    this.html = bodyHtml;
    this.suppressChanges = true;
    this.pendingHtmlWrite = false;
    const token: MountToken = { cancelled: false };
    this.mountToken = token;
    const target = container.ownerDocument.createElement("textarea");
    target.className = "galley-hugerte-target";
    target.value = bodyHtml;
    container.append(target);
    this.target = target;
    this.releaseSkin = acquireSharedSkin(container.ownerDocument);

    let initResult: unknown;
    try {
      const runtime = await this.runtimeLoader();
      this.throwIfCancelled(token);
      initResult = await runtime.init(createInitOptions(target, options, (editor) => {
        this.bindEditor(editor, options);
      }));
      this.throwIfCancelled(token);

      const editors = editorCandidates(initResult);
      const editor =
        Array.isArray(initResult) &&
        initResult.length === 1 &&
        editors.length === 1
          ? editors[0]
          : undefined;
      if (
        !editor ||
        editor !== this.setupEditor ||
        editor.targetElm !== target
      ) {
        for (const candidate of editors) this.removeEditor(candidate);
        throw new EditorLifecycleError(
          "editor_init_invalid",
          "HugeRTE did not return exactly the editor mounted for Galley's target"
        );
      }

      this.editor = editor;
      if (this.pendingHtmlWrite) {
        editor.setContent(this.html);
        this.throwIfCancelled(token);
      }
      this.html = editor.getContent();
      this.pendingHtmlWrite = false;
      this.phase = "mounted";
      this.suppressChanges = false;
    } catch (error) {
      const cancelled = token.cancelled;
      for (const candidate of editorCandidates(initResult)) this.removeEditor(candidate);
      if (this.setupEditor) this.removeEditor(this.setupEditor);
      this.cleanupOwnedMount();
      this.phase = "destroyed";
      if (cancelled) {
        throw new EditorLifecycleError(
          "editor_mount_cancelled",
          "HugeRTE mount was cancelled by destruction"
        );
      }
      throw error;
    }
  }

  getHtml(): string {
    if (this.phase === "mounted" && this.editor) {
      this.html = this.editor.getContent();
    }
    return this.html;
  }

  setHtml(html: string): void {
    this.html = html;
    if (this.phase !== "mounted" || !this.editor) {
      if (this.phase === "mounting") {
        this.pendingHtmlWrite = true;
        if (this.target) this.target.value = html;
      }
      return;
    }
    this.suppressChanges = true;
    try {
      this.editor.setContent(html);
    } finally {
      this.suppressChanges = false;
    }
  }

  focus(): void {
    if (this.phase === "mounted") {
      this.editor?.focus();
    }
  }

  destroy(): void {
    if (this.phase === "destroyed") {
      return;
    }
    if (this.phase === "mounted" && this.editor) {
      this.html = this.editor.getContent();
    }
    if (this.mountToken) {
      this.mountToken.cancelled = true;
    }
    if (this.editor) this.removeEditor(this.editor);
    if (this.setupEditor) this.removeEditor(this.setupEditor);
    this.cleanupOwnedMount();
    this.phase = "destroyed";
  }

  private bindEditor(editor: HugeRteEditor, options: HtmlEditorMountOptions): void {
    this.setupEditor = editor;
    const policyListener = (): void => installDataAttributeFilters(editor);
    this.policyListener = policyListener;
    editor.on("PreInit", policyListener);
    const changeListener = (): void => {
      if (
        this.phase !== "mounted" ||
        this.editor !== editor ||
        this.suppressChanges
      ) {
        return;
      }
      this.html = editor.getContent();
      options.onChange(this.html);
    };
    const selectionListener = (): void => {
      if (this.phase !== "mounted" || this.editor !== editor) {
        return;
      }
      const node = editor.selection.getNode();
      const editorDocument = editor.getDoc();
      const element =
        node?.nodeType === Node.ELEMENT_NODE &&
        node.ownerDocument === editorDocument
          ? node as HTMLElement
          : null;
      options.onSelectionChange?.(element);
    };
    this.changeListener = changeListener;
    this.selectionListener = selectionListener;
    editor.on(CHANGE_EVENTS, changeListener);
    editor.on(SELECTION_EVENTS, selectionListener);
  }

  private removeEditor(editor: HugeRteEditor): void {
    if (this.removedEditors.has(editor)) {
      return;
    }
    this.removedEditors.add(editor);
    if (editor === this.setupEditor) {
      if (this.policyListener) editor.off("PreInit", this.policyListener);
      if (this.changeListener) editor.off(CHANGE_EVENTS, this.changeListener);
      if (this.selectionListener) editor.off(SELECTION_EVENTS, this.selectionListener);
    }
    editor.remove();
  }

  private cleanupOwnedMount(): void {
    this.target?.remove();
    this.target = undefined;
    this.editor = undefined;
    this.setupEditor = undefined;
    this.policyListener = undefined;
    this.changeListener = undefined;
    this.selectionListener = undefined;
    this.pendingHtmlWrite = false;
    this.mountToken = undefined;
    this.releaseSkin?.();
    this.releaseSkin = undefined;
  }

  private throwIfCancelled(token: MountToken): void {
    if (token.cancelled || this.phase === "destroyed") {
      throw new EditorLifecycleError(
        "editor_mount_cancelled",
        "HugeRTE mount was cancelled by destruction"
      );
    }
  }
}

function installDataAttributeFilters(editor: HugeRteEditor): void {
  const filter = (nodes: HugeRteAstNode[]): void => {
    for (const node of nodes) {
      for (const name of Object.keys(node.attributes?.map ?? {})) {
        if (name.startsWith("data-") && !ALLOWED_DATA_ATTRIBUTES.has(name)) {
          node.attr(name, null);
        }
      }
    }
  };
  editor.parser?.addNodeFilter(HUGERTE_BODY_ELEMENT_NAMES, filter);
  editor.serializer?.addNodeFilter(HUGERTE_BODY_ELEMENT_NAMES, filter);
}

function createInitOptions(
  target: HTMLTextAreaElement,
  options: HtmlEditorMountOptions,
  setup: (editor: HugeRteEditor) => void
): HugeRteInitOptions {
  return {
    target,
    skin: false,
    content_css: false,
    content_style: HUGERTE_CONTENT_CSS,
    promotion: false,
    branding: false,
    convert_urls: false,
    relative_urls: false,
    remove_script_host: false,
    document_base_url: options.documentBaseUrl,
    valid_elements: HUGERTE_VALID_ELEMENTS,
    plugins: "advlist autolink link lists image table charmap",
    icons: "default",
    model: "dom",
    theme: "silver",
    menubar: false,
    toolbar: TOOLBAR,
    toolbar_mode: "wrap",
    automatic_uploads: false,
    paste_data_images: false,
    images_replace_blob_uris: false,
    language_load: false,
    allow_html_data_urls: false,
    allow_script_urls: false,
    allow_svg_data_urls: false,
    allow_unsafe_link_target: false,
    convert_unsafe_embeds: true,
    custom_colors: false,
    color_map: [
      "111827", "Ink", "374151", "Slate", "DC2626", "Red",
      "D97706", "Amber", "059669", "Green", "2563EB", "Blue",
      "7C3AED", "Violet", "FFFFFF", "White"
    ],
    font_family_formats:
      'Inter=Inter,"Noto Sans SC","Noto Sans",sans-serif;' +
      'Noto Sans SC="Noto Sans SC","Noto Sans",sans-serif;' +
      'Noto Sans="Noto Sans",sans-serif',
    setup
  };
}

function editorCandidates(value: unknown): HugeRteEditor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isHugeRteEditor);
}

function isHugeRteEditor(value: unknown): value is HugeRteEditor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<HugeRteEditor>;
  return (
    candidate.targetElm?.nodeType === Node.ELEMENT_NODE &&
    typeof candidate.getContent === "function" &&
    typeof candidate.setContent === "function" &&
    typeof candidate.getDoc === "function" &&
    typeof candidate.focus === "function" &&
    typeof candidate.remove === "function" &&
    typeof candidate.on === "function" &&
    typeof candidate.off === "function"
  );
}

function acquireSharedSkin(document: Document): () => void {
  let shared = sharedSkins.get(document);
  if (!shared) {
    const style = document.createElement("style");
    style.setAttribute("data-galley-hugerte-skin", "");
    style.textContent = HUGERTE_INLINE_SKIN_CSS;
    document.head.append(style);
    shared = { count: 0, style };
    sharedSkins.set(document, shared);
  } else if (!shared.style.isConnected) {
    document.head.append(shared.style);
  }
  shared.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = sharedSkins.get(document);
    if (current !== shared) return;
    current.count -= 1;
    if (current.count === 0) {
      current.style.remove();
      sharedSkins.delete(document);
    }
  };
}

function loadBundledRuntime(): Promise<HugeRteRuntime> {
  if (!bundledRuntimePromise) {
    const pending = importBundledRuntime();
    bundledRuntimePromise = pending;
    void pending.catch(() => {
      if (bundledRuntimePromise === pending) bundledRuntimePromise = undefined;
    });
  }
  return bundledRuntimePromise;
}

async function importBundledRuntime(): Promise<HugeRteRuntime> {
  const globalWindow: object = window;
  const hugerteGlobal = snapshotProperty(globalWindow, "hugerte");
  const hugeRteGlobal = snapshotProperty(globalWindow, "hugeRTE");
  try {
    const core = await import("hugerte");
    await Promise.all([
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/icons/default"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/models/dom"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/themes/silver"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/advlist"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/autolink"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/link"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/lists"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/image"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/table"),
      // @ts-expect-error HugeRTE side-effect entry points do not publish declarations.
      import("hugerte/plugins/charmap")
    ]);
    return core.default as unknown as HugeRteRuntime;
  } finally {
    restoreProperty(globalWindow, "hugerte", hugerteGlobal);
    restoreProperty(globalWindow, "hugeRTE", hugeRteGlobal);
  }
}

interface PropertySnapshot {
  existed: boolean;
  value: unknown;
}

function snapshotProperty(target: object, name: string): PropertySnapshot {
  return {
    existed: Object.prototype.hasOwnProperty.call(target, name),
    value: Reflect.get(target, name)
  };
}

function restoreProperty(
  target: object,
  name: string,
  snapshot: PropertySnapshot
): void {
  if (snapshot.existed) {
    Reflect.set(target, name, snapshot.value);
  } else {
    Reflect.deleteProperty(target, name);
  }
}
