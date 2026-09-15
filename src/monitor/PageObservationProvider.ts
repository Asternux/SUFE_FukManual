import type { Page } from "playwright";
import { isCoursePage } from "../browser/waitForCoursePage.js";
import { readCourseData } from "../browser/readCourseData.js";
import { readLessonCounts } from "./readLessonCounts.js";
import type { ObservationProvider } from "../scheduler/Scheduler.js";
import type { CourseObservation, PreflightBlock } from "../state/CourseWorker.js";
import { isElectionOpen } from "./isElectionOpen.js";

interface ClientPreflight {
  lessonId: string;
  exists: boolean;
  selected: boolean;
  duplicateCourse: boolean;
  conflictCount: number;
  conflicts: Array<{ id: string; name: string }>;
}

export class LoginRequiredError extends Error {
  public constructor() {
    super("course page is unavailable; normal login may be required");
    this.name = "LoginRequiredError";
  }
}

export class PageObservationProvider implements ObservationProvider {
  public constructor(private readonly page: Page) {}

  public async observe(lessonIds: string[], signal: AbortSignal): Promise<Map<string, CourseObservation>> {
    if (signal.aborted) throw new Error("observation aborted");
    if (!(await isCoursePage(this.page))) throw new LoginRequiredError();
    const [pageData, countSnapshot, preflight, openEvidence] = await Promise.all([
      readCourseData(this.page),
      readLessonCounts(this.page, lessonIds),
      this.readClientPreflight(lessonIds),
      isElectionOpen(this.page)
    ]);
    const pageLessons = new Map(pageData.lessons.map((lesson) => [lesson.id, lesson]));
    const preflightById = new Map(preflight.map((item) => [item.lessonId, item]));
    const observations = new Map<string, CourseObservation>();
    for (const lessonId of lessonIds) {
      const client = preflightById.get(lessonId);
      let block: PreflightBlock | undefined;
      let detail: string | undefined;
      if (client?.duplicateCourse) {
        block = "CONFLICT";
        detail = "client preflight found another selected lesson with the same course code";
      } else if ((client?.conflictCount ?? 0) > 0) {
        block = "CONFLICT";
        const conflicts = client?.conflicts.map((item) => `${item.name || "unnamed"}(lessonId=${item.id})`).join(", ") ?? "";
        detail = `client preflight found ${client?.conflictCount ?? 0} time conflicts${conflicts ? `: ${conflicts}` : ""}`;
      }
      const selected = pageData.selectedLessonIds.has(lessonId) || client?.selected === true;
      observations.set(lessonId, {
        lessonId,
        electionOpen: openEvidence.open,
        pageActionAvailable: pageLessons.has(lessonId) && client?.exists === true && !selected,
        selected,
        ...(countSnapshot.counts.get(lessonId) === undefined ? {} : { count: countSnapshot.counts.get(lessonId)! }),
        ...(block === undefined ? {} : { block }),
        ...(detail === undefined ? {} : { detail })
      });
    }
    return observations;
  }

  private async readClientPreflight(lessonIds: string[]): Promise<ClientPreflight[]> {
    return this.page.evaluate<ClientPreflight[], string[]>((ids) => {
      type RuntimeLesson = Record<string, unknown>;
      type Query = { first?: () => RuntimeLesson; get?: () => RuntimeLesson[] };
      type CourseTable = {
        lessons?: (...filters: unknown[]) => Query;
        checkConflict?: (lesson: RuntimeLesson) => unknown;
      };
      const table = (window as unknown as { electCourseTable?: CourseTable }).electCourseTable;
      return ids.map((lessonId) => {
        const numericId = Number(lessonId);
        const lesson = table?.lessons?.({ id: numericId }).first?.();
        if (!lesson) return { lessonId, exists: false, selected: false, duplicateCourse: false, conflictCount: 0, conflicts: [] };
        const duplicateCourse = (table?.lessons?.(
          { code: lesson.code },
          { elected: true },
          { id: { "!is": numericId } }
        ).get?.().length ?? 0) > 0;
        let conflictLessons: RuntimeLesson[] = [];
        try {
          const rawConflicts = table?.checkConflict?.(lesson);
          if (Array.isArray(rawConflicts)) {
            conflictLessons = rawConflicts as RuntimeLesson[];
          } else if (rawConflicts && typeof rawConflicts === "object") {
            const collection = rawConflicts as {
              get?: () => RuntimeLesson[];
              lessons?: Record<string, RuntimeLesson>;
              each?: (callback: (index: number, item: RuntimeLesson) => void) => void;
            };
            if (typeof collection.get === "function") {
              conflictLessons = collection.get();
            } else if (collection.lessons && typeof collection.lessons === "object") {
              conflictLessons = Object.values(collection.lessons);
            } else if (typeof collection.each === "function") {
              collection.each((_index, item) => conflictLessons.push(item));
            }
          }
        } catch {
          conflictLessons = [];
        }
        return {
          lessonId,
          exists: true,
          selected: lesson.elected === true,
          duplicateCourse,
          conflictCount: conflictLessons.length,
          conflicts: conflictLessons.map((conflict) => ({
            id: String(conflict.id ?? ""),
            name: String(conflict.name ?? "")
          }))
        };
      });
    }, lessonIds);
  }
}
