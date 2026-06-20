import assert from "node:assert/strict";
import { test } from "node:test";

import { Progress } from "../src/cli/progress.js";

test("Progress methods are safe to call (no throw) regardless of TTY", () => {
  const bar = new Progress(3, "test");
  assert.doesNotThrow(() => {
    bar.increment("a");
    bar.note("working");
    bar.increment("b");
    bar.increment("c");
    bar.finish("done");
  });
});

test("Progress tolerates a zero total", () => {
  const bar = new Progress(0, "empty");
  assert.doesNotThrow(() => bar.finish());
});
