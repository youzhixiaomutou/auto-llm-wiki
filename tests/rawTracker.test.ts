import * as obsidian from "obsidian";
import { findChangedRawFiles, findRawFileCandidates, hashContent } from "../src/rawTracker";
import { DEFAULT_SETTINGS } from "../src/settings";

test("hashContent changes when file content changes", () => {
  expect(hashContent("alpha")).toBe(hashContent("alpha"));
  expect(hashContent("alpha")).not.toBe(hashContent("beta"));
});

test("findRawFileCandidates reports raw source and PDF candidates", () => {
  const files = [
    { path: "raw/20260509.Skill.md" },
    { path: "raw/中国中检福建公司【福利微课堂】第一期.pdf" },
    { path: "wiki/page.md" },
    { path: "raw/assets/image.png" }
  ];

  const candidates = findRawFileCandidates(files as never, DEFAULT_SETTINGS);

  expect(candidates).toEqual({
    sourceFiles: [
      { path: "raw/20260509.Skill.md" },
      { path: "raw/中国中检福建公司【福利微课堂】第一期.pdf" }
    ],
    pdfPaths: ["raw/中国中检福建公司【福利微课堂】第一期.pdf"]
  });
});

test("findChangedRawFiles returns new and changed markdown files only", async () => {
  const files = [
    { path: "raw/new.md" },
    { path: "raw/changed.md" },
    { path: "raw/unchanged.md" },
    { path: "wiki/page.md" },
    { path: "raw/image.png" }
  ];
  const contentByPath: Record<string, string> = {
    "raw/new.md": "new",
    "raw/changed.md": "changed-v2",
    "raw/unchanged.md": "same",
    "wiki/page.md": "wiki",
    "raw/image.png": "binary"
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
    { path: "raw/report.pdf", content: "First page\n\nSecond page", hash: hashContent("First page\n\nSecond page") }
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
    { path: "raw/REPORT.PDF", content: "Uppercase PDF", hash: hashContent("Uppercase PDF") }
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
    { path, content: "福利微课堂内容", hash: hashContent("福利微课堂内容") }
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
    { path, content: "Trailing slash", hash: hashContent("Trailing slash") }
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
    { path: "raw/scanned.pdf", content: "OCR 福利微课堂", hash: hashContent("OCR 福利微课堂") }
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
