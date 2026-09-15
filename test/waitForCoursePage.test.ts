import assert from "node:assert/strict";
import test from "node:test";
import { isCoursePage, waitForCoursePage } from "../src/browser/waitForCoursePage.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

test("Phase 1 identifies the course page by URL and required DOM", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.route("https://eams.sufe.edu.cn/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html;charset=UTF-8",
        body: "<!doctype html><table id='electableLessonList'><tbody><tr><td>课程</td></tr></tbody></table>"
      });
    });
    await page.goto("https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=TEST");
    assert.equal(await isCoursePage(page), true);
    await waitForCoursePage(page, 1_000);
  } finally {
    await browser.close();
  }
});

test("Phase 1 rejects a login page even if it has similar markup", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.route("https://login.sufe.edu.cn/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<div id='electableLessonList'></div>" });
    });
    await page.goto("https://login.sufe.edu.cn/login/");
    assert.equal(await isCoursePage(page), false);
  } finally {
    await browser.close();
  }
});
