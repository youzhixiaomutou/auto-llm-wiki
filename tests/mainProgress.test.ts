import * as obsidian from "obsidian";
import LLMWikiPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;

beforeEach(() => {
  notices.length = 0;
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("en");
  jest.restoreAllMocks();
});

test("onload initializes persistent status bar as idle", async () => {
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string }> } };
  const plugin = new PluginMock();
  plugin.app = {} as never;

  await plugin.onload();

  expect(plugin.statusBarItems[0].text).toBe("Auto LLM Wiki: idle");
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
    "Auto LLM Wiki: scanning raw folder for changes...",
    "Auto LLM Wiki: found 1 raw source candidate, no PDF candidates",
    "Auto LLM Wiki: reading vault context...",
    "Auto LLM Wiki: waiting for model response...",
    "Auto LLM Wiki: validating proposed changes...",
    "Auto LLM Wiki: review proposed changes"
  ]);
  expect(notices).toEqual([
    "Auto LLM Wiki: scanning raw folder for changes...",
    "Auto LLM Wiki: found 1 raw source candidate, no PDF candidates",
    "Auto LLM Wiki: reading vault context...",
    "Auto LLM Wiki: waiting for model response...",
    "Auto LLM Wiki: validating proposed changes...",
    "Auto LLM Wiki: review proposed changes."
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

  const latestModal = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances.at(-1)!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(JSON.stringify(savedData.at(-1))).toContain("raw/source.md");
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

  const latestModal = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances.at(-1)!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(JSON.stringify(savedData.at(-1))).toContain("raw/report.pdf");
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
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "bad" });
  plugin.app = {
    vault: {
      getFiles: () => [pdfFile],
      readBinary: async () => new ArrayBuffer(4)
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  expect(plugin.statusBarItems[0].text).toBe("Auto LLM Wiki：错误 - OpenAI 请求失败：401 bad key");
  expect(notices).toContain("OpenAI 请求失败：401 bad key");
});

test("runPrompt localizes OpenAI request failures at the UI boundary", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 401, text: "bad key" } as never);
  const PluginMock = LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } };
  const plugin = new PluginMock();
  plugin.app = {} as never;
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "bad" });

  await plugin.onload();
  await (plugin as unknown as { runPrompt(prompt: string): Promise<void> }).runPrompt("{}");

  expect(plugin.statusBarItems[0].text).toBe("Auto LLM Wiki: error - OpenAI request failed: 401 bad key");
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

  expect(plugin.statusBarItems[0].text).toBe("Auto LLM Wiki：错误 - OpenAI 响应不是 JSON。请检查 API URL；它应指向聊天补全端点。");
  expect(notices).toContain("OpenAI 响应不是 JSON。请检查 API URL；它应指向聊天补全端点。");
});
