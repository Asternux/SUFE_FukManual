import assert from "node:assert/strict";
import test from "node:test";
import { AsyncMutex } from "../src/scheduler/AsyncMutex.js";

test("shared page mutex serializes tasks and enforces a global completion interval", async () => {
  const mutex = new AsyncMutex(25);
  const startedAt: number[] = [];
  await Promise.all([
    mutex.runExclusive(async () => { startedAt.push(Date.now()); }),
    mutex.runExclusive(async () => { startedAt.push(Date.now()); })
  ]);
  assert.equal(startedAt.length, 2);
  assert.ok(startedAt[1]! - startedAt[0]! >= 20);
});
