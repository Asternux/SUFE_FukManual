import assert from "node:assert/strict";
import test from "node:test";
import type { LessonRecord } from "../src/browser/readCourseData.js";
import { resolveTargets } from "../src/resolver/resolveTargets.js";
import type { CourseTarget } from "../src/types.js";

const lessons: LessonRecord[] = [
  {
    id: "101",
    lessonNo: "0001",
    courseCode: "MATH101",
    name: "高等数学",
    teachers: "张老师",
    activities: [{ weekDay: 1, startUnit: 1, endUnit: 2, rooms: ["A101"] }],
    elected: false,
    defaultElected: false,
    withdrawable: true
  },
  {
    id: "102",
    lessonNo: "0002",
    courseCode: "MATH101",
    name: "高等数学",
    teachers: "李老师",
    activities: [{ weekDay: 2, startUnit: 3, endUnit: 4, rooms: ["B202"] }],
    elected: false,
    defaultElected: false,
    withdrawable: true
  }
];

function target(overrides: Partial<CourseTarget>): CourseTarget {
  return { name: "高等数学", priority: 1, ...overrides };
}

test("Phase 3 respects matcher priority", () => {
  const report = resolveTargets(
    [target({ lessonId: "102", courseCode: "WRONG", teacher: "张老师" })],
    lessons
  );
  assert.equal(report.ready, true);
  assert.equal(report.resolved[0]?.lesson.id, "102");
  assert.equal(report.resolved[0]?.method, "lessonId");
});

test("Phase 3 resolves course code and teacher", () => {
  const report = resolveTargets([target({ courseCode: "MATH101", teacher: "李老师" })], lessons);
  assert.equal(report.ready, true);
  assert.equal(report.resolved[0]?.lesson.id, "102");
});

test("Phase 3 resolves name, teacher, and human-readable time", () => {
  const report = resolveTargets([target({ teacher: "张老师", time: "星期一 1-2节" })], lessons);
  assert.equal(report.ready, true);
  assert.equal(report.resolved[0]?.lesson.id, "101");
});

test("Phase 3 blocks ambiguity", () => {
  const report = resolveTargets([target({ courseCode: "MATH101" })], lessons);
  assert.equal(report.ready, false);
  assert.equal(report.issues[0]?.code, "AMBIGUOUS");
  assert.equal(report.issues[0]?.candidates.length, 2);
});

test("Phase 3 blocks duplicate target lesson ids", () => {
  const report = resolveTargets(
    [target({ lessonId: "101" }), { name: "重复目标", lessonId: "101", priority: 2 }],
    lessons
  );
  assert.equal(report.ready, false);
  assert.equal(report.issues[0]?.code, "DUPLICATE_LESSON_ID");
});
