import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
  MAX_REFERENCE_IMAGE_BYTES,
  type ReferenceImageInput
} from "./ReferenceImage";
import type {
  ThemeDraft,
  ThemeGenerationInput
} from "./ThemeGenerationService";
import { ThemePreview } from "./ThemePreview";
import {
  ENGLISH_LOCALIZED_TEXT,
  translateMessage,
  type LocalizedMessage,
  type LocalizedText
} from "../i18n/LocalizedText";
import type { MessageKey } from "../i18n/Resources";

export const GALLEY_THEME_LAB_VIEW_TYPE = "galley-theme-lab";

export interface ThemeLabViewServices {
  supportsVision(): Promise<boolean>;
  generate(
    input: ThemeGenerationInput,
    signal: AbortSignal
  ): Promise<ThemeDraft>;
  save(draft: ThemeDraft): Promise<void>;
  report(message: string): void;
  readonly locale?: LocalizedText;
}

export class ThemeLabView extends ItemView {
  readonly #preview = new ThemePreview();
  #controller: AbortController | null = null;
  #draft: ThemeDraft | null = null;
  #closed = false;
  readonly #text: LocalizedText;
  #unsubscribeLocale: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly services: ThemeLabViewServices
  ) {
    super(leaf);
    this.#text = services.locale ?? ENGLISH_LOCALIZED_TEXT;
  }

  getViewType(): string {
    return GALLEY_THEME_LAB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.#text.t("themeLab.title");
  }

  async onOpen(): Promise<void> {
    this.#closed = false;
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("galley-theme-lab");

    const title = document.createElement("h2");
    title.textContent = this.#text.t("themeLab.title");
    const description = document.createElement("textarea");
    description.className = "galley-theme-lab__description";
    description.placeholder = this.#text.t("themeLab.description.placeholder");
    description.setAttribute("aria-label", this.#text.t("themeLab.description.aria"));

    let imageInput: HTMLInputElement | null = null;
    if (await this.services.supportsVision()) {
      imageInput = document.createElement("input");
      imageInput.type = "file";
      imageInput.accept = "image/png,image/jpeg,image/webp";
      imageInput.setAttribute("aria-label", this.#text.t("themeLab.image.aria"));
    }

    const actions = document.createElement("div");
    actions.className = "galley-theme-lab__actions";
    const generateButton = document.createElement("button");
    generateButton.textContent = this.#text.t("themeLab.generate");
    const saveButton = document.createElement("button");
    saveButton.textContent = this.#text.t("themeLab.save");
    saveButton.disabled = true;
    actions.append(generateButton, saveButton);

    const status = document.createElement("div");
    status.className = "galley-theme-lab__status";
    status.setAttribute("role", "status");
    const issues = document.createElement("ul");
    issues.className = "galley-theme-lab__issues";
    const previewHost = document.createElement("div");
    previewHost.className = "galley-theme-lab__preview";

    this.contentEl.append(title, description);
    if (imageInput) this.contentEl.append(imageInput);
    this.contentEl.append(actions, status, issues, previewHost);

    let statusMessage: LocalizedMessage | null = null;
    const renderIssues = (draft: ThemeDraft | null): void => {
      issues.replaceChildren();
      for (const issue of draft?.validation.issues ?? []) {
        const item = document.createElement("li");
        item.textContent = localizedThemeIssue(issue.code, this.#text);
        item.dataset.severity = issue.severity;
        issues.append(item);
      }
    };
    const setStatus = (key: MessageKey): void => {
      statusMessage = { key };
      status.textContent = translateMessage(this.#text, statusMessage);
    };
    const updateChrome = (): void => {
      title.textContent = this.#text.t("themeLab.title");
      description.placeholder = this.#text.t("themeLab.description.placeholder");
      description.setAttribute("aria-label", this.#text.t("themeLab.description.aria"));
      imageInput?.setAttribute("aria-label", this.#text.t("themeLab.image.aria"));
      generateButton.textContent = this.#text.t("themeLab.generate");
      saveButton.textContent = this.#text.t("themeLab.save");
      if (statusMessage) {
        status.textContent = translateMessage(this.#text, statusMessage);
      }
      renderIssues(this.#draft);
      const frame = previewHost.querySelector("iframe");
      if (frame) frame.title = this.#text.t("themeLab.preview.title");
    };
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = this.#text.subscribe(updateChrome);

    generateButton.addEventListener("click", () => {
      this.#controller?.abort();
      const controller = new AbortController();
      this.#controller = controller;
      this.#draft = null;
      saveButton.disabled = true;
      issues.replaceChildren();
      setStatus("themeLab.status.generating");
      generateButton.disabled = true;
      void (async () => {
        try {
          const referenceImage = imageInput
            ? await selectedImage(imageInput)
            : undefined;
          const input: ThemeGenerationInput = {
            description: description.value,
            ...(referenceImage ? { referenceImage } : {})
          };
          const draft = await this.services.generate(input, controller.signal);
          if (this.#closed || controller.signal.aborted || this.#controller !== controller) return;
          this.#draft = draft;
          this.#preview.render(
            previewHost,
            draft.previewHtml,
            this.#text.t("themeLab.preview.title")
          );
          renderIssues(draft);
          saveButton.disabled = !draft.validation.valid;
          setStatus(
            draft.validation.valid
              ? "themeLab.status.valid"
              : "themeLab.status.invalid"
          );
        } catch (error) {
          if (!controller.signal.aborted && !this.#closed) {
            statusMessage = safeMessage(error);
            status.textContent = translateMessage(this.#text, statusMessage);
          }
        } finally {
          if (!this.#closed && this.#controller === controller) {
            generateButton.disabled = false;
          }
        }
      })();
    });

    saveButton.addEventListener("click", () => {
      const draft = this.#draft;
      if (!draft?.validation.valid) return;
      saveButton.disabled = true;
      void this.services.save(draft).then(
        () => {
          if (this.#closed) return;
          setStatus("themeLab.status.saved");
          this.services.report(
            this.#text.t("themeLab.notice.saved", { name: draft.manifest.name })
          );
        },
        (error: unknown) => {
          if (this.#closed) return;
          statusMessage = safeMessage(error);
          status.textContent = translateMessage(this.#text, statusMessage);
          saveButton.disabled = false;
        }
      );
    });
  }

  async onClose(): Promise<void> {
    this.#closed = true;
    this.#controller?.abort();
    this.#controller = null;
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
    this.#draft = null;
    this.contentEl.replaceChildren();
  }
}

async function selectedImage(
  input: HTMLInputElement
): Promise<ReferenceImageInput | undefined> {
  const file = input.files?.[0];
  if (!file) return undefined;
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("reference_image_too_large");
  }
  return {
    selected: true,
    name: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer())
  };
}

function safeMessage(error: unknown): LocalizedMessage {
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) return { key: "themeLab.status.cancelled" };
  if (error instanceof Error && error.message === "reference_image_too_large") {
    return { key: "themeLab.image.tooLarge" };
  }
  return { key: "themeLab.status.operationFailed" };
}

function localizedThemeIssue(code: string, text: LocalizedText): string {
  const keys: Readonly<Record<string, MessageKey>> = {
    component_design_variables: "themeLab.issue.designVariables",
    component_html: "themeLab.issue.componentHtml",
    component_template: "themeLab.issue.template",
    component_recipes: "themeLab.issue.recipes",
    component_mapping: "themeLab.issue.mapping",
    component_oversize: "themeLab.issue.oversize",
    component_html_missing: "themeLab.issue.htmlMissing",
    component_attribute: "themeLab.issue.forbiddenAttribute",
    component_white_space_pre: "themeLab.issue.whiteSpace",
    component_dashed_border: "themeLab.issue.dashedBorder",
    component_leaf: "themeLab.issue.leaf",
    preview_document: "themeLab.issue.previewDocument",
    preview_script: "themeLab.issue.previewScript",
    preview_event_handler: "themeLab.issue.previewEvent",
    preview_block_count: "themeLab.issue.previewCount",
    preview_block_sequence: "themeLab.issue.previewSequence"
  };
  const key = keys[code] ?? (
    code.startsWith("component_")
      ? "themeLab.issue.forbiddenElement"
      : "themeLab.issue.invalid"
  );
  return text.t(key);
}
