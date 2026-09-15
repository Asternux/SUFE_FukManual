import assert from "node:assert/strict";
import test from "node:test";
import type { Page, Route } from "playwright";
import { readCourseData } from "../src/browser/readCourseData.js";
import { classifySubmissionResponse } from "../src/executor/classifySubmission.js";
import { PageSubmissionExecutor } from "../src/executor/PageSubmissionExecutor.js";
import { PageObservationProvider } from "../src/monitor/PageObservationProvider.js";
import { PageCourseVerifier } from "../src/verifier/PageCourseVerifier.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

function renderCoursePage(selected: boolean, dialogMessage?: string): string {
  const clickBody = dialogMessage
    ? `if (!confirm('${dialogMessage.replaceAll("'", "\\'")}')) return false; return false;`
    : `fetch('/eams/stdElectCourse!batchOperator.action?profileId=TEST&electLessonIds=101&withdrawLessonIds=&v=1')
         .then(response => response.text())
         .then(html => { document.querySelector('#cboxLoadedContent').innerHTML = html; }); return false;`;
  return `<!doctype html>
    <table id="electableLessonList">
      <thead><tr><th><button id="electableLessonList_filter_submit">search</button></th><th><input name="electableLesson.no"></th></tr></thead>
      <tbody><tr id="lesson101"><td>0001</td><td><a class="lessonListOperator" id="101" operator="ELECTION" href="javascript:void(0)" onclick="${clickBody}">选课</a></td></tr></tbody>
    </table>
    <table id="electedLessonList"><tbody>${selected ? '<tr id="lesson101"><td>selected</td></tr>' : ""}</tbody></table>
    <div id="electCourseTableToolbar">选课时间表</div><div id="cboxLoadedContent"></div>
    <button id="cboxClose" onclick="this.dataset.closed='true'">关闭</button>
    <script>
      window.lessonJSONs = [{id: 101, no: '0001', code: 'MATH101', courseId: 88, name: '高等数学', credits: 4, teachers: '张老师', arrangeInfo: []}];
      window.lessonId2Counts = {'101': {sc: 0, lc: 1}};
      const runtimeLessons = [{...window.lessonJSONs[0], elected: ${selected}, defaultElected: ${selected}, withdrawable: true}];
      window.electCourseTable = {
        config: {profileId: 'TEST'},
        lessons: (...filters) => {
          let result = runtimeLessons;
          for (const filter of filters) {
            result = result.filter(item => Object.entries(filter).every(([key, value]) => {
              if (value && typeof value === 'object' && '!is' in value) return item[key] !== value['!is'];
              return item[key] === value;
            }));
          }
          return {get: () => result, first: () => result[0]};
        },
        checkConflict: () => []
      };
    </script>`;
}

async function setupMockSite(page: Page, mode: "success" | "full" | "dialog") {
  let selected = false;
  let batchRequests = 0;
  await page.route("https://eams.sufe.edu.cn/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/stdElectCourse!batchOperator.action")) {
      batchRequests += 1;
      if (mode === "success") selected = true;
      await route.fulfill({
        status: 200,
        contentType: "text/html;charset=UTF-8",
        body: mode === "full" ? "<div>人数已满</div>" : "<div>操作已受理</div>"
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html;charset=UTF-8",
      body: renderCoursePage(selected, mode === "dialog" ? "检测到时间冲突，是否继续？" : undefined)
    });
  });
  await page.goto("https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=TEST");
  return { batchRequests: () => batchRequests };
}

test("Phase 6 follows the normal page click and Phase 7 verifies after reload", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    const site = await setupMockSite(page, "success");
    const data = await readCourseData(page);
    const executor = new PageSubmissionExecutor(page, data.lessons, { responseTimeoutMs: 2_000 });
    const submission = await executor.submit({
      attemptId: "attempt-1",
      lessonId: "101",
      signal: new AbortController().signal
    });
    assert.equal(submission.kind, "SUBMITTED");
    assert.equal(site.batchRequests(), 1);
    assert.equal(await page.locator("#cboxClose").getAttribute("data-closed"), "true");
    const verification = await new PageCourseVerifier(page).verify("101", new AbortController().signal);
    assert.equal(verification.status, "SELECTED");
  } finally {
    await browser.close();
  }
});

test("Phase 6 classifies a full response but still leaves success to the verifier", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await setupMockSite(page, "full");
    const data = await readCourseData(page);
    const executor = new PageSubmissionExecutor(page, data.lessons, { responseTimeoutMs: 2_000 });
    const submission = await executor.submit({
      attemptId: "attempt-2",
      lessonId: "101",
      signal: new AbortController().signal
    });
    assert.equal(submission.kind, "FULL");
    const verification = await new PageCourseVerifier(page).verify("101", new AbortController().signal);
    assert.equal(verification.status, "NOT_SELECTED");
  } finally {
    await browser.close();
  }
});

test("Phase 6 dismisses a conflict confirmation instead of bypassing it", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    const site = await setupMockSite(page, "dialog");
    const data = await readCourseData(page);
    const executor = new PageSubmissionExecutor(page, data.lessons, { responseTimeoutMs: 2_000 });
    const submission = await executor.submit({
      attemptId: "attempt-3",
      lessonId: "101",
      signal: new AbortController().signal
    });
    assert.equal(submission.kind, "CONFLICT");
    assert.equal(site.batchRequests(), 0);
  } finally {
    await browser.close();
  }
});

test("Phase 6 never treats HTTP 200 as success", () => {
  const result = classifySubmissionResponse({
    status: 200,
    method: "GET",
    contentType: "text/html",
    bodyText: "<div>操作完成</div>"
  });
  assert.equal(result.kind, "SUBMITTED");
});

test("Phase 6 classifies an explicit eligibility failure shown by the result HTML", () => {
  const result = classifySubmissionResponse({
    status: 200,
    method: "GET",
    contentType: "text/html",
    bodyText: "<div>已超过该模块允许选择的课程门数上限</div>"
  });
  assert.equal(result.kind, "NOT_ELIGIBLE");
  assert.equal(result.retryable, false);
});

test("Phase 6 keeps a generic business failure unknown until verification", () => {
  const result = classifySubmissionResponse({
    status: 200,
    method: "GET",
    contentType: "text/html",
    bodyText: "<div>选课失败，请稍后查看最终状态</div>"
  });
  assert.equal(result.kind, "UNKNOWN");
  assert.equal(result.retryable, true);
});

test("Preflight uses one page snapshot for selected state, conflict checks, and counts", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await setupMockSite(page, "success");
    const provider = new PageObservationProvider(page);
    const observations = await provider.observe(["101"], new AbortController().signal);
    assert.deepEqual(observations.get("101"), {
      lessonId: "101",
      electionOpen: true,
      pageActionAvailable: true,
      selected: false,
      count: { lessonId: "101", sc: 0, lc: 1, nominalAvailable: true }
    });
  } finally {
    await browser.close();
  }
});

test("Preflight identifies the selected lesson causing a time conflict", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await setupMockSite(page, "success");
    await page.evaluate(() => {
      const table = (window as unknown as { electCourseTable: { checkConflict: () => unknown } }).electCourseTable;
      table.checkConflict = () => ({
        lessons: { l999: { id: 999, name: "Existing Course" } },
        length: 1
      });
    });
    const observation = (await new PageObservationProvider(page).observe(
      ["101"],
      new AbortController().signal
    )).get("101");
    assert.equal(observation?.block, "CONFLICT");
    assert.match(observation?.detail ?? "", /Existing Course\(lessonId=999\)/);
  } finally {
    await browser.close();
  }
});
