import * as obsidian from "obsidian";
import LLMWikiPlugin from "../src/main";
import { DEFAULT_SETTINGS, LLMWikiSettingTab } from "../src/settings";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;
const modals = (obsidian.Modal as unknown as { instances: unknown[] }).instances;

beforeEach(() => {
  notices.length = 0;
  modals.length = 0;
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("en");
  jest.restoreAllMocks();
});

test("onload initializes persistent status bar as idle", async () => {
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string }> } };
  const plugin = new PluginMock();
  plugin.app = {} as never;

  await plugin.onload();

  expect(plugin.statusBarItems[0].text).toBe("ContextOS: idle");
});

test("does not register raw auto-ingest listeners by default", async () => {
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { registeredEvents: unknown[] } };
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      on: jest.fn()
    }
  } as never;

  await plugin.onload();

  expect((plugin.app as unknown as { vault: { on: jest.Mock } }).vault.on).not.toHaveBeenCalled();
  expect(plugin.registeredEvents).toEqual([]);
});

test("registers raw auto-ingest listeners when enabled", async () => {
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { registeredEvents: unknown[] } };
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key", autoIngestEnabled: true });
  const eventRefs: string[] = [];
  plugin.app = {
    vault: {
      on: jest.fn((eventName: string) => {
        eventRefs.push(eventName);
        return `event:${eventName}`;
      })
    }
  } as never;

  await plugin.onload();

  expect(eventRefs).toEqual(["create", "modify"]);
  expect(plugin.registeredEvents).toEqual(["event:create", "event:modify"]);
});

test("starts listening when auto ingest is enabled from settings without reload", async () => {
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { registeredEvents: unknown[] } };
  const plugin = new PluginMock();
  const eventRefs: string[] = [];
  jest.spyOn(plugin, "saveSettings").mockResolvedValue();
  plugin.app = {
    vault: {
      on: jest.fn((eventName: string) => {
        eventRefs.push(eventName);
        return `event:${eventName}`;
      })
    }
  } as never;
  const tab = new LLMWikiSettingTab(plugin.app as never, plugin);

  tab.display();
  const toggles = (tab.containerEl as unknown as { toggles: Array<{ onchange?: (value: boolean) => Promise<void> }> }).toggles;
  await toggles[0].onchange!(true);

  expect(eventRefs).toEqual(["create", "modify"]);
  expect(plugin.registeredEvents).toEqual(["event:create", "event:modify"]);
});

test("auto ingest ignores unsupported files outside the raw folder", async () => {
  jest.useFakeTimers();
  try {
    const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
    const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
    jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key", autoIngestEnabled: true, autoIngestDebounceMs: 10 });
    const listeners = new Map<string, (file: obsidian.TFile) => void>();
    plugin.app = {
      vault: {
        on: jest.fn((eventName: string, callback: (file: obsidian.TFile) => void) => {
          listeners.set(eventName, callback);
          return `event:${eventName}`;
        })
      }
    } as never;
    const ingestSpy = jest.spyOn(plugin as unknown as { ingestActiveSource(autoApply?: boolean): Promise<void> }, "ingestActiveSource");

    await plugin.onload();
    listeners.get("modify")!(new TFileMock("wiki/page.md"));
    listeners.get("modify")!(new TFileMock("raw/tool.exe"));
    await jest.advanceTimersByTimeAsync(10);

    expect(ingestSpy).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("auto ingest applies validated changes without opening the review modal", async () => {
  jest.useFakeTimers();
  try {
    jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: "ok",
          operations: [{ kind: "create", path: "wiki/source.md", content: "# Source", rationale: "test" }]
        }) } }]
      })
    } as never);

    const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
    const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
    const rawFile = new TFileMock("raw/source.md");
    const existing = new Set<string>();
    const savedData: unknown[] = [];
    const listeners = new Map<string, (file: obsidian.TFile) => void>();
    const plugin = new PluginMock();
    jest.spyOn(plugin, "loadData").mockResolvedValue({
      openAIApiKey: "key",
      autoIngestEnabled: true,
      autoIngestDebounceMs: 10,
      rawFileState: {}
    });
    jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
      savedData.push(data);
    });
    plugin.app = {
      vault: {
        on: jest.fn((eventName: string, callback: (file: obsidian.TFile) => void) => {
          listeners.set(eventName, callback);
          return `event:${eventName}`;
        }),
        getFiles: () => [rawFile],
        getAbstractFileByPath: (path: string) => existing.has(path) ? new TFileMock(path) : null,
        createFolder: async (path: string) => {
          existing.add(path);
        },
        create: async (path: string) => {
          existing.add(path);
        },
        read: async (file: { path: string }) => {
          if (file.path === "raw/source.md") return "source";
          return "";
        }
      }
    } as never;

    await plugin.onload();
    listeners.get("modify")!(rawFile);
    await jest.advanceTimersByTimeAsync(10);

    expect(modals).toHaveLength(0);
    expect(existing.has("wiki/source.md")).toBe(true);
    expect(JSON.stringify(savedData[savedData.length - 1])).toContain("raw/source.md");
    expect(plugin.statusBarItems[0].history).toContain("ContextOS: applied");
  } finally {
    jest.useRealTimers();
  }
});

