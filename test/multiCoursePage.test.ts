import assert from "node:assert/strict";
import test from "node:test";
import type { Page, Route } from "playwright";
import { readCourseData, type LessonRecord } from "../src/browser/readCourseData.js";
import { PageSubmissionExecutor } from "../src/executor/PageSubmissionExecutor.js";
import { PageObservationProvider } from "../src/monitor/PageObservationProvider.js";
import type { ResolvedTarget } from "../src/resolver/resolveTargets.js";
import { AsyncMutex } from "../src/scheduler/AsyncMutex.js";
import { Scheduler } from "../src/scheduler/Scheduler.js";
import { CourseWorker, type WorkerLogSink } from "../src/state/CourseWorker.js";
import { CourseState, type RetryConfig } from "../src/types.js";
import { PageCourseVerifier } from "../src/verifier/PageCourseVerifier.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

const logger: WorkerLogSink = {
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined
};

function pageHtml(selected: Set<string>): string {
  const definitions = [
    { id: "101", no: "0001", code: "A101", name: "Course A" },
    { id: "102", no: "0002", code: "B102", name: "Course B" }
  ];
  const rows = definitions
    .map((lesson) => {
      const action = selected.has(lesson.id)
        ? ""
        : `<a class="lessonListOperator" id="${lesson.id}" operator="ELECTION" href="javascript:void(0)" onclick="fetch('/eams/stdElectCourse!batchOperator.action?profileId=TEST&electLessonIds=${lesson.id}&withdrawLessonIds=&v=1').then(r=>r.text());return false;">选课</a>`;
      return `<tr id="lesson${lesson.id}"><td>${lesson.no}</td><td>${action}</td></tr>`;
    })
    .join("");
  const data = definitions
    .map(
      (lesson) =>
        `{id:${lesson.id},no:'${lesson.no}',code:'${lesson.code}',courseId:${lesson.id},name:'${lesson.name}',teachers:'Teacher',arrangeInfo:[]}`
    )
    .join(",");
  const runtime = definitions
    .map(
      (lesson) =>
        `{...window.lessonJSONs.find(x=>x.id===${lesson.id}),elected:${selected.has(lesson.id)},defaultElected:${selected.has(lesson.id)},withdrawable:true}`
    )
    .join(",");
  return `<!doctype html>
    <div id="electCourseTableToolbar">选课时间表</div>
    <table id="electableLessonList"><thead><tr><th><button id="electableLessonList_filter_submit">search</button></th><th><input name="electableLesson.no"></th></tr></thead><tbody>${rows}</tbody></table>
    <table id="electedLessonList"><tbody></tbody></table>
    <script>
      window.lessonJSONs=[${data}];
      window.lessonId2Counts={'101':{sc:0,lc:1},'102':{sc:0,lc:1}};
      const runtimeLessons=[${runtime}];
      window.electCourseTable={config:{profileId:'TEST'},lessons:(...filters)=>{let result=runtimeLessons;for(const filter of filters){result=result.filter(item=>Object.entries(filter).every(([key,value])=>value&&typeof value==='object'&&'!is' in value?item[key]!==value['!is']:item[key]===value));}return {get:()=>result,first:()=>result[0]};},checkConflict:()=>[]};
    </script>`;
}

async function setup(page: Page) {
  const selected = new Set<string>();
  let active = 0;
  let maxActive = 0;
  let requests = 0;
  await page.route("https://eams.sufe.edu.cn/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/stdElectCourse!batchOperator.action")) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      requests += 1;
      const lessonId = url.searchParams.get("electLessonIds");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      if (lessonId) selected.add(lessonId);
      active -= 1;
      await route.fulfill({ status: 200, contentType: "text/html", body: "<div>accepted</div>" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/html", body: pageHtml(selected) });
  });
  await page.goto("https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=TEST");
  return { requests: () => requests, maxActive: () => maxActive };
}

function resolved(lesson: LessonRecord): ResolvedTarget {
  return {
    target: { name: lesson.name, lessonId: lesson.id, priority: Number(lesson.id) },
    lesson,
    method: "lessonId"
  };
}

test("Phase 8 advances two page workers independently while serializing the shared page transaction", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    const site = await setup(page);
    const data = await readCourseData(page);
    const executor = new PageSubmissionExecutor(page, data.lessons, { responseTimeoutMs: 2_000 });
    const verifier = new PageCourseVerifier(page);
    const mutex = new AsyncMutex();
    const retry: RetryConfig = {
      maxAttempts: 1,
      minDelayMs: 15,
      unknownVerificationDelayMs: 5,
      maxUnknownVerifications: 2
    };
    const workers = data.lessons.map(
      (lesson) => new CourseWorker(resolved(lesson), executor, verifier, retry, logger, mutex)
    );
    const scheduler = new Scheduler(workers, new PageObservationProvider(page), logger, { tickIntervalMs: 1 });
    await scheduler.start();
    assert.deepEqual(workers.map((worker) => worker.state), [CourseState.SUCCESS, CourseState.SUCCESS]);
    assert.deepEqual(workers.map((worker) => worker.attempts.length), [1, 1]);
    assert.equal(site.requests(), 2);
    assert.equal(site.maxActive(), 1);
  } finally {
    await browser.close();
  }
});
