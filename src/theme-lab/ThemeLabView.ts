import { ItemView, type WorkspaceLeaf } from "obsidian";

import {
  MAX_REFERENCE_IMAGE_BYTES,
  type ReferenceImageInput
} from "./ReferenceImage";
import type {
  ThemeDraft,
  ThemeGenerationInput,
  ThemeGenerationProgress,
  ThemeGenerationStage
} from "./ThemeGenerationService";
import { ThemePreview } from "./ThemePreview";
import {
  ENGLISH_LOCALIZED_TEXT,
  translateMessage,
  type LocalizedMessage,
  type LocalizedText
} from "../i18n/LocalizedText";
import type { MessageKey } from "../i18n/Resources";

export const GALLEY_THEME_LAB_VIEW_TYPE = "galley-studio-theme-lab";

export interface ThemeLabViewServices {
  supportsVision(): Promise<boolean>;
  generate(
    input: ThemeGenerationInput,
    signal: AbortSignal,
    progress?: ThemeGenerationProgress
  ): Promise<ThemeDraft>;
  save(
    draft: ThemeDraft,
    signal: AbortSignal,
    progress?: ThemeGenerationProgress
  ): Promise<ThemeDraft>;
  report(message: string): void;
  readonly locale?: LocalizedText;
}

export class ThemeLabView extends ItemView {
  readonly #preview = new ThemePreview();
  #controller: AbortController | null = null;
  #draft: ThemeDraft | null = null;
  #savedDraft: ThemeDraft | null = null;
  #progressTimer: ReturnType<typeof setInterval> | null = null;
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

    const header = document.createElement("header");
    header.className = "galley-theme-lab__header";
    const title = document.createElement("h2");
    title.textContent = this.#text.t("themeLab.title");
    const intro = document.createElement("p");
    intro.className = "galley-theme-lab__intro";
    intro.textContent = this.#text.t("themeLab.intro");
    header.append(title, intro);

    const conversation = document.createElement("div");
    conversation.className = "galley-theme-lab__conversation";
    conversation.setAttribute("role", "log");
    conversation.setAttribute("aria-live", "polite");
    conversation.setAttribute(
      "aria-label",
      this.#text.t("themeLab.conversation.aria")
    );
    const localizedMessages: RenderedLocalizedMessage[] = [];
    appendLocalizedMessage(
      conversation,
      localizedMessages,
      "assistant",
      { key: "themeLab.assistant.welcome" },
      this.#text
    );

