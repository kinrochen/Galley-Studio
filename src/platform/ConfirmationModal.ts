import { Modal, type App } from "obsidian";

export function requestConfirmation(
  app: App,
  message: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmationModal(app, message, resolve).open();
  });
}

class ConfirmationModal extends Modal {
  #settled = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    const actions = this.contentEl.createDiv({
      cls: "galley-confirmation-modal__actions"
    });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.#finish(false));
    const confirm = actions.createEl("button", {
      cls: "mod-cta",
      text: "Confirm"
    });
    confirm.type = "button";
    confirm.addEventListener("click", () => this.#finish(true));
    confirm.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.#settled) return;
    this.#settled = true;
    this.resolve(false);
  }

  #finish(confirmed: boolean): void {
    if (this.#settled) return;
    this.#settled = true;
    this.resolve(confirmed);
    this.close();
  }
}
