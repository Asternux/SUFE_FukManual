import assert from "node:assert/strict";
import test from "node:test";
import { attachNetworkMetadataRecorder } from "../src/logger/NetworkMetadataRecorder.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

test("network evidence records structure without query values or headers", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.route("https://eams.sufe.edu.cn/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "ok" });
    });
    const messages: string[] = [];
    let finish!: () => void;
    const recorded = new Promise<void>((resolve) => { finish = resolve; });
    const detach = attachNetworkMetadataRecorder(page, {
      info: async (_scope, message) => {
        messages.push(message);
        finish();
      },
      warn: async () => undefined
    });
    await page.setContent("<main>test</main>");
    await page.evaluate(async () => {
      await fetch(
        "https://eams.sufe.edu.cn/eams/stdElectCourse!batchOperator.action?profileId=123&electLessonIds=456&ticket=secret"
      );
    });
    await recorded;
    detach();

    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /"method":"GET"/);
    assert.match(messages[0]!, /stdElectCourse!batchOperator\.action/);
    assert.match(messages[0]!, /"electLessonIds","profileId","ticket"/);
    assert.doesNotMatch(messages[0]!, /123|456|secret/);
  } finally {
    await browser.close();
  }
});