test("ingest command does not parse or OCR raw files without an API key", async () => {
  const requestSpy = jest.spyOn(obsidian, "requestUrl");
  const loadPdfSpy = jest.spyOn(obsidian, "loadPdfJs");
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "" });
  plugin.app = {
    vault: {
      getFiles: () => [new TFileMock("raw/scanned.pdf"), new TFileMock("raw/image.png")],
      readBinary: jest.fn(async () => new ArrayBuffer(4))
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  expect(notices).toContain("Set your OpenAI API key in ContextOS settings.");
  expect(requestSpy).not.toHaveBeenCalled();
  expect(loadPdfSpy).not.toHaveBeenCalled();
  expect((plugin.app as unknown as { vault: { readBinary: jest.Mock } }).vault.readBinary).not.toHaveBeenCalled();
});

test("ingest command updates persistent status bar for each long-running stage", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "ok", operations: [] }) } }]
    })
  } as never);

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const activeFile = new TFileMock("raw/source.md");
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key" });
  plugin.app = {
    workspace: {
      getActiveFile: () => activeFile
    },
    vault: {
      getFiles: () => [activeFile],
      getAbstractFileByPath: (path: string) => new TFileMock(path),
      read: async (file: { path: string }) => {
        if (file.path === "raw/source.md") return "source";
        if (file.path === "wiki/index.md") return "# Index";
        if (file.path === "wiki/log.md") return "# Log";
        return "";
      }
    }
  } as never;

  await plugin.onload();
  plugin.statusBarItems[0].history.length = 0;
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  expect(plugin.statusBarItems[0].history).toEqual([
    "ContextOS: scanning raw folder for changes...",
    "ContextOS: found 1 raw source candidate, no PDF candidates",
    "ContextOS: reading vault context...",
    "ContextOS: waiting for model response...",
    "ContextOS: validating proposed changes...",
    "ContextOS: review proposed changes"
  ]);
  expect(notices).toEqual([
    "ContextOS: scanning raw folder for changes...",
    "ContextOS: found 1 raw source candidate, no PDF candidates",
    "ContextOS: reading vault context...",
    "ContextOS: waiting for model response...",
    "ContextOS: validating proposed changes...",
    "ContextOS: review proposed changes."
  ]);
});

test("ingest command saves raw hashes only after applying the proposed changes", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "ok",
        operations: [{ kind: "create", path: "wiki/source.md", content: "# Source", rationale: "test" }]
      }) } }]
    })
  } as never);

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const activeFile = new TFileMock("raw/source.md");
  const savedData: unknown[] = [];
  const existing = new Set<string>();
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key", rawFileState: {} });
  jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
    savedData.push(data);
  });
  plugin.app = {
    workspace: {
      getActiveFile: () => activeFile
    },
    vault: {
      getFiles: () => [activeFile],
      getAbstractFileByPath: (path: string) => existing.has(path) ? new TFileMock(path) : null,
      createFolder: async (path: string) => {
        existing.add(path);
      },
      create: async (path: string) => {
        existing.add(path);
      },
      read: async (file: { path: string }) => {
        if (file.path === "raw/source.md") return "source";
        return "";
      }
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();
  expect(savedData).toHaveLength(0);

  const modals = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances;
  const latestModal = modals[modals.length - 1]!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(JSON.stringify(savedData[savedData.length - 1])).toContain("raw/source.md");
});

