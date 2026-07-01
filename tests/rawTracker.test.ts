import * as obsidian from "obsidian";
import * as JSZip from "jszip";
import { findChangedRawFiles, findRawFileCandidates, hashBinaryContent, hashContent, hashOpenXmlContent, migrateRawFileState } from "../src/rawTracker";
import { DEFAULT_SETTINGS } from "../src/settings";

beforeEach(() => {
  jest.restoreAllMocks();
});

async function createOpenXmlPackage(entries: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test("hashContent changes when file content changes", () => {
  expect(hashContent("alpha")).toBe(hashContent("alpha"));
  expect(hashContent("alpha")).not.toBe(hashContent("beta"));
});

test("findRawFileCandidates reports raw text, code, PDF, image, HTML, and Office candidates", () => {
  const files = [
    { path: "raw/20260509.Skill.md" },
    { path: "raw/notes.txt" },
    { path: "raw/data.csv" },
    { path: "raw/code.ts" },
    { path: "raw/page.html" },
    { path: "raw/assets/image.png" },
    { path: "raw/中国中检福建公司【福利微课堂】第一期.pdf" },
    { path: "raw/file.doc" },
    { path: "raw/file.docx" },
    { path: "raw/file.xlsx" },
    { path: "raw/file.pptx" },
    { path: "wiki/page.md" },
    { path: "raw/ignored.exe" }
  ];

  const candidates = findRawFileCandidates(files as never, DEFAULT_SETTINGS);

  expect(candidates).toEqual({
    sourceFiles: [
      { path: "raw/20260509.Skill.md" },
      { path: "raw/notes.txt" },
      { path: "raw/data.csv" },
      { path: "raw/code.ts" },
      { path: "raw/page.html" },
      { path: "raw/assets/image.png" },
      { path: "raw/中国中检福建公司【福利微课堂】第一期.pdf" },
      { path: "raw/file.doc" },
      { path: "raw/file.docx" },
      { path: "raw/file.xlsx" },
      { path: "raw/file.pptx" }
    ],
    pdfPaths: ["raw/中国中检福建公司【福利微课堂】第一期.pdf"]
  });
});

test("findChangedRawFiles skips reading files whose mtime and size match recorded state", async () => {
  let reads = 0;
  const file = { path: "raw/a.md", stat: { mtime: 100, size: 5 } };
  const app = {
    vault: {
      getFiles: () => [file],
      read: async () => {
        reads++;
        return "content";
      }
    }
  };
  const state = { "raw/a.md": { hash: hashContent("content"), mtime: 100, size: 5 } };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, state);

  expect(changed).toEqual([]);
  expect(reads).toBe(0);
});

test("findChangedRawFiles re-reads a file whose size changed even if mtime matches", async () => {
  const file = { path: "raw/a.md", stat: { mtime: 100, size: 9 } };
  const app = {
    vault: {
      getFiles: () => [file],
      read: async () => "updated content"
    }
  };
  const state = { "raw/a.md": { hash: hashContent("old"), mtime: 100, size: 5 } };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, state);

  expect(changed).toEqual([
    { path: "raw/a.md", content: "updated content", hash: hashContent("updated content"), mtime: 100, size: 9 }
  ]);
});

test("migrateRawFileState upgrades legacy string hashes to entries", () => {
  const migrated = migrateRawFileState({ "raw/a.md": "abc123" });

  expect(migrated).toEqual({ "raw/a.md": { hash: "abc123", mtime: -1, size: -1 } });
});

test("migrateRawFileState keeps existing entry objects and defaults missing data", () => {
  const migrated = migrateRawFileState({
    "raw/a.md": { hash: "h1", mtime: 10, size: 20 },
    "raw/b.md": { hash: "h2" } as never
  });

  expect(migrated).toEqual({
    "raw/a.md": { hash: "h1", mtime: 10, size: 20 },
    "raw/b.md": { hash: "h2", mtime: -1, size: -1 }
  });
});

test("findChangedRawFiles returns new and changed markdown files only", async () => {
  const files = [
    { path: "raw/new.md" },
    { path: "raw/changed.md" },
    { path: "raw/unchanged.md" },
    { path: "wiki/page.md" },
    { path: "raw/tool.exe" }
  ];
  const contentByPath: Record<string, string> = {
    "raw/new.md": "new",
    "raw/changed.md": "changed-v2",
    "raw/unchanged.md": "same",
    "wiki/page.md": "wiki",
    "raw/tool.exe": "binary"
  };
  const app = {
    vault: {
      getFiles: () => files,
      read: async (file: { path: string }) => contentByPath[file.path]
    }
  };
  const state = {
    "raw/changed.md": hashContent("changed-v1"),
    "raw/unchanged.md": hashContent("same")
  };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, state);

  expect(changed).toEqual([
    { path: "raw/new.md", content: "new", hash: hashContent("new") },
    { path: "raw/changed.md", content: "changed-v2", hash: hashContent("changed-v2") }
  ]);
});

