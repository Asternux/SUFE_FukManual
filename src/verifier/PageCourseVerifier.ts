import type { Page } from "playwright";
import { isCoursePage, waitForCoursePage } from "../browser/waitForCoursePage.js";
import { readCourseData } from "../browser/readCourseData.js";
import type { CourseVerifier, VerificationResult } from "./types.js";

export class PageCourseVerifier implements CourseVerifier {
  public constructor(private readonly page: Page) {}

  public async verify(lessonId: string, signal: AbortSignal): Promise<VerificationResult> {
    if (signal.aborted) return { status: "UNKNOWN", detail: "verification aborted" };
    const first = await this.inspectCurrentPage(lessonId, "current runtime");
    if (first.status === "SELECTED") return first;
    if (!(await isCoursePage(this.page))) return { status: "UNKNOWN", detail: "course page unavailable or login required" };

    try {
      await this.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForCoursePage(this.page, 20_000);
      return await this.inspectCurrentPage(lessonId, "reloaded page");
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: "UNKNOWN", detail: `authoritative reload failed: ${detail}` };
    }
  }

  private async inspectCurrentPage(lessonId: string, source: string): Promise<VerificationResult> {
    try {
      const data = await readCourseData(this.page);
      if (data.selectedLessonIds.has(lessonId)) {
        return { status: "SELECTED", detail: `${source} selected-course state contains lessonId` };
      }
      if (data.lessons.some((lesson) => lesson.id === lessonId)) {
        return { status: "NOT_SELECTED", detail: `${source} explicitly marks lesson as not selected` };
      }
      return { status: "UNKNOWN", detail: "lesson absent from current page data" };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: "UNKNOWN", detail: `could not read selected state: ${detail}` };
    }
  }
}