test("ingest command saves raw PDF hash after applying the proposed changes", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "ok",
        operations: [{ kind: "create", path: "wiki/report.md", content: "# Report", rationale: "test" }]
      }) } }]
    })
  } as never);
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: "PDF source" }] })
        })
      })
    })
  });

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const pdfFile = new TFileMock("raw/report.pdf");
  const savedData: unknown[] = [];
  const existing = new Set<string>();
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key", rawFileState: {} });
  jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
    savedData.push(data);
  });
  plugin.app = {
    vault: {
      getFiles: () => [pdfFile],
      getAbstractFileByPath: (path: string) => existing.has(path) ? new TFileMock(path) : null,
      createFolder: async (path: string) => {
        existing.add(path);
      },
      create: async (path: string) => {
        existing.add(path);
      },
      read: async () => "",
      readBinary: async () => new ArrayBuffer(4)
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();
  expect(savedData).toHaveLength(0);

  const modals = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances;
  const latestModal = modals[modals.length - 1]!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(JSON.stringify(savedData[savedData.length - 1])).toContain("raw/report.pdf");
});

test("OCR provider failures are localized at the ingest UI boundary", async () => {
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("zh");
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 401, text: "bad key" } as never);
  (globalThis as unknown as { document: { createElement(tag: string): unknown } }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,abc"
    })
  };
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] }),
          getViewport: () => ({ width: 1, height: 1 }),
          render: () => ({ promise: Promise.resolve() })
        })
      })
    })
  });
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const pdfFile = new TFileMock("raw/scanned.pdf");
  const plugin = new PluginMock();
  jest.spyOn(plugin, "loadData").mockResolvedValue({
    providers: [{ id: "default-openai", type: "openai", name: "OpenAI", apiKey: "bad", apiUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini", enabled: true }],
    activeProviderId: "default-openai",
    visionProviderId: "default-openai"
  });
  plugin.app = {
    vault: {
      getFiles: () => [pdfFile],
      readBinary: async () => new ArrayBuffer(4)
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  // Per-file isolation: the OCR failure is captured for raw/scanned.pdf and surfaced via the
  // "skipped unreadable" notice (carrying the underlying error) instead of aborting the scan.
  const expectedNotice = "ContextOS：已跳过无法读取的原始文件——解析原始文件失败：raw/scanned.pdf：OpenAI 请求失败：401 bad key";
  expect(plugin.statusBarItems[0].text).toBe(expectedNotice);
  expect(notices).toContain(expectedNotice);
  // The path must appear exactly once (no double-qualification from re-prepending the path).
  expect(expectedNotice.split("raw/scanned.pdf").length - 1).toBe(1);
});

test("runPrompt localizes OpenAI request failures at the UI boundary", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 401, text: "bad key" } as never);
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const plugin = new PluginMock();
  plugin.app = {} as never;
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "bad" });

  await plugin.onload();
  await (plugin as unknown as { runPrompt(prompt: string): Promise<void> }).runPrompt("{}");

  expect(plugin.statusBarItems[0].text).toBe("ContextOS: error - OpenAI request failed: 401 bad key");
  expect(notices).toContain("OpenAI request failed: 401 bad key");
});

test("runPrompt localizes invalid OpenAI JSON responses at the UI boundary", async () => {
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("zh");
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 200, text: "<!doctype html><html></html>" } as never);
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const plugin = new PluginMock();
  plugin.app = {} as never;
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key" });

  await plugin.onload();
  await (plugin as unknown as { runPrompt(prompt: string): Promise<void> }).runPrompt("{}");

  expect(plugin.statusBarItems[0].text).toBe("ContextOS：错误 - OpenAI 响应不是 JSON。请检查 API URL；它应指向聊天补全端点。");
  expect(notices).toContain("OpenAI 响应不是 JSON。请检查 API URL；它应指向聊天补全端点。");
});