test("findChangedRawFiles extracts changed raw PDF text", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: pageNumber === 1
              ? [{ str: "First" }, { str: "page" }]
              : [{ str: "Second page" }]
          })
        })
      })
    })
  });
  const files = [
    { path: "raw/source.md" },
    { path: "raw/report.pdf" },
    { path: "wiki/report.pdf" }
  ];
  const app = {
    vault: {
      getFiles: () => files,
      read: async () => "markdown",
      readBinary: async () => new ArrayBuffer(4)
    }
  };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, {});

  expect(changed).toEqual([
    { path: "raw/source.md", content: "markdown", hash: hashContent("markdown") },
    { path: "raw/report.pdf", content: "First page\n\nSecond page", hash: hashBinaryContent(new ArrayBuffer(4)) }
  ]);
});

test("findChangedRawFiles extracts raw PDFs with uppercase extensions", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: "Uppercase PDF" }] })
        })
      })
    })
  });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/REPORT.PDF" }],
      readBinary: async () => new ArrayBuffer(4)
    }
  };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, {});

  expect(changed).toEqual([
    { path: "raw/REPORT.PDF", content: "Uppercase PDF", hash: hashBinaryContent(new ArrayBuffer(4)) }
  ]);
});

test("findChangedRawFiles extracts the reported Chinese PDF filename", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: "福利微课堂内容" }] })
        })
      })
    })
  });
  const path = "raw/中国中检福建公司【福利微课堂】第一期.pdf";
  const app = {
    vault: {
      getFiles: () => [{ path }],
      readBinary: async () => new ArrayBuffer(4)
    }
  };

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, {});

  expect(changed).toEqual([
    { path, content: "福利微课堂内容", hash: hashBinaryContent(new ArrayBuffer(4)) }
  ]);
});

test("findChangedRawFiles respects raw folders configured with a trailing slash", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: "Trailing slash" }] })
        })
      })
    })
  });
  const path = "raw/中国中检福建公司【福利微课堂】第一期.pdf";
  const app = {
    vault: {
      getFiles: () => [{ path }],
      readBinary: async () => new ArrayBuffer(4)
    }
  };

  const changed = await findChangedRawFiles(app as never, { ...DEFAULT_SETTINGS, rawFolder: "raw/" }, {});

  expect(changed).toEqual([
    { path, content: "Trailing slash", hash: hashBinaryContent(new ArrayBuffer(4)) }
  ]);
});

test("findChangedRawFiles falls back to OCR when a PDF has no text layer", async () => {
  const page = { getTextContent: async () => ({ items: [] }) };
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => page
      })
    })
  });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/scanned.pdf" }],
      readBinary: async () => new ArrayBuffer(4)
    }
  };
  const ocrProvider = jest.fn(async () => "OCR 福利微课堂");

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, {}, undefined, ocrProvider);

  expect(ocrProvider).toHaveBeenCalledWith({ page, path: "raw/scanned.pdf", pageNumber: 1 });
  expect(changed).toEqual([
    { path: "raw/scanned.pdf", content: "OCR 福利微课堂", hash: hashBinaryContent(new ArrayBuffer(4)) }
  ]);
});

test("findChangedRawFiles reports PDFs without extractable text", async () => {
  jest.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }) })
      })
    })
  });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/scanned.pdf" }],
      readBinary: async () => new ArrayBuffer(4)
    }
  };

  await expect(findChangedRawFiles(app as never, DEFAULT_SETTINGS, {}))
    .rejects.toThrow("No extractable text found in PDF: raw/scanned.pdf");
});

test("findChangedRawFiles skips PDF parsing and OCR for unchanged raw PDFs", async () => {
  const pdfBuffer = Uint8Array.from([1, 2, 3]).buffer;
  const loadPdfSpy = jest.spyOn(obsidian, "loadPdfJs");
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/scanned.pdf" }],
      readBinary: jest.fn(async () => pdfBuffer)
    }
  };
  const pdfOcrProvider = jest.fn(async () => "OCR text");

  const changed = await findChangedRawFiles(
    app as never,
    DEFAULT_SETTINGS,
    { "raw/scanned.pdf": hashBinaryContent(pdfBuffer) },
    undefined,
    pdfOcrProvider
  );

  expect(changed).toEqual([]);
  expect(loadPdfSpy).not.toHaveBeenCalled();
  expect(pdfOcrProvider).not.toHaveBeenCalled();
});

