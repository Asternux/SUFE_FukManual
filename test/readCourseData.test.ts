import assert from "node:assert/strict";
import test from "node:test";
import { readCourseData } from "../src/browser/readCourseData.js";
import { launchInstalledBrowser } from "./browserTestHarness.js";

test("Phase 2 reads only normalized course business fields", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <script>
        window.lessonJSONs = [{
          id: 101, no: '0001', code: 'MATH101', courseId: 88,
          name: '高等数学', engName: 'Calculus', credits: 4,
          teachers: '张老师',
          arrangeInfo: [{weekDay: 1, startUnit: 1, endUnit: 2, rooms: ['A101']}]
        }];
        const runtimeLessons = [{...window.lessonJSONs[0], elected: true, defaultElected: true, withdrawable: true}];
        window.electCourseTable = {
          config: {profileId: 999},
          lessons: () => ({get: () => runtimeLessons})
        };
      </script>
    `);
    const data = await readCourseData(page);
    assert.equal(data.profileId, "999");
    assert.equal(data.lessons.length, 1);
    assert.deepEqual([...data.runtimeSelectedLessonIds], ["101"]);
    assert.deepEqual([...data.domSelectedLessonIds], []);
    assert.deepEqual([...data.selectedLessonIds], ["101"]);
    assert.deepEqual(data.lessons[0], {
      id: "101",
      lessonNo: "0001",
      courseCode: "MATH101",
      courseId: "88",
      name: "高等数学",
      englishName: "Calculus",
      credits: 4,
      teachers: "张老师",
      activities: [{ weekDay: 1, startUnit: 1, endUnit: 2, rooms: ["A101"] }],
      elected: true,
      defaultElected: true,
      withdrawable: true
    });
  } finally {
    await browser.close();
  }
});

test("Phase 7 treats the normal elected-course table as selected evidence when runtime flags lag", async () => {
  const browser = await launchInstalledBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="electedLessonList"><tbody><tr id="lesson101"><td>selected</td><td><a id="101" class="lessonListOperator" operator="WITHDRAW">退课</a></td></tr></tbody></table>
      <script>
        window.lessonJSONs = [{id: 101, no: '0001', code: 'MATH101', name: '高等数学', teachers: '张老师', arrangeInfo: []}];
        const runtimeLessons = [{...window.lessonJSONs[0], elected: false, defaultElected: false, withdrawable: true}];
        window.electCourseTable = {config: {profileId: 999}, lessons: () => ({get: () => runtimeLessons})};
      </script>
    `);
    const data = await readCourseData(page);
    assert.deepEqual([...data.runtimeSelectedLessonIds], []);
    assert.deepEqual([...data.domSelectedLessonIds], ["101"]);
    assert.deepEqual([...data.selectedLessonIds], ["101"]);
  } finally {
    await browser.close();
  }
});
