export const Platform = {
  isMobileApp: false
};

export class Plugin {
  readonly app: unknown;
  readonly manifest: unknown;
  testData: unknown = null;
  savedData: unknown;
  readonly commands: unknown[] = [];
  readonly settingTabs: unknown[] = [];

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

  async loadData(): Promise<unknown> {
    return this.testData;
  }

  async saveData(data: unknown): Promise<void> {
    this.savedData = data;
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

  addComponent<T>(callback: (containerEl: HTMLElement) => T): this {
    callback(this.controlEl);
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