test("findChangedRawFiles extracts changed raw image text through OCR", async () => {
  const file = { path: "raw/screenshot.png" };
  const app = {
    vault: {
      getFiles: () => [file],
      readBinary: jest.fn(async () => Uint8Array.from([1, 2, 3]).buffer)
    }
  };
  const imageOcrProvider = jest.fn(async () => "Screenshot text");

  const changed = await findChangedRawFiles(app as never, DEFAULT_SETTINGS, {}, undefined, undefined, imageOcrProvider);

  expect(imageOcrProvider).toHaveBeenCalledTimes(1);
  expect(imageOcrProvider).toHaveBeenCalledWith({ path: "raw/screenshot.png", imageDataUrl: "data:image/png;base64,AQID" });
  expect(changed).toEqual([
    { path: "raw/screenshot.png", content: "Screenshot text", hash: hashBinaryContent(Uint8Array.from([1, 2, 3]).buffer) }
  ]);
});

test("findChangedRawFiles skips OCR for unchanged raw images", async () => {
  const imageBuffer = Uint8Array.from([1, 2, 3]).buffer;
  const file = { path: "raw/screenshot.png" };
  const app = {
    vault: {
      getFiles: () => [file],
      readBinary: jest.fn(async () => imageBuffer)
    }
  };
  const imageOcrProvider = jest.fn(async () => "Screenshot text");

  const changed = await findChangedRawFiles(
    app as never,
    DEFAULT_SETTINGS,
    { "raw/screenshot.png": hashBinaryContent(imageBuffer) },
    undefined,
    undefined,
    imageOcrProvider
  );

  expect(imageOcrProvider).not.toHaveBeenCalled();
  expect(changed).toEqual([]);
});

test("findChangedRawFiles skips PPTX parsing and OCR when binary content is unchanged", async () => {
  const pptxBuffer = await createOpenXmlPackage({
    "ppt/slides/slide1.xml": "<p:sld><a:t>Same</a:t></p:sld>"
  });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/deck.pptx" }],
      readBinary: jest.fn(async () => pptxBuffer)
    }
  };
  const imageOcrProvider = jest.fn(async () => "Slide OCR text");

  const changed = await findChangedRawFiles(
    app as never,
    DEFAULT_SETTINGS,
    { "raw/deck.pptx": await hashOpenXmlContent(pptxBuffer) },
    undefined,
    undefined,
    imageOcrProvider
  );

  expect(app.vault.readBinary).toHaveBeenCalledTimes(1);
  expect(imageOcrProvider).not.toHaveBeenCalled();
  expect(changed).toEqual([]);
});

test("findChangedRawFiles skips OpenXML metadata-only PPTX changes before OCR", async () => {
  const baseEntries = {
    "ppt/presentation.xml": "<p:presentation><p:sldIdLst><p:sldId r:id=\"rId1\"/></p:sldIdLst></p:presentation>",
    "ppt/_rels/presentation.xml.rels": "<Relationships><Relationship Id=\"rId1\" Target=\"slides/slide1.xml\"/></Relationships>",
    "ppt/slides/slide1.xml": "<p:sld><p:pic><a:blip r:embed=\"rId2\"/></p:pic></p:sld>",
    "ppt/slides/_rels/slide1.xml.rels": "<Relationships><Relationship Id=\"rId2\" Target=\"../media/image1.png\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\"/></Relationships>",
    "ppt/media/image1.png": Uint8Array.from([1, 2, 3])
  };
  const firstBuffer = await createOpenXmlPackage({ ...baseEntries, "docProps/core.xml": "created" });
  const reopenedBuffer = await createOpenXmlPackage({ ...baseEntries, "docProps/core.xml": "modified by Office reopen" });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/deck.pptx" }],
      readBinary: jest.fn(async () => reopenedBuffer)
    }
  };
  const imageOcrProvider = jest.fn(async () => "unstable OCR text");

  const changed = await findChangedRawFiles(
    app as never,
    DEFAULT_SETTINGS,
    { "raw/deck.pptx": await hashOpenXmlContent(firstBuffer) },
    undefined,
    undefined,
    imageOcrProvider
  );

  expect(imageOcrProvider).not.toHaveBeenCalled();
  expect(changed).toEqual([]);
});

test("findChangedRawFiles detects OpenXML PPTX slide content changes", async () => {
  const changedBuffer = await createOpenXmlPackage({
    "docProps/core.xml": "metadata",
    "ppt/slides/slide1.xml": "<p:sld><a:t>New</a:t></p:sld>"
  });
  const unchangedBuffer = await createOpenXmlPackage({
    "docProps/core.xml": "metadata",
    "ppt/slides/slide1.xml": "<p:sld><a:t>Old</a:t></p:sld>"
  });
  const app = {
    vault: {
      getFiles: () => [{ path: "raw/deck.pptx" }],
      readBinary: jest.fn(async () => changedBuffer)
    }
  };

  const changed = await findChangedRawFiles(
    app as never,
    DEFAULT_SETTINGS,
    { "raw/deck.pptx": await hashOpenXmlContent(unchangedBuffer) }
  );

  expect(changed).toEqual([
    { path: "raw/deck.pptx", content: "# Slide 1\nNew", hash: await hashOpenXmlContent(changedBuffer) }
  ]);
});
