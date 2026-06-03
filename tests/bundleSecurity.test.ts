import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const projectRoot = join(__dirname, "..");

test("production bundle does not create script elements dynamically", () => {
  execFileSync(process.execPath, ["esbuild.config.mjs", "production"], { cwd: projectRoot, stdio: "pipe" });

  const bundle = readFileSync(join(projectRoot, "main.js"), "utf8");
  const dynamicScriptCreations = bundle.match(/createElement\((["'])script\1\)/g) ?? [];

  expect(dynamicScriptCreations).toEqual([]);
});
