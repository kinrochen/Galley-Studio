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

export const GALLEY_THEME_LAB_VIEW_TYPE = "galley-theme-lab";

export interface ThemeLabViewServices {
  supportsVision(): Promise<boolean>;
  generate(
    input: ThemeGenerationInput,
    signal: AbortSignal
  ): Promise<ThemeDraft>;
  save(draft: ThemeDraft): Promise<void>;
  report(message: string): void;
}

export class ThemeLabView extends ItemView {
  readonly #preview = new ThemePreview();
  #controller: AbortController | null = null;
  #draft: ThemeDraft | null = null;
  #closed = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly services: ThemeLabViewServices
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GALLEY_THEME_LAB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Galley Theme Lab";
  }

  async onOpen(): Promise<void> {
    this.#closed = false;
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("galley-theme-lab");

    const title = document.createElement("h2");
    title.textContent = "AI Theme Lab";
    const description = document.createElement("textarea");
    description.className = "galley-theme-lab__description";
    description.placeholder = "Describe the visual style, mood, colors, and intended articles.";
    description.setAttribute("aria-label", "Theme description");

    let imageInput: HTMLInputElement | null = null;
    if (await this.services.supportsVision()) {
      imageInput = document.createElement("input");
      imageInput.type = "file";
      imageInput.accept = "image/png,image/jpeg,image/webp";
      imageInput.setAttribute("aria-label", "Optional reference image");
    }

    const actions = document.createElement("div");
    actions.className = "galley-theme-lab__actions";
    const generateButton = document.createElement("button");
    generateButton.textContent = "Generate draft";
    const saveButton = document.createElement("button");
    saveButton.textContent = "Save theme";
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

    generateButton.addEventListener("click", () => {
      this.#controller?.abort();
      const controller = new AbortController();
      this.#controller = controller;
      this.#draft = null;
      saveButton.disabled = true;
      issues.replaceChildren();
      status.textContent = "Generating theme draft…";
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
          this.#preview.render(previewHost, draft.previewHtml);
          for (const issue of draft.validation.issues) {
            const item = document.createElement("li");
            item.textContent = issue.message;
            item.dataset.severity = issue.severity;
            issues.append(item);
          }
          saveButton.disabled = !draft.validation.valid;
          status.textContent = draft.validation.valid
            ? "Draft is valid. Review the full page, then save explicitly."
            : "Draft has validation errors and cannot be saved.";
        } catch (error) {
          if (!controller.signal.aborted && !this.#closed) {
            status.textContent = safeMessage(error);
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
          status.textContent = "Theme saved and available to new Skill sessions.";
          this.services.report(`Saved custom theme: ${draft.manifest.name}`);
        },
        (error: unknown) => {
          if (this.#closed) return;
          status.textContent = safeMessage(error);
          saveButton.disabled = false;
        }
      );
    });
  }

  async onClose(): Promise<void> {
    this.#closed = true;
    this.#controller?.abort();
    this.#controller = null;
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
    throw new Error("A theme reference image must be no larger than 10 MiB.");
  }
  return {
    selected: true,
    name: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer())
  };
}

function safeMessage(error: unknown): string {
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) return "Theme generation cancelled.";
  return error instanceof Error
    ? error.message.slice(0, 240)
    : "Theme operation failed.";
}
