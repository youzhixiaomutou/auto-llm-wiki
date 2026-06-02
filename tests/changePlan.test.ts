import { parseChangePlan, validateChangePlan } from "../src/changePlan";
import { DEFAULT_SETTINGS } from "../src/settings";
import { __setLanguage } from "./obsidianMock";

beforeEach(() => {
  __setLanguage("en");
});

test("parses fenced json change plans", () => {
  const plan = parseChangePlan("```json\n{\"summary\":\"ok\",\"operations\":[]}\n```");
  expect(plan.summary).toBe("ok");
  expect(plan.operations).toEqual([]);
});

test("rejects null change plans with localized shape error", () => {
  expect(() => parseChangePlan("null")).toThrow("Invalid change plan shape");
});

test("rejects null operations with localized operation kind error", () => {
  expect(() => parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [null]
  }))).toThrow("Invalid operation kind");
});

test("rejects writes outside wiki folder", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "update", path: "raw/source.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, DEFAULT_SETTINGS)).toThrow("outside wiki folder");
});

test("localizes writes outside wiki folder errors in Simplified Chinese", () => {
  __setLanguage("zh");
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "update", path: "raw/source.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, DEFAULT_SETTINGS)).toThrow("操作路径不在 wiki 文件夹中：raw/source.md");
});

test("accepts index and log paths", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "ok",
    operations: [
      { kind: "update", path: "wiki/index.md", content: "# Index", rationale: "refresh" },
      { kind: "append", path: "wiki/log.md", content: "entry", rationale: "record" }
    ]
  }));
  expect(validateChangePlan(plan, DEFAULT_SETTINGS)).toEqual(plan);
});

test("rejects configured index path outside wiki folder", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "update", path: "raw/index.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, { ...DEFAULT_SETTINGS, indexPath: "raw/index.md" })).toThrow("Index path must be inside the wiki folder");
});

test("rejects configured log path outside wiki folder", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "append", path: "notes/log.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, { ...DEFAULT_SETTINGS, logPath: "notes/log.md" })).toThrow("Log path must be inside the wiki folder");
});

test("rejects writes inside configured raw folder even when nested under wiki", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "update", path: "wiki/raw/source.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, { ...DEFAULT_SETTINGS, rawFolder: "wiki/raw" })).toThrow("Operation path is inside a read-only folder");
});

test("rejects writes inside configured assets folder even when nested under wiki", () => {
  const plan = parseChangePlan(JSON.stringify({
    summary: "bad",
    operations: [{ kind: "update", path: "wiki/assets/image.md", content: "x", rationale: "bad" }]
  }));
  expect(() => validateChangePlan(plan, { ...DEFAULT_SETTINGS, assetsFolder: "wiki/assets" })).toThrow("Operation path is inside a read-only folder");
});
