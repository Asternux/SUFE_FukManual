import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LessonRecord } from "../browser/readCourseData.js";

export async function writeLessonCatalog(lessons: LessonRecord[]): Promise<string> {
  const logsDirectory = resolve("logs");
  await mkdir(logsDirectory, { recursive: true });
  const outputPath = resolve(logsDirectory, `lesson-catalog-${Date.now()}.json`);
  const shareSafeCatalog = lessons.map((lesson) => ({
    id: lesson.id,
    lessonNo: lesson.lessonNo,
    courseCode: lesson.courseCode,
    name: lesson.name,
    teachers: lesson.teachers,
    activities: lesson.activities
  }));
  await writeFile(outputPath, `${JSON.stringify(shareSafeCatalog, null, 2)}\n`, "utf8");
  return outputPath;
}
