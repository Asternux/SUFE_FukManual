import type { LessonActivity, LessonRecord } from "../browser/readCourseData.js";
import type { CourseTarget } from "../types.js";

export type ResolutionMethod = "lessonId" | "lessonNo" | "courseCode+teacher" | "name+teacher+time";

export interface ResolvedTarget {
  target: CourseTarget;
  lesson: LessonRecord;
  method: ResolutionMethod;
}

export type ResolutionIssueCode = "NOT_FOUND" | "AMBIGUOUS" | "DUPLICATE_LESSON_ID" | "INSUFFICIENT_MATCHER";

export interface ResolutionIssue {
  target: CourseTarget;
  code: ResolutionIssueCode;
  message: string;
  candidates: LessonRecord[];
}

export interface ResolutionReport {
  resolved: ResolvedTarget[];
  issues: ResolutionIssue[];
  ready: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s,，、;；:：()（）\-_/]+/g, "");
}

function textMatches(actual: string, expected: string): boolean {
  const left = normalized(actual);
  const right = normalized(expected);
  return left === right || left.includes(right);
}

const weekDayNames = ["", "一", "二", "三", "四", "五", "六", "日"] as const;

function activityText(activity: LessonActivity): string[] {
  const weekDay = activity.weekDay;
  const start = activity.startUnit;
  const end = activity.endUnit;
  const rooms = activity.rooms.join(" ");
  const numeric = weekDay !== undefined && start !== undefined && end !== undefined
    ? `${weekDay} ${start}-${end} ${rooms}`
    : rooms;
  const chinese = weekDay !== undefined && weekDay >= 1 && weekDay <= 7 && start !== undefined && end !== undefined
    ? `星期${weekDayNames[weekDay]} ${start}-${end}节 ${rooms}`
    : rooms;
  return [numeric, chinese].filter(Boolean);
}

function matchesTime(lesson: LessonRecord, expected: string): boolean {
  return lesson.activities.some((activity) => activityText(activity).some((text) => textMatches(text, expected)));
}

function finishSingle(
  target: CourseTarget,
  candidates: LessonRecord[],
  method: ResolutionMethod
): ResolvedTarget | ResolutionIssue {
  if (candidates.length === 1) return { target, lesson: candidates[0]!, method };
  if (candidates.length === 0) {
    return { target, code: "NOT_FOUND", message: `${target.name}: no matching lesson`, candidates: [] };
  }
  return {
    target,
    code: "AMBIGUOUS",
    message: `${target.name}: ${candidates.length} lessons matched; add lessonId or a more specific matcher`,
    candidates
  };
}

export function resolveTarget(target: CourseTarget, lessons: LessonRecord[]): ResolvedTarget | ResolutionIssue {
  if (target.lessonId) {
    return finishSingle(target, lessons.filter((lesson) => lesson.id === target.lessonId), "lessonId");
  }
  if (target.lessonNo) {
    return finishSingle(target, lessons.filter((lesson) => lesson.lessonNo === target.lessonNo), "lessonNo");
  }
  if (target.courseCode) {
    const candidates = lessons.filter(
      (lesson) =>
        normalized(lesson.courseCode) === normalized(target.courseCode!) &&
        (!target.teacher || textMatches(lesson.teachers, target.teacher))
    );
    return finishSingle(target, candidates, "courseCode+teacher");
  }
  if (!target.teacher && !target.time) {
    return {
      target,
      code: "INSUFFICIENT_MATCHER",
      message: `${target.name}: name alone is not enough; add teacher, time, lessonNo, courseCode, or lessonId`,
      candidates: []
    };
  }
  const candidates = lessons.filter(
    (lesson) =>
      textMatches(lesson.name, target.name) &&
      (!target.teacher || textMatches(lesson.teachers, target.teacher)) &&
      (!target.time || matchesTime(lesson, target.time))
  );
  return finishSingle(target, candidates, "name+teacher+time");
}

export function resolveTargets(targets: CourseTarget[], lessons: LessonRecord[]): ResolutionReport {
  const ordered = [...targets].sort((left, right) => left.priority - right.priority);
  const resolved: ResolvedTarget[] = [];
  const issues: ResolutionIssue[] = [];
  const lessonOwners = new Map<string, ResolvedTarget>();

  for (const target of ordered) {
    const result = resolveTarget(target, lessons);
    if ("code" in result) {
      issues.push(result);
      continue;
    }
    const existing = lessonOwners.get(result.lesson.id);
    if (existing) {
      issues.push({
        target,
        code: "DUPLICATE_LESSON_ID",
        message: `${target.name}: resolves to lessonId=${result.lesson.id}, already used by ${existing.target.name}`,
        candidates: [result.lesson]
      });
      continue;
    }
    lessonOwners.set(result.lesson.id, result);
    resolved.push(result);
  }

  return { resolved, issues, ready: issues.length === 0 && resolved.length === targets.length };
}

export function formatCandidates(candidates: LessonRecord[]): string {
  return candidates
    .map(
      (lesson) =>
        `lessonId=${lesson.id} lessonNo=${lesson.lessonNo} code=${lesson.courseCode} name=${lesson.name} teachers=${lesson.teachers}`
    )
    .join("\n");
}
