import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { appendUpdateLog } from "../src/publish/update-log.js";
import { projectRoot } from "../src/config/paths.js";

/** Against the real Config.Lua: exactly one entry is added, numbered next, nothing else moves. */
test("appendUpdateLog adds the next UpdateLogList entry", () => {
  const config = readFileSync(path.join(projectRoot, "TaiwuRus", "dist", "Config.Lua"), "utf8");
  const count = (s: string): number => (s.match(/\t\t\tTimestamp = \d+,/g) ?? []).length;
  const before = count(config);

  const out = appendUpdateLog(config, 42);

  assert.equal(count(out), before + 1);
  // Line endings are mixed in this file, so match either.
  const entry = new RegExp(
    String.raw`\t\t\[${before + 1}\] = \{\r?\n\t\t\tTimestamp = 42,\r?\n\t\t\},\r?\n(?=\t\},\r?\n\tChangeConfig)`,
  );
  assert.match(out, entry, "entry must close the list");
  assert.equal(out.replace(entry, ""), config);
});
