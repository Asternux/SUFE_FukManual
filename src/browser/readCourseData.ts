import type { Page } from "playwright";

export interface LessonActivity {
  weekDay?: number;
  startUnit?: number;
  endUnit?: number;
  rooms: string[];
}

export interface LessonRecord {
  id: string;
  lessonNo: string;
  courseCode: string;
  courseId?: string;
  name: string;
  englishName?: string;
  credits?: number;
  teachers: string;
  activities: LessonActivity[];
  elected: boolean;
  defaultElected: boolean;
  withdrawable: boolean;
}

export interface CoursePageData {
  profileId: string;
  lessons: LessonRecord[];
  runtimeSelectedLessonIds: Set<string>;
  domSelectedLessonIds: Set<string>;
  selectedLessonIds: Set<string>;
}

interface RawPageData {
  profileId: unknown;
  domSelectedLessonIds: string[];
  lessons: Array<{
    id: unknown;
    no: unknown;
    code: unknown;
    courseId: unknown;
    name: unknown;
    engName: unknown;
    credits: unknown;
    teachers: unknown;
    arrangeInfo: unknown;
    elected: unknown;
    defaultElected: unknown;
    withdrawable: unknown;
  }>;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeActivities(value: unknown): LessonActivity[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const rawRooms = record.rooms;
    const rooms = Array.isArray(rawRooms)
      ? rawRooms.map(stringValue).filter(Boolean)
      : optionalString(rawRooms)?.split(",").map((room) => room.trim()).filter(Boolean) ?? [];
    const activity: LessonActivity = { rooms };
    const weekDay = numberValue(record.weekDay);
    const startUnit = numberValue(record.startUnit);
    const endUnit = numberValue(record.endUnit);
    if (weekDay !== undefined) activity.weekDay = weekDay;
    if (startUnit !== undefined) activity.startUnit = startUnit;
    if (endUnit !== undefined) activity.endUnit = endUnit;
    return activity;
  });
}

export async function readCourseData(page: Page): Promise<CoursePageData> {
  await page.waitForFunction(
    () => Array.isArray((window as unknown as { lessonJSONs?: unknown }).lessonJSONs),
    undefined,
    { timeout: 20_000 }
  );

  const raw = await page.evaluate<RawPageData>(() => {
    type RuntimeLesson = Record<string, unknown>;
    type TaffyQuery = { get?: () => RuntimeLesson[] };
    type CourseTable = {
      config?: { profileId?: unknown };
      lessons?: () => TaffyQuery;
    };
    const pageWindow = window as unknown as {
      lessonJSONs?: RuntimeLesson[];
      electCourseTable?: CourseTable;
    };
    const sourceLessons = Array.isArray(pageWindow.lessonJSONs) ? pageWindow.lessonJSONs : [];
    const runtimeLessons = pageWindow.electCourseTable?.lessons?.().get?.() ?? [];
    const runtimeById = new Map(runtimeLessons.map((lesson) => [String(lesson.id), lesson]));
    const lessons = sourceLessons.map((lesson) => {
      const runtime = runtimeById.get(String(lesson.id)) ?? lesson;
      return {
        id: lesson.id,
        no: lesson.no,
        code: lesson.code,
        courseId: lesson.courseId,
        name: lesson.name,
        engName: lesson.engName,
        credits: lesson.credits,
        teachers: lesson.teachers,
        arrangeInfo: lesson.arrangeInfo,
        elected: runtime.elected,
        defaultElected: runtime.defaultElected,
        withdrawable: runtime.withdrawable
      };
    });
    const domSelectedLessonIds = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#electedLessonList tr[id^="lesson"], #electedLessonList a.lessonListOperator[operator="WITHDRAW"]'
      )
    )
      .map((element) => element.id.replace(/^lesson/, ""))
      .filter((id) => /^\d+$/.test(id));
    return { profileId: pageWindow.electCourseTable?.config?.profileId, lessons, domSelectedLessonIds };
  });

  const lessons = raw.lessons.map((lesson) => {
    const course: LessonRecord = {
      id: stringValue(lesson.id),
      lessonNo: stringValue(lesson.no),
      courseCode: stringValue(lesson.code),
      name: stringValue(lesson.name),
      teachers: Array.isArray(lesson.teachers) ? lesson.teachers.map(stringValue).join(",") : stringValue(lesson.teachers),
      activities: normalizeActivities(lesson.arrangeInfo),
      elected: lesson.elected === true,
      defaultElected: lesson.defaultElected === true,
      withdrawable: lesson.withdrawable === true
    };
    const courseId = optionalString(lesson.courseId);
    const englishName = optionalString(lesson.engName);
    const credits = numberValue(lesson.credits);
    if (courseId !== undefined) course.courseId = courseId;
    if (englishName !== undefined) course.englishName = englishName;
    if (credits !== undefined) course.credits = credits;
    return course;
  });

  const runtimeSelectedLessonIds = new Set(lessons.filter((lesson) => lesson.elected).map((lesson) => lesson.id));
  const domSelectedLessonIds = new Set(raw.domSelectedLessonIds);
  return {
    profileId: stringValue(raw.profileId),
    lessons,
    runtimeSelectedLessonIds,
    domSelectedLessonIds,
    selectedLessonIds: new Set([...runtimeSelectedLessonIds, ...domSelectedLessonIds])
  };
}