    let imageInput: HTMLInputElement | null = null;
    if (await this.services.supportsVision()) {
      imageInput = document.createElement("input");
      imageInput.type = "file";
      imageInput.accept = "image/png,image/jpeg,image/webp";
      imageInput.setAttribute("aria-label", this.#text.t("themeLab.image.aria"));
    }

    const composer = document.createElement("div");
    composer.className = "galley-theme-lab__composer";
    const description = document.createElement("textarea");
    description.className = "galley-theme-lab__description";
    description.placeholder = this.#text.t("themeLab.description.placeholder");
    description.setAttribute("aria-label", this.#text.t("themeLab.description.aria"));
    const actions = document.createElement("div");
    actions.className = "galley-theme-lab__actions";
    const generateButton = document.createElement("button");
    generateButton.dataset.action = "theme-generate";
    generateButton.classList.add("mod-cta");
    const cancelButton = document.createElement("button");
    cancelButton.dataset.action = "theme-cancel";
    cancelButton.hidden = true;
    const saveButton = document.createElement("button");
    saveButton.dataset.action = "theme-save";
    saveButton.textContent = this.#text.t("themeLab.save");
    saveButton.disabled = true;
    actions.append(cancelButton, generateButton, saveButton);
    composer.append(description);
    if (imageInput) composer.append(imageInput);
    composer.append(actions);

    const status = document.createElement("div");
    status.className = "galley-theme-lab__status";
    status.setAttribute("role", "status");
    const issues = document.createElement("ul");
    issues.className = "galley-theme-lab__issues";
    const previewHeading = document.createElement("h3");
    previewHeading.className = "galley-theme-lab__preview-heading";
    previewHeading.textContent = this.#text.t("themeLab.preview.heading");
    const previewHost = document.createElement("div");
    previewHost.className = "galley-theme-lab__preview";

    this.contentEl.append(
      header,
      conversation,
      composer,
      status,
      issues,
      previewHeading,
      previewHost
    );

    const instructions: string[] = [];
    let statusMessage: LocalizedMessage | null = null;
    let progressStage: ThemeGenerationStage | null = null;
    let progressStartedAt = 0;
    let pendingReply: RenderedLocalizedMessage | null = null;
    const renderIssues = (draft: ThemeDraft | null): void => {
      issues.replaceChildren();
      for (const issue of draft?.validation.issues ?? []) {
        const item = document.createElement("li");
        item.textContent = localizedThemeIssue(issue.code, this.#text);
        item.dataset.severity = issue.severity;
        issues.append(item);
      }
    };
    const setStatus = (
      message: MessageKey | LocalizedMessage
    ): void => {
      statusMessage = typeof message === "string" ? { key: message } : message;
      status.textContent = translateMessage(this.#text, statusMessage);
    };
    const syncSaveButton = (): void => {
      saveButton.disabled =
        !this.#draft?.validation.valid ||
        this.#draft === this.#savedDraft ||
        generateButton.disabled;
    };
    const renderProgress = (): void => {
      if (!progressStage) return;
      status.textContent = this.#text.t(progressMessageKey(progressStage), {
        seconds: Math.max(
          0,
          Math.floor((Date.now() - progressStartedAt) / 1_000)
        )
      });
    };
    const updateProgress = (stage: ThemeGenerationStage): void => {
      if (this.#closed || !this.#controller) return;
      progressStage = stage;
      renderProgress();
    };
    const startOperation = (
      controller: AbortController,
      stage: ThemeGenerationStage
    ): void => {
      this.#controller = controller;
      progressStage = stage;
      progressStartedAt = Date.now();
      generateButton.disabled = true;
      saveButton.disabled = true;
      cancelButton.hidden = false;
      this.#progressTimer = setInterval(renderProgress, 1_000);
      renderProgress();
    };
    const finishOperation = (controller: AbortController): void => {
      if (this.#controller !== controller) return;
      this.#controller = null;
      progressStage = null;
      if (this.#progressTimer) clearInterval(this.#progressTimer);
      this.#progressTimer = null;
      generateButton.disabled = false;
      cancelButton.hidden = true;
      pendingReply = null;
      updateChrome();
      syncSaveButton();
    };
    const updateChrome = (): void => {
      title.textContent = this.#text.t("themeLab.title");
      intro.textContent = this.#text.t("themeLab.intro");
      conversation.setAttribute(
        "aria-label",
        this.#text.t("themeLab.conversation.aria")
      );
      description.placeholder = this.#text.t("themeLab.description.placeholder");
      description.setAttribute("aria-label", this.#text.t("themeLab.description.aria"));
      imageInput?.setAttribute("aria-label", this.#text.t("themeLab.image.aria"));
      generateButton.textContent = this.#text.t(
        instructions.length
          ? "themeLab.generate.refine"
          : "themeLab.generate.initial"
      );
      cancelButton.textContent = this.#text.t("common.action.cancel");
      saveButton.textContent = this.#text.t("themeLab.save");
      previewHeading.textContent = this.#text.t("themeLab.preview.heading");
      for (const item of localizedMessages) {
        item.body.textContent = translateMessage(this.#text, item.message);
        item.speaker.textContent = this.#text.t("themeLab.assistant");
      }
      if (progressStage) {
        renderProgress();
      } else if (statusMessage) {
        status.textContent = translateMessage(this.#text, statusMessage);
      }
      renderIssues(this.#draft);
      const frame = previewHost.querySelector("iframe");
      if (frame) frame.title = this.#text.t("themeLab.preview.title");
    };
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = this.#text.subscribe(updateChrome);
    updateChrome();

    const generate = (): void => {
      const instruction = description.value.trim();
      if (!instruction || generateButton.disabled) return;
      this.#controller?.abort();
      const controller = new AbortController();
      instructions.push(instruction);
      appendUserMessage(conversation, instruction, this.#text);
      description.value = "";
      const assistantReply = appendLocalizedMessage(
        conversation,
        localizedMessages,
        "assistant",
        { key: "themeLab.assistant.generating" },
        this.#text
      );
      pendingReply = assistantReply;
      scrollConversationToEnd(conversation);
      issues.replaceChildren();
      startOperation(controller, "drafting");
      void (async () => {
        try {
          const referenceImage = imageInput
            ? await selectedImage(imageInput)
            : undefined;
          const input: ThemeGenerationInput = {
            description: composeConversationDescription(instructions),
            ...(referenceImage ? { referenceImage } : {})
          };
          const draft = await this.services.generate(
            input,
            controller.signal,
            updateProgress
          );
          if (this.#closed || controller.signal.aborted || this.#controller !== controller) return;
          this.#draft = draft;
          this.#preview.render(
            previewHost,
            draft.previewHtml,
            this.#text.t("themeLab.preview.title")
          );
          renderIssues(draft);
          assistantReply.message = draft.validation.valid
            ? {
                key: "themeLab.assistant.valid",
                parameters: {
                  name: draft.manifest.name,
                  color: draft.manifest.primaryColor
                }
              }
            : {
                key: "themeLab.assistant.invalid",
                parameters: { count: draft.validation.issues.length }
              };
          assistantReply.body.textContent = translateMessage(
            this.#text,
            assistantReply.message
          );
          setStatus(
            draft.validation.valid
              ? "themeLab.status.valid"
              : "themeLab.status.invalid"
          );
        } catch (error) {
          if (!controller.signal.aborted && !this.#closed) {
            statusMessage = safeMessage(error);
            status.textContent = translateMessage(this.#text, statusMessage);
            assistantReply.message = statusMessage;
            assistantReply.body.textContent = translateMessage(
              this.#text,
              assistantReply.message
            );
          }
        } finally {
          if (!this.#closed) {
            finishOperation(controller);
            scrollConversationToEnd(conversation);
          }
        }
      })();
    };

    generateButton.addEventListener("click", generate);
    description.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      generate();
    });
    cancelButton.addEventListener("click", () => {
      const controller = this.#controller;
      if (!controller) return;
      controller.abort();
      const cancelled = { key: "themeLab.status.cancelled" } as const;
      statusMessage = cancelled;
      if (pendingReply) {
        pendingReply.message = cancelled;
        pendingReply.body.textContent = translateMessage(
          this.#text,
          cancelled
        );
      }
      finishOperation(controller);
    });

    saveButton.addEventListener("click", () => {
      const draft = this.#draft;
      if (!draft?.validation.valid) return;
      const controller = new AbortController();
      pendingReply = appendLocalizedMessage(
        conversation,
        localizedMessages,
        "assistant",
        { key: "themeLab.assistant.finalizing" },
        this.#text
      );
      scrollConversationToEnd(conversation);
      startOperation(controller, "loading-rules");
      void this.services.save(draft, controller.signal, updateProgress).then(
        (finalized) => {
          if (this.#closed) return;
          this.#draft = finalized;
          this.#savedDraft = finalized;
          this.#preview.render(
            previewHost,
            finalized.previewHtml,
            this.#text.t("themeLab.preview.title")
          );
          renderIssues(finalized);
          setStatus("themeLab.status.saved");
          if (pendingReply) {
            pendingReply.message = {
              key: "themeLab.assistant.saved",
              parameters: { name: finalized.manifest.name }
            };
            pendingReply.body.textContent = translateMessage(
              this.#text,
              pendingReply.message
            );
          }
          scrollConversationToEnd(conversation);
          this.services.report(
            this.#text.t("themeLab.notice.saved", {
              name: finalized.manifest.name
            })
          );
        },
        (error: unknown) => {
          if (this.#closed || controller.signal.aborted) return;
          statusMessage = safeMessage(error);
          status.textContent = translateMessage(this.#text, statusMessage);
          if (pendingReply) {
            pendingReply.message = statusMessage;
            pendingReply.body.textContent = translateMessage(
              this.#text,
              pendingReply.message
            );
          }
        }
      ).finally(() => {
        if (!this.#closed) finishOperation(controller);
      });
    });
  }

  async onClose(): Promise<void> {
    this.#closed = true;
    this.#controller?.abort();
    this.#controller = null;
    if (this.#progressTimer) clearInterval(this.#progressTimer);
    this.#progressTimer = null;
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
    this.#draft = null;
    this.#savedDraft = null;
    this.contentEl.replaceChildren();
  }
}

interface RenderedLocalizedMessage {
  message: LocalizedMessage;
  readonly body: HTMLElement;
  readonly speaker: HTMLElement;
}

function appendLocalizedMessage(
  conversation: HTMLElement,
  messages: RenderedLocalizedMessage[],
  role: "assistant",
  message: LocalizedMessage,
  text: LocalizedText
): RenderedLocalizedMessage {
  const rendered = appendMessage(
    conversation,
    role,
    text.t("themeLab.assistant"),
    translateMessage(text, message)
  );
  const item = { ...rendered, message };
  messages.push(item);
  return item;
}

function appendUserMessage(
  conversation: HTMLElement,
  content: string,
  text: LocalizedText
): void {
  appendMessage(conversation, "user", text.t("themeLab.you"), content);
}

function appendMessage(
  conversation: HTMLElement,
  role: "assistant" | "user",
  speakerText: string,
  content: string
): Pick<RenderedLocalizedMessage, "body" | "speaker"> {
  const message = document.createElement("article");
  message.className = `galley-theme-lab__message is-${role}`;
  const speaker = document.createElement("div");
  speaker.className = "galley-theme-lab__speaker";
  speaker.textContent = speakerText;
  const body = document.createElement("div");
  body.className = "galley-theme-lab__bubble";
  body.textContent = content;
  message.append(speaker, body);
  conversation.append(message);
  return { body, speaker };
}

function scrollConversationToEnd(conversation: HTMLElement): void {
  conversation.scrollTop = conversation.scrollHeight;
}

function progressMessageKey(stage: ThemeGenerationStage): MessageKey {
  const keys: Readonly<Record<ThemeGenerationStage, MessageKey>> = {
    drafting: "themeLab.status.drafting",
    "loading-rules": "themeLab.status.loadingRules",
    finalizing: "themeLab.status.finalizing",
    validating: "themeLab.status.validating",
    saving: "themeLab.status.saving"
  };
  return keys[stage];
}

export function composeConversationDescription(
  instructions: readonly string[]
): string {
  return [
    "Treat the following as one cumulative multi-turn theme design conversation.",
    "Create a new theme on the first turn. On later turns, revise the latest theme while preserving every requirement that the user did not explicitly change.",
    ...instructions.map((instruction, index) =>
      `${index === 0 ? "Initial request" : `Refinement ${index}`}:\n${instruction}`
    )
  ].join("\n\n");
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
  const code = errorCode(error);
  if (code === "aborted") return { key: "themeLab.status.cancelled" };
  if (code === "theme_response_invalid" || code === "invalid_response") {
    return { key: "themeLab.error.invalidResponse" };
  }
  if (
    code === "theme_validation_failed" ||
    code === "theme_component_invalid" ||
    code === "theme_preview_invalid"
  ) {
    return { key: "themeLab.error.validation" };
  }
  if (code === "theme_id_collision") {
    return { key: "themeLab.error.collision" };
  }
  if (code === "timeout") return { key: "themeLab.error.timeout" };
  if (code === "network_error" || code === "http_error") {
    return { key: "themeLab.error.provider" };
  }
  if (code === "missing_secret") {
    return { key: "themeLab.error.missingSecret" };
  }
  return { key: "themeLab.status.operationFailed" };
}

function errorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) return null;
  return typeof error.code === "string" ? error.code : null;
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
