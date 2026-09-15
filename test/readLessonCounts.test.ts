import assert from "node:assert/strict";
import test from "node:test";
import { readLessonCounts } from "../src/monitor/readLessonCounts.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

test("Phase 4 reads one in-memory count mapping for all targets", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <script>
        window.lessonId2Counts = {
          '101': {sc: 9, lc: 10},
          '102': {sc: 12, lc: 10},
          '103': {sc: 0, lc: 0}
        };
      </script>
    `);
    const snapshot = await readLessonCounts(page, ["101", "102", "103", "404"]);
    assert.deepEqual(snapshot.counts.get("101"), {
      lessonId: "101",
      sc: 9,
      lc: 10,
      nominalAvailable: true
    });
    assert.equal(snapshot.counts.get("102")?.nominalAvailable, false);
    assert.equal(snapshot.counts.get("103")?.nominalAvailable, false);
    assert.deepEqual(snapshot.missingLessonIds, ["404"]);
  } finally {
    await browser.close();
  }
});
