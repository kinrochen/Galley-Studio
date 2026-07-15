export const Platform = {
  isMobileApp: false
};

export interface RequestUrlParam {
  url: string;
  method?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  json: unknown;
}

type RequestUrlHandler = (
  request: RequestUrlParam | string
) => Promise<RequestUrlResponse>;

let requestUrlHandler: RequestUrlHandler = async () => {
  throw new Error("Unexpected requestUrl call");
};

export function setRequestUrlHandler(handler: RequestUrlHandler): void {
  requestUrlHandler = handler;
}

export function resetRequestUrlHandler(): void {
  requestUrlHandler = async () => {
    throw new Error("Unexpected requestUrl call");
  };
}

export function requestUrl(
  request: RequestUrlParam | string
): Promise<RequestUrlResponse> {
  return requestUrlHandler(request);
}

export const notices: string[] = [];
export const openedModals: Modal[] = [];

export class Notice {
  constructor(message: string | DocumentFragment) {
    notices.push(
      typeof message === "string" ? message : message.textContent ?? ""
    );
  }
}

export class Modal {
  readonly titleEl = document.createElement("div");
  readonly contentEl = document.createElement("div");

  constructor(readonly app: unknown) {}

  open(): void {
    openedModals.push(this);
  }
}

export class Plugin {
  readonly app: unknown;
  readonly manifest: unknown;
  testData: unknown = null;
  savedData: unknown;
  readonly commands: unknown[] = [];
  readonly settingTabs: unknown[] = [];
  readonly views = new Map<string, (leaf: WorkspaceLeaf) => ItemView>();
  readonly eventRefs: unknown[] = [];

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand(command: unknown): void {
    this.commands.push(command);
  }

  addSettingTab(settingTab: unknown): void {
    this.settingTabs.push(settingTab);
  }

  registerView(type: string, creator: (leaf: WorkspaceLeaf) => ItemView): void {
    this.views.set(type, creator);
  }

  unregisterView(type: string): void {
    this.views.delete(type);
  }

  registerEvent(ref: unknown): void {
    this.eventRefs.push(ref);
  }

  async loadData(): Promise<unknown> {
    return this.testData;
  }

  async saveData(data: unknown): Promise<void> {
    this.savedData = structuredClone(data);
  }
}

export class WorkspaceLeaf {
  readonly containerEl = document.createElement("div");
  view: ItemView | null = null;
  state: unknown = null;

  async setViewState(state: unknown): Promise<void> {
    this.state = state;
  }
}

export class ItemView {
  readonly containerEl: HTMLElement;
  readonly contentEl: HTMLElement;

  constructor(readonly leaf: WorkspaceLeaf) {
    this.containerEl = leaf.containerEl;
    this.contentEl = document.createElement("div");
    this.containerEl.append(this.contentEl);
  }

  getViewType(): string {
    return "test-item-view";
  }

  getDisplayText(): string {
    return "Test item view";
  }

  async onOpen(): Promise<void> {}

  async onClose(): Promise<void> {}
}

export class MenuItem {
  title = "";
  icon: string | null = null;
  callback: (() => unknown) | null = null;

  setTitle(title: string | DocumentFragment): this {
    this.title = typeof title === "string" ? title : title.textContent ?? "";
    return this;
  }

  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }

  onClick(callback: () => unknown): this {
    this.callback = callback;
    return this;
  }
}

export class Menu {
  readonly items: MenuItem[] = [];

  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

export class PluginSettingTab {
  readonly app: unknown;
  readonly plugin: unknown;
  readonly containerEl: HTMLElement;

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }
}

export class Setting {
  readonly settingEl: HTMLElement;
  readonly infoEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly descEl: HTMLElement;
  readonly controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.infoEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    this.infoEl.append(this.nameEl, this.descEl);
    this.settingEl.append(this.infoEl, this.controlEl);
    containerEl.append(this.settingEl);
  }

  setName(name: string): this {
    this.nameEl.textContent = name;
    this.settingEl.dataset.settingName = name;
    return this;
  }

  setDesc(description: string): this {
    this.descEl.textContent = description;
    return this;
  }

  addText(callback: (component: TextComponent) => unknown): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addButton(callback: (component: ButtonComponent) => unknown): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }

  addComponent<T>(callback: (containerEl: HTMLElement) => T): this {
    callback(this.controlEl);
    return this;
  }
}

export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement("button");
    containerEl.append(this.buttonEl);
  }

  setButtonText(value: string): this {
    this.buttonEl.textContent = value;
    return this;
  }

  setCta(): this {
    return this;
  }

  onClick(callback: () => unknown): this {
    this.buttonEl.addEventListener("click", () => callback());
    return this;
  }
}

export class TextComponent {
  readonly inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement("input");
    containerEl.append(this.inputEl);
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("change", () => callback(this.inputEl.value));
    return this;
  }
}

export class SecretComponent {
  readonly inputEl: HTMLInputElement;

  constructor(_app: unknown, containerEl: HTMLElement) {
    this.inputEl = document.createElement("input");
    this.inputEl.dataset.component = "secret";
    containerEl.append(this.inputEl);
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.inputEl.addEventListener("change", () => callback(this.inputEl.value));
    return this;
  }
}
