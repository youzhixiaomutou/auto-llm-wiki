type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function ensureWindowLocalStorage(): LocalStorageLike {
  const globalWindow = globalThis as {
    window?: { localStorage?: LocalStorageLike; setInterval?: unknown; clearInterval?: unknown };
  };
  if (!globalWindow.window) globalWindow.window = {};
  if (!globalWindow.window.localStorage) {
    const store: Record<string, string> = {};
    globalWindow.window.localStorage = {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; }
    };
  }
  // No-op timer stubs: return a fake id and never actually schedule, so polling intervals
  // registered during tests do not leak real timers or keep the process alive.
  if (!globalWindow.window.setInterval) globalWindow.window.setInterval = () => 0;
  if (!globalWindow.window.clearInterval) globalWindow.window.clearInterval = () => undefined;
  return globalWindow.window.localStorage;
}

const languageStorage = ensureWindowLocalStorage();

export function getLanguage(): string {
  return languageStorage.getItem("language") || "en";
}

export function __setLanguage(language: string): void {
  languageStorage.setItem("language", language);
}

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
  close(): void {
    // Real Obsidian invokes onClose() from close(); mirror it so re-entrancy (submit -> close ->
    // onClose) is exercised by tests.
    if ("onClose" in this && typeof this.onClose === "function") {
      this.onClose();
    }
  }
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
  constructor(public containerEl: unknown) {
    this.ensureArrays(containerEl);
  }

  private ensureArrays(el: unknown): void {
    if (!el || typeof el !== "object") return;
    const obj = el as Record<string, unknown>;
    if (!Array.isArray(obj.texts)) obj.texts = [];
    if (!Array.isArray(obj.buttons)) obj.buttons = [];
    if (!Array.isArray(obj.toggles)) obj.toggles = [];
    if (!Array.isArray(obj.textInputs)) obj.textInputs = [];
    if (!Array.isArray(obj.dropdowns)) obj.dropdowns = [];
    if (!Array.isArray(obj.textareas)) obj.textareas = [];
    if (!Array.isArray(obj.fields)) obj.fields = [];
  }

  setName(name?: string): this {
    if (name) (this.containerEl as { texts?: string[] }).texts?.push(name);
    return this;
  }

  setDesc(desc?: string): this {
    if (desc) (this.containerEl as { texts?: string[] }).texts?.push(desc);
    return this;
  }

  setHeading(): this {
    return this;
  }

  addText(callback: (text: { inputEl: { type: string }; setValue(value: string): void; onChange(callback: (value: string) => Promise<void>): void }) => void): this {
    // inputEl records DOM listeners and exposes trigger() so tests can simulate real events
    // (e.g. keydown Enter) — the paths that would otherwise be untested no-ops in the mock.
    const listeners: Record<string, (event: unknown) => void> = {};
    const inputEl = {
      type: "text",
      addEventListener(event: string, handler: (event: unknown) => void) { listeners[event] = handler; },
      focus() {},
      trigger(event: string, arg: unknown) { listeners[event]?.(arg); }
    };
    const input: {
      value?: string;
      onchange?: (value: string) => Promise<void>;
      inputEl: typeof inputEl;
      setValue(value: string): void;
      onChange(callback: (value: string) => Promise<void>): void;
    } = {
      inputEl,
      setValue(value: string) {
        input.value = value;
      },
      onChange(callback: (value: string) => Promise<void>) {
        input.onchange = callback;
      }
    };
    (this.containerEl as { textInputs?: unknown[] }).textInputs?.push(input);
    callback(input);
    return this;
  }

  addToggle(callback: (toggle: { value?: boolean; setValue(value: boolean): void; onChange(callback: (value: boolean) => Promise<void>): void }) => void): this {
    const toggle: { value?: boolean; onchange?: (value: boolean) => Promise<void>; setValue(value: boolean): void; onChange(callback: (value: boolean) => Promise<void>): void } = {
      setValue(value: boolean) {
        toggle.value = value;
      },
      onChange(callback: (value: boolean) => Promise<void>) {
        toggle.onchange = callback;
      }
    };
    (this.containerEl as { toggles?: unknown[] }).toggles?.push(toggle);
    callback(toggle);
    return this;
  }

  addButton(callback: (button: { buttonEl: { disabled?: boolean }; setButtonText(text: string): void; setDisabled(disabled: boolean): void; setCta(): void; setWarning(): void; onClick(callback: () => Promise<void>): void }) => void): this {
    const button: { buttonText?: string; buttonEl: { disabled?: boolean }; disabled?: boolean; onclick?: () => Promise<void>; setButtonText(text: string): void; setDisabled(disabled: boolean): void; setCta(): void; setWarning(): void; onClick(callback: () => Promise<void>): void } = {
      buttonEl: {},
      setButtonText(text: string) {
        button.buttonText = text;
      },
      setDisabled(disabled: boolean) {
        button.disabled = disabled;
        button.buttonEl.disabled = disabled;
      },
      setCta() {},
      setWarning() {},
      onClick(callback: () => Promise<void>) {
        button.onclick = callback;
      }
    };
    (this.containerEl as { buttons?: unknown[] }).buttons?.push(button);
    callback(button);
    return this;
  }

  addDropdown(cb: (dropdown: { addOption(v: string, l: string): void; setValue(v: string): void; onChange(c: (v: string) => Promise<void>): void }) => void): this {
    const dropdown: { value?: string; options: Record<string, string>; onchange?: (v: string) => Promise<void>; addOption(v: string, l: string): void; setValue(v: string): void; onChange(c: (v: string) => Promise<void>): void } = {
      options: {},
      addOption(v: string, l: string) {
        dropdown.options[v] = l;
      },
      setValue(v: string) {
        dropdown.value = v;
      },
      onChange(c: (v: string) => Promise<void>) {
        dropdown.onchange = c;
      }
    };
    (this.containerEl as { dropdowns?: unknown[] }).dropdowns?.push(dropdown);
    cb(dropdown);
    return this;
  }

  addTextArea(cb: (textarea: { inputEl: { type: string }; setValue(v: string): void; setPlaceholder(t: string): void; onChange(c: (v: string) => Promise<void>): void }) => void): this {
    const textarea: { value?: string; placeholder?: string; onchange?: (v: string) => Promise<void>; inputEl: { type: string }; setValue(v: string): void; setPlaceholder(t: string): void; onChange(c: (v: string) => Promise<void>): void } = {
      inputEl: { type: "textarea" },
      setValue(value: string) {
        textarea.value = value;
      },
      setPlaceholder(text: string) {
        textarea.placeholder = text;
      },
      onChange(c: (value: string) => Promise<void>) {
        textarea.onchange = c;
      }
    };
    (this.containerEl as { textareas?: unknown[] }).textareas?.push(textarea);
    cb(textarea);
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
  registeredEvents: unknown[] = [];
  addCommand(): void {}
  addSettingTab(): void {}
  registerEvent(eventRef: unknown): void {
    this.registeredEvents.push(eventRef);
  }
  registeredIntervals: unknown[] = [];
  registerInterval(id: number): number {
    this.registeredIntervals.push(id);
    return id;
  }
  registeredViews: Array<{ type: string; factory: (leaf: unknown) => unknown }> = [];
  registerView(type: string, factory: (leaf: unknown) => unknown): void {
    this.registeredViews.push({ type, factory });
  }
  ribbonIcons: Array<{ icon: string; title: string; callback: () => void }> = [];
  addRibbonIcon(icon: string, title: string, callback: () => void): ReturnType<typeof createMockElement> {
    this.ribbonIcons.push({ icon, title, callback });
    return createMockElement();
  }
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

export class WorkspaceLeaf {
  view: unknown;
  viewState: unknown;
  async setViewState(state: unknown): Promise<void> {
    this.viewState = state;
  }
}

export class ItemView {
  app: unknown;
  containerEl = createMockElement();
  contentEl = createMockElement();

  constructor(public leaf: unknown) {
    this.app = (leaf as { app?: unknown })?.app;
  }

  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
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

export function setIcon(el: unknown, icon: string): void {
  // Record the icon on the element so tests can assert on it if needed; harmless otherwise.
  if (el && typeof el === "object") (el as { icon?: string }).icon = icon;
}

export class MarkdownRenderer {
  // Push the raw markdown as text so the view's assertions on rendered content keep working,
  // mirroring the real renderer closely enough for unit tests.
  static async render(_app: unknown, markdown: string, el: { setText(text?: string): void }, _sourcePath: string, _component: unknown): Promise<void> {
    el.setText(markdown);
  }
  static async renderMarkdown(markdown: string, el: { setText(text?: string): void }, _sourcePath: string, _component: unknown): Promise<void> {
    el.setText(markdown);
  }
}

interface MockField {
  value: string;
  disabled: boolean;
  placeholder?: string;
  rows?: number;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  focus(): void;
  addEventListener(event: string, handler: (event: unknown) => void): void;
  trigger(event: string, arg: unknown): void;
  addClass(className?: string): void;
  setAttr(name?: string, value?: string): void;
}

// A <button> stand-in that records its own text/classes/icon so tests can select a specific
// button by role (e.g. the send button) instead of relying on creation order.
interface MockButton {
  onclick?: () => void | Promise<void>;
  disabled: boolean;
  text?: string;
  icon?: string;
  classes: string[];
  style: { setProperty(name: string, value: string): void };
  addClass(className?: string): void;
  removeClass(className?: string): void;
  setText(text?: string): void;
  setAttr(name?: string, value?: string): void;
  addEventListener(event: string, handler: (event: unknown) => void): void;
  trigger(event: string, arg: unknown): void;
  createSpan(): ReturnType<typeof createMockElement>;
}

// A settable <textarea>/<input> stand-in: records value/disabled and lets tests simulate real
// DOM events via trigger() (so keydown/Enter handlers run for real, not as no-ops).
function createMockField(): MockField {
  const listeners: Record<string, (event: unknown) => void> = {};
  const field: MockField = {
    value: "",
    disabled: false,
    style: { setProperty() {}, removeProperty() {} },
    focus() {},
    addEventListener(event, handler) { listeners[event] = handler; },
    trigger(event, arg) { listeners[event]?.(arg); },
    addClass() {},
    setAttr() {}
  };
  return field;
}

function createMockElement() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const element: {
    buttons: MockButton[];
    toggles: Array<{ onchange?: (value: boolean) => Promise<void>; value?: boolean }>;
    textInputs: Array<{ value?: string; onchange?: (value: string) => Promise<void> }>;
    dropdowns: Array<{ value?: string; options: Record<string, string>; onchange?: (value: string) => Promise<void> }>;
    textareas: Array<{ value?: string; placeholder?: string; onchange?: (value: string) => Promise<void> }>;
    fields: MockField[];
    texts: string[];
    classes: string[];
    styles: Record<string, string>;
    style: { setProperty(name: string, value: string): void };
    empty(): void;
    remove(): void;
    createEl(tag?: string, options?: { text?: string; cls?: string }): ReturnType<typeof createMockElement> | MockButton | MockField;
    createDiv(): ReturnType<typeof createMockElement>;
    createSpan(): ReturnType<typeof createMockElement>;
    setText(text?: string): void;
    addClass(className?: string): void;
    removeClass(className?: string): void;
    setAttr(name?: string, value?: string): void;
    addEventListener(event: string, handler: (event: unknown) => void): void;
    appendChild(): void;
  } = {
    buttons: [],
    toggles: [],
    textInputs: [],
    dropdowns: [],
    textareas: [],
    fields: [],
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
      element.toggles.length = 0;
      element.textInputs.length = 0;
      element.dropdowns.length = 0;
      element.textareas.length = 0;
      element.fields.length = 0;
      element.classes.length = 0;
      element.styles = {};
    },
    remove() {},
    createEl(tag?: string, options?: { text?: string; cls?: string }) {
      if (options?.text) element.texts.push(options.text);
      if (tag === "button") {
        const classes: string[] = [];
        const listeners: Record<string, (event: unknown) => void> = {};
        const button: MockButton = {
          disabled: false,
          text: options?.text,
          classes,
          style: { setProperty() {} },
          addClass(className?: string) {
            if (className) { classes.push(className); element.classes.push(className); }
          },
          removeClass(className?: string) {
            const index = classes.indexOf(className ?? "");
            if (index >= 0) classes.splice(index, 1);
          },
          setText(text?: string) {
            button.text = text;
            if (text) element.texts.push(text);
          },
          setAttr() {},
          addEventListener(event, handler) { listeners[event] = handler; },
          trigger(event, arg) { listeners[event]?.(arg); },
          createSpan() { return createMockElement(); }
        };
        if (options?.cls) button.addClass(options.cls);
        element.buttons.push(button);
        return button;
      }
      if (tag === "textarea" || tag === "input") {
        const field = createMockField();
        if (options?.cls) field.addClass(options.cls);
        element.fields.push(field);
        return field;
      }
      const child = createMockElement();
      child.buttons = element.buttons;
      child.toggles = element.toggles;
      child.fields = element.fields;
      child.textInputs = element.textInputs;
      child.texts = element.texts;
      child.classes = element.classes;
      child.styles = element.styles;
      child.style = element.style;
      if (options?.cls) child.addClass(options.cls);
      return child;
    },
    createDiv() {
      const child = createMockElement();
      child.buttons = element.buttons;
      child.toggles = element.toggles;
      child.fields = element.fields;
      child.textInputs = element.textInputs;
      child.texts = element.texts;
      child.classes = element.classes;
      child.styles = element.styles;
      child.style = element.style;
      return child;
    },
    createSpan() {
      const child = createMockElement();
      child.buttons = element.buttons;
      child.toggles = element.toggles;
      child.fields = element.fields;
      child.textInputs = element.textInputs;
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
    removeClass(className?: string) {
      const index = element.classes.indexOf(className ?? "");
      if (index >= 0) element.classes.splice(index, 1);
    },
    setAttr() {},
    addEventListener(event: string, handler: (event: unknown) => void) { listeners[event] = handler; },
    appendChild() {}
  };
  return element;
}
