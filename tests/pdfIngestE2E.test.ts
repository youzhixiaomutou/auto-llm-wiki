import * as obsidian from "obsidian";
import LLMWikiPlugin from "../src/main";
import { hashBinaryContent } from "../src/rawTracker";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;
const modals = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances;

type StoredFile = { path: string; content?: string; binary?: ArrayBuffer };

beforeEach(() => {
  notices.length = 0;
  modals.length = 0;
  jest.restoreAllMocks();
});

test("ingests a changed raw PDF into the wiki after review", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: pageNumber === 1
              ? [{ str: "PDF first page" }]
              : [{ str: "PDF second" }, { str: "page" }]
          })
        })
      })
    })
  });

  const requestSpy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "Create report page",
        operations: [{ kind: "create", path: "wiki/reports/report.md", content: "# Report\nPDF first page", rationale: "Capture PDF source" }]
      }) } }]
    })
  } as never);

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const pdfFile = new TFileMock("raw/report.pdf");
  const files = new Map<string, StoredFile>([
    ["raw/report.pdf", { path: "raw/report.pdf", binary: new ArrayBuffer(4) }],
    ["wiki/index.md", { path: "wiki/index.md", content: "# Index" }],
    ["wiki/log.md", { path: "wiki/log.md", content: "# Log" }]
  ]);
  const savedData: unknown[] = [];
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key", rawFileState: {} });
  jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
    savedData.push(data);
  });
  plugin.app = {
    vault: {
      getFiles: () => [pdfFile],
      getAbstractFileByPath: (path: string) => files.has(path) ? new TFileMock(path) : null,
      createFolder: async (path: string) => {
        files.set(path, { path });
      },
      create: async (path: string, content: string) => {
        files.set(path, { path, content });
      },
      read: async (file: { path: string }) => files.get(file.path)?.content ?? "",
      readBinary: async (file: { path: string }) => files.get(file.path)?.binary ?? new ArrayBuffer(0)
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  const modelRequest = requestSpy.mock.calls[0][0];
  if (typeof modelRequest === "string") throw new Error("Expected object request");
  const promptSentToModel = JSON.parse(String(modelRequest.body)).messages[1].content;
  expect(promptSentToModel).toContain("Source path: raw/report.pdf");
  expect(promptSentToModel).toContain("PDF first page\n\nPDF second page");
  expect(notices).toContain("ContextOS: found 1 raw source candidate, including PDFs: raw/report.pdf");
  expect(notices).toContain("ContextOS: extracting text from PDF raw/report.pdf...");
  expect(files.has("wiki/reports/report.md")).toBe(false);
  expect(savedData).toHaveLength(0);

  const latestModal = modals[modals.length - 1]!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(files.get("wiki/reports/report.md")?.content).toBe("# Report\nPDF first page");
  expect(savedData[savedData.length - 1]).toEqual(expect.objectContaining({
    rawFileState: { "raw/report.pdf": { hash: hashBinaryContent(new ArrayBuffer(4)), mtime: -1, size: -1 } }
  }));
});

test("uses vision OCR fallback for scanned PDFs before ingesting", async () => {
  const render = jest.fn(() => ({ promise: Promise.resolve() }));
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] }),
          getViewport: () => ({ width: 100, height: 120 }),
          render
        })
      })
    })
  });
  (globalThis as unknown as { document: { createElement(tag: string): unknown } }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,page-image"
    })
  };
  const requestSpy = jest.spyOn(obsidian, "requestUrl")
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "福利微课堂\n中国中检福建公司" } }] })
    } as never)
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: "Create scanned report page",
          operations: [{ kind: "create", path: "wiki/reports/scanned.md", content: "# 福利微课堂", rationale: "Capture OCR text" }]
        }) } }]
      })
    } as never);

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const pdfFile = new TFileMock("raw/scanned.pdf");
  const files = new Map<string, StoredFile>([
    ["raw/scanned.pdf", { path: "raw/scanned.pdf", binary: new ArrayBuffer(4) }],
    ["wiki/index.md", { path: "wiki/index.md", content: "# Index" }],
    ["wiki/log.md", { path: "wiki/log.md", content: "# Log" }]
  ]);
  const savedData: unknown[] = [];
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin & { statusBarItems: Array<{ text: string; history: string[] }> } })();
  jest.spyOn(plugin, "loadData").mockResolvedValue({
    providers: [{ id: "default-openai", type: "openai", name: "OpenAI", apiKey: "key", apiUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini", enabled: true }],
    activeProviderId: "default-openai",
    visionProviderId: "default-openai",
    rawFileState: {}
  });
  jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
    savedData.push(data);
  });
  plugin.app = {
    vault: {
      getFiles: () => [pdfFile],
      getAbstractFileByPath: (path: string) => files.has(path) ? new TFileMock(path) : null,
      createFolder: async (path: string) => {
        files.set(path, { path });
      },
      create: async (path: string, content: string) => {
        files.set(path, { path, content });
      },
      read: async (file: { path: string }) => files.get(file.path)?.content ?? "",
      readBinary: async (file: { path: string }) => files.get(file.path)?.binary ?? new ArrayBuffer(0)
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();

  const ocrRequest = requestSpy.mock.calls[0][0];
  if (typeof ocrRequest === "string") throw new Error("Expected object request");
  const ocrBody = JSON.parse(String(ocrRequest.body));
  expect(ocrBody.messages[1].content[0].text).toContain("Transcribe all visible text");
  expect(ocrBody.messages[1].content[1].image_url.url).toBe("data:image/png;base64,page-image");
  const ingestRequest = requestSpy.mock.calls[1][0];
  if (typeof ingestRequest === "string") throw new Error("Expected object request");
  const ingestPrompt = JSON.parse(String(ingestRequest.body)).messages[1].content;
  expect(ingestPrompt).toContain("福利微课堂\n中国中检福建公司");
  expect(notices).toContain("ContextOS: OCR PDF page 1 from raw/scanned.pdf...");

  const latestModal = modals[modals.length - 1]!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(render).toHaveBeenCalled();
  expect(files.get("wiki/reports/scanned.md")?.content).toBe("# 福利微课堂");
  expect(savedData[savedData.length - 1]).toEqual(expect.objectContaining({
    rawFileState: { "raw/scanned.pdf": { hash: hashBinaryContent(new ArrayBuffer(4)), mtime: -1, size: -1 } }
  }));
});
