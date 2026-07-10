import { ChangePlanPreviewModal } from "../src/previewModal";
import { Notice } from "obsidian";
import { __setLanguage } from "./obsidianMock";

const notices = (Notice as unknown as { messages: string[] }).messages;

beforeEach(() => {
  __setLanguage("en");
  notices.length = 0;
});

test("applies critical shell width inline so modal widens without external CSS", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "Create page",
    operations: []
  });

  modal.onOpen();
  const modalEl = modal.modalEl as unknown as { classes: string[]; styles: Record<string, string> };

  expect(modalEl.classes).toContain("contextos-review-modal-shell");
  expect(modalEl.styles.width).toBe("min(1120px, 96vw)");
  expect(modalEl.styles["max-width"]).toBe("1120px");
});

test("renders a content block for an empty-content update so blanking a file is visible", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "reset",
    operations: [{ kind: "update", path: "wiki/index.md", content: "", rationale: "reset index" }]
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { classes: string[] };

  expect(contentEl.classes).toContain("contextos-code-preview");
});

test("renders a delete operation with its label and path", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "Remove orphan",
    operations: [{ kind: "delete", path: "wiki/orphan.md", content: "", rationale: "no supporting source" }]
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { texts: string[] };

  expect(contentEl.texts).toEqual(expect.arrayContaining(["DELETE", "wiki/orphan.md", "no supporting source", "1 delete"]));
});

test("renders a polished card-based review layout", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "Integrate source notes",
    operations: [
      { kind: "create", path: "wiki/topic.md", content: "# Topic", rationale: "New topic page" },
      { kind: "append", path: "wiki/log.md", content: "log entry", rationale: "Record ingest" }
    ]
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { classes: string[]; texts: string[] };

  expect(contentEl.classes).toEqual(expect.arrayContaining([
    "contextos-review-modal",
    "contextos-review-hero",
    "contextos-review-stats",
    "contextos-stat-chip",
    "contextos-operation-card",
    "contextos-operation-badge",
    "contextos-path-pill",
    "contextos-code-preview",
    "contextos-action-bar"
  ]));
  expect(contentEl.texts).toEqual(expect.arrayContaining([
    "Review ContextOS changes",
    "Integrate source notes",
    "2 proposed file changes",
    "1 create",
    "1 append",
    "CREATE",
    "APPEND",
    "wiki/topic.md",
    "wiki/log.md"
  ]));
});

test("renders prepend operations in preview summaries", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "latest log",
    operations: [
      { kind: "prepend", path: "wiki/log.md", content: "new entry", rationale: "Record newest first" }
    ]
  }, jest.fn());

  modal.onOpen();

  const texts = (modal.contentEl as unknown as { texts: string[] }).texts;
  expect(texts).toContain("1 prepend");
  expect(texts).toContain("PREPEND");
  expect(texts).toContain("wiki/log.md");
});

test("shows an empty-plan explanation when there are no proposed operations", () => {
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "",
    operations: []
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { texts: string[] };

  expect(contentEl.texts).toContain("Review ContextOS changes");
  expect(contentEl.texts).toContain("No file changes were proposed by the model.");
  expect(contentEl.texts).toContain("0 proposed file changes");
});

test("localizes preview modal chrome in Simplified Chinese", () => {
  __setLanguage("zh");
  const modal = new ChangePlanPreviewModal({} as never, {
    summary: "",
    operations: [{ kind: "create", path: "wiki/page.md", content: "# Page", rationale: "test" }]
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { texts: string[] };

  expect(contentEl.texts).toEqual(expect.arrayContaining([
    "审阅 ContextOS 变更",
    "模型未提供摘要。",
    "应用变更",
    "创建"
  ]));
});

test("updates status while applying changes and after success", async () => {
  const statuses: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async () => {}
    }
  };
  const modal = new ChangePlanPreviewModal(app as never, {
    summary: "Create page",
    operations: [{ kind: "create", path: "wiki/page.md", content: "# Page", rationale: "test" }]
  }, (message) => statuses.push(message));

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { buttons: Array<{ onclick: () => Promise<void> }> };
  await contentEl.buttons[0].onclick();

  expect(statuses).toEqual(["ContextOS: applying changes...", "ContextOS: applied"]);
});

test("updates status when applying changes fails", async () => {
  const statuses: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async () => {
        throw new Error("Folder does not exist");
      }
    }
  };
  const modal = new ChangePlanPreviewModal(app as never, {
    summary: "Create page",
    operations: [{ kind: "create", path: "wiki/page.md", content: "# Page", rationale: "test" }]
  }, (message) => statuses.push(message));

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { buttons: Array<{ onclick: () => Promise<void> }> };
  await contentEl.buttons[0].onclick();

  expect(statuses).toEqual([
    "ContextOS: applying changes...",
    "ContextOS: error - Folder does not exist"
  ]);
});

test("shows an error notice when applying changes fails", async () => {
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      createFolder: async () => {},
      create: async () => {
        throw new Error("Folder does not exist");
      }
    }
  };
  const modal = new ChangePlanPreviewModal(app as never, {
    summary: "Create page",
    operations: [{ kind: "create", path: "wiki/page.md", content: "# Page", rationale: "test" }]
  });

  modal.onOpen();
  const contentEl = modal.contentEl as unknown as { buttons: Array<{ onclick: () => Promise<void> }> };
  await contentEl.buttons[0].onclick();

  expect(notices).toContain("Failed to apply ContextOS changes: Folder does not exist");
});
