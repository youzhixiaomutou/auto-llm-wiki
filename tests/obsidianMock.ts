export class Notice {
  static messages: string[] = [];
  message: string;

  constructor(message: string) {
    this.message = message;
    Notice.messages.push(message);
  }
}

export class Modal {
  static instances: Modal[] = [];
  app: unknown;
  modalEl = createMockElement();
  contentEl = createMockElement();

  constructor(app: unknown) {
    this.app = app;
    Modal.instances.push(this);
  }

  open(): void {
    if ("onOpen" in this && typeof this.onOpen === "function") {
      this.onOpen();
    }
  }
  close(): void {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl = createMockElement();

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
}

export class Setting {
  constructor(public containerEl: unknown) {}

  setName(): this {
    return this;
  }

  setDesc(): this {
    return this;
  }

  addText(callback: (text: { inputEl: { type: string }; setValue(value: string): void; onChange(callback: (value: string) => Promise<void>): void }) => void): this {
    callback({ inputEl: { type: "text" }, setValue() {}, onChange() {} });
    return this;
  }

  addButton(callback: (button: { buttonEl: { disabled?: boolean }; setButtonText(text: string): void; setDisabled(disabled: boolean): void; onClick(callback: () => Promise<void>): void }) => void): this {
    const button: { buttonText?: string; buttonEl: { disabled?: boolean }; disabled?: boolean; onclick?: () => Promise<void>; setButtonText(text: string): void; setDisabled(disabled: boolean): void; onClick(callback: () => Promise<void>): void } = {
      buttonEl: {},
      setButtonText(text: string) {
        button.buttonText = text;
      },
      setDisabled(disabled: boolean) {
        button.disabled = disabled;
        button.buttonEl.disabled = disabled;
      },
      onClick(callback: () => Promise<void>) {
        button.onclick = callback;
      }
    };
    (this.containerEl as { buttons?: unknown[] }).buttons?.push(button);
    callback(button);
    return this;
  }
}

export class Plugin {
  app: unknown;

  async loadData(): Promise<unknown> {
    return undefined;
  }

  statusBarItems: Array<{ text: string; history: string[]; setText(text: string): void }> = [];

  async saveData(): Promise<void> {}
  addCommand(): void {}
  addSettingTab(): void {}
  addStatusBarItem(): { text: string; setText(text: string): void } {
    const item = {
      text: "",
      history: [] as string[],
      setText(text: string) {
        item.text = text;
        item.history.push(text);
      }
    };
    this.statusBarItems.push(item);
    return item;
  }
}

export class TFile {
  constructor(public path: string) {}
}

export function requestUrl(): Promise<{ text: string; status: number }> {
  return Promise.resolve({ text: "{}", status: 200 });
}

export function loadPdfJs(): Promise<unknown> {
  return Promise.resolve({});
}

function createMockElement() {
  const element: {
    buttons: Array<{ onclick?: () => void | Promise<void>; disabled?: boolean; addClass(className?: string): void }>;
    texts: string[];
    classes: string[];
    styles: Record<string, string>;
    style: { setProperty(name: string, value: string): void };
    empty(): void;
    createEl(tag?: string, options?: { text?: string }): ReturnType<typeof createMockElement> | { onclick?: () => void | Promise<void>; disabled?: boolean; addClass(className?: string): void };
    createDiv(): ReturnType<typeof createMockElement>;
    createSpan(): ReturnType<typeof createMockElement>;
    setText(text?: string): void;
    addClass(): void;
    appendChild(): void;
  } = {
    buttons: [],
    texts: [],
    classes: [],
    styles: {},
    style: {
      setProperty(name: string, value: string) {
        element.styles[name] = value;
      }
    },
    empty() {
      element.texts.length = 0;
      element.buttons.length = 0;
      element.classes.length = 0;
      element.styles = {};
    },
    createEl(tag?: string, options?: { text?: string }) {
      if (options?.text) element.texts.push(options.text);
      if (tag === "button") {
        const button: { onclick?: () => void | Promise<void>; disabled?: boolean; addClass(className?: string): void } = {
          addClass(className?: string) {
            if (className) element.classes.push(className);
          }
        };
        element.buttons.push(button);
        return button;
      }
      const child = createMockElement();
      child.buttons = element.buttons;
      child.texts = element.texts;
      child.classes = element.classes;
      child.styles = element.styles;
      child.style = element.style;
      return child;
    },
    createDiv() {
      const child = createMockElement();
      child.buttons = element.buttons;
      child.texts = element.texts;
      child.classes = element.classes;
      child.styles = element.styles;
      child.style = element.style;
      return child;
    },
    createSpan() {
      const child = createMockElement();
      child.texts = element.texts;
      child.classes = element.classes;
      child.styles = element.styles;
      child.style = element.style;
      return child;
    },
    setText(text?: string) {
      if (text) element.texts.push(text);
    },
    addClass(className?: string) {
      if (className) element.classes.push(className);
    },
    appendChild() {}
  };
  return element;
}
