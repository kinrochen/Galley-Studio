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

interface EditorBinding {
  setupCount: number;
  policyListener: () => void;
  changeListener: () => void;
  selectionListener: () => void;
  policyDetached: boolean;
  changeDetached: boolean;
  selectionDetached: boolean;
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
  private mountToken: MountToken | undefined;
  private releaseSkin: (() => void) | undefined;
  private suppressChanges = true;
  private pendingHtmlWrite = false;
  private readonly editorBindings = new Map<HugeRteEditor, EditorBinding>();
  private readonly pendingCleanupEditors = new Set<HugeRteEditor>();
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
        this.bindEditor(editor, options, token);
      }));
      this.throwIfCancelled(token);

      const editors = editorCandidates(initResult);
      const editor =
        Array.isArray(initResult) &&
        initResult.length === 1 &&
        editors.length === 1
          ? editors[0]
          : undefined;
      const binding = editor ? this.editorBindings.get(editor) : undefined;
      if (
        !editor ||
        this.editorBindings.size !== 1 ||
        binding?.setupCount !== 1 ||
        editor.targetElm !== target
      ) {
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
      token.cancelled = true;
      this.phase = "destroyed";
      this.removeEditors([
        ...editorCandidates(initResult),
        ...this.editorBindings.keys()
      ]);
      this.cleanupOwnedMount();
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
    const mountedEditor = this.phase === "mounted" ? this.editor : undefined;
    if (this.mountToken) {
      this.mountToken.cancelled = true;
    }
    this.phase = "destroyed";
    if (mountedEditor) {
      try {
        this.html = mountedEditor.getContent();
      } catch {
        // Teardown must not be blocked by an optional final content snapshot.
      }
    }
    this.removeEditors([
      ...(this.editor ? [this.editor] : []),
      ...this.editorBindings.keys(),
      ...this.pendingCleanupEditors
    ]);
    this.cleanupOwnedMount();
  }

  private bindEditor(
    editor: HugeRteEditor,
    options: HtmlEditorMountOptions,
    token: MountToken
  ): void {
    if (
      token.cancelled ||
      this.mountToken !== token ||
      this.phase !== "mounting"
    ) {
      this.removeEditors([editor]);
      return;
    }
    const existing = this.editorBindings.get(editor);
    if (existing) {
      existing.setupCount += 1;
      return;
    }
    const policyListener = (): void => installDataAttributeFilters(editor);
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
    this.editorBindings.set(editor, {
      setupCount: 1,
      policyListener,
      changeListener,
      selectionListener,
      policyDetached: false,
      changeDetached: false,
      selectionDetached: false
    });
    editor.on("PreInit", policyListener);
    editor.on(CHANGE_EVENTS, changeListener);
    editor.on(SELECTION_EVENTS, selectionListener);
  }

  private removeEditors(editors: Iterable<HugeRteEditor>): void {
    for (const editor of new Set(editors)) {
      this.pendingCleanupEditors.add(editor);
      this.removeEditor(editor);
    }
  }

  private removeEditor(editor: HugeRteEditor): void {
    const binding = this.editorBindings.get(editor);
    if (binding) {
      if (!binding.policyDetached) {
        try {
          editor.off("PreInit", binding.policyListener);
          binding.policyDetached = true;
        } catch {
          // Retry only this unconfirmed listener detachment on a later destroy.
        }
      }
      if (!binding.changeDetached) {
        try {
          editor.off(CHANGE_EVENTS, binding.changeListener);
          binding.changeDetached = true;
        } catch {
          // Retry only this unconfirmed listener detachment on a later destroy.
        }
      }
      if (!binding.selectionDetached) {
        try {
          editor.off(SELECTION_EVENTS, binding.selectionListener);
          binding.selectionDetached = true;
        } catch {
          // Retry only this unconfirmed listener detachment on a later destroy.
        }
      }
      if (
        binding.policyDetached &&
        binding.changeDetached &&
        binding.selectionDetached
      ) {
        this.editorBindings.delete(editor);
      }
    }
    if (!this.removedEditors.has(editor)) {
      try {
        editor.remove();
        this.removedEditors.add(editor);
      } catch {
        // An unconfirmed removal remains pending for a later destroy/setup call.
      }
    }
    if (
      this.removedEditors.has(editor) &&
      !this.editorBindings.has(editor)
    ) {
      this.pendingCleanupEditors.delete(editor);
    }
  }

  private cleanupOwnedMount(): void {
    const target = this.target;
    if (target) {
      try {
        target.remove();
        if (this.target === target) this.target = undefined;
      } catch {
        // Keep the target reference so a later destroy can retry its removal.
      }
    }
    this.editor = undefined;
    this.pendingHtmlWrite = false;
    this.mountToken = undefined;
    const releaseSkin = this.releaseSkin;
    if (releaseSkin) {
      try {
        releaseSkin();
        if (this.releaseSkin === releaseSkin) this.releaseSkin = undefined;
      } catch {
        // Keep the release callback so a later destroy can retry it.
      }
    }
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
    const current = sharedSkins.get(document);
    if (current !== shared) {
      released = true;
      return;
    }
    if (current.count > 1) {
      current.count -= 1;
      released = true;
      return;
    }
    current.style.remove();
    current.count = 0;
    sharedSkins.delete(document);
    released = true;
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
