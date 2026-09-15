import type { Dialog, Page, Response } from "playwright";
import type { LessonRecord } from "../browser/readCourseData.js";
import { classifyDialog, classifySubmissionResponse } from "./classifySubmission.js";
import type { SubmissionContext, SubmissionExecutor, SubmissionResult } from "./types.js";

interface PageSubmissionExecutorOptions {
  responseTimeoutMs?: number;
}

type ObservedEvent = { type: "response"; response: Response } | { type: "dialog"; dialogType: string; message: string } | { type: "timeout" };
type DialogEvent = Extract<ObservedEvent, { type: "dialog" }>;

export class PageSubmissionExecutor implements SubmissionExecutor {
  private readonly responseTimeoutMs: number;
  private readonly lessonsById: Map<string, LessonRecord>;

  public constructor(
    private readonly page: Page,
    lessons: LessonRecord[],
    options: PageSubmissionExecutorOptions = {}
  ) {
    this.lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    this.responseTimeoutMs = options.responseTimeoutMs ?? 10_000;
  }

  public async submit(context: SubmissionContext): Promise<SubmissionResult> {
    if (context.signal.aborted) throw new Error("submission aborted before click");
    const lesson = this.lessonsById.get(context.lessonId);
    if (!lesson) return { kind: "FAILED", detail: "resolved lesson missing from executor", retryable: false };
    const link = await this.ensureNormalActionVisible(lesson);
    if (!link) {
      return {
        kind: "UNKNOWN",
        detail: "normal page election action was not visible after exact lesson filter",
        retryable: true
      };
    }

    let resolveDialog!: (event: ObservedEvent) => void;
    let observedDialog: DialogEvent | undefined;
    const dialogPromise = new Promise<ObservedEvent>((resolve) => {
      resolveDialog = resolve;
    });
    const onDialog = async (dialog: Dialog): Promise<void> => {
      const event: ObservedEvent = { type: "dialog", dialogType: dialog.type(), message: dialog.message() };
      observedDialog = event;
      resolveDialog(event);
      await dialog.dismiss().catch(() => undefined);
    };
    this.page.on("dialog", onDialog);
    const responsePromise: Promise<ObservedEvent> = this.page
      .waitForResponse(
        (response) => new URL(response.url()).pathname.endsWith("/stdElectCourse!batchOperator.action"),
        { timeout: this.responseTimeoutMs }
      )
      .then((response) => ({ type: "response", response }) as ObservedEvent)
      .catch(() => ({ type: "timeout" }));

    try {
      await link.click({ timeout: 5_000 });
      const event = await Promise.race([responsePromise, dialogPromise]);
      if (event.type === "dialog") return classifyDialog(event.dialogType, event.message);
      if (event.type === "timeout") {
        return { kind: "UNKNOWN", detail: "batchOperator response was not observed", retryable: true };
      }
      const response = event.response;
      const bodyText = await response.text().catch(() => "");
      const responseResult = classifySubmissionResponse({
        status: response.status(),
        method: response.request().method(),
        contentType: response.headers()["content-type"] ?? "",
        bodyText,
        ...(response.headers()["retry-after"] === undefined
          ? {}
          : { retryAfter: response.headers()["retry-after"] })
      });
      if (responseResult.kind !== "SUBMITTED") return responseResult;

      // Colorbox inserts the HTML and may execute a short result script after the response event.
      await this.page.waitForTimeout(150).catch(() => undefined);
      if (observedDialog) return classifyDialog(observedDialog.dialogType, observedDialog.message);
      const colorboxContent = this.page.locator("#cboxLoadedContent").first();
      const colorboxText = (await colorboxContent.count()) > 0
        ? await colorboxContent.innerText({ timeout: 500 }).catch(() => "")
        : "";
      if (colorboxText.trim()) {
        const colorboxResult = classifySubmissionResponse({
          status: 200,
          method: "COLORBOX",
          contentType: "text/plain",
          bodyText: colorboxText.slice(0, 4_000)
        });
        if (colorboxResult.kind !== "SUBMITTED") {
          return { ...colorboxResult, detail: `Colorbox: ${colorboxResult.detail}` };
        }
      }
      return responseResult;
    } finally {
      this.page.off("dialog", onDialog);
      await this.closeColorboxIfVisible();
    }
  }

  private async closeColorboxIfVisible(): Promise<void> {
    const closeButton = this.page.locator("#cboxClose").first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click({ timeout: 2_000 }).catch(() => undefined);
    }
  }

  private async ensureNormalActionVisible(lesson: LessonRecord) {
    if (!/^\d+$/.test(lesson.id)) throw new Error(`unexpected non-numeric lessonId=${lesson.id}`);
    const selector = `a.lessonListOperator[id="${lesson.id}"][operator="ELECTION"]`;
    const direct = this.page.locator(selector).first();
    if (await direct.isVisible().catch(() => false)) return direct;

    const lessonNoInput = this.page.locator('input[name="electableLesson.no"]').first();
    if (!(await lessonNoInput.isVisible().catch(() => false))) return undefined;
    await lessonNoInput.fill(lesson.lessonNo);
    const submit = this.page.locator("#electableLessonList_filter_submit").first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
    } else {
      await lessonNoInput.press("Enter");
    }
    await direct.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    return (await direct.isVisible().catch(() => false)) ? direct : undefined;
  }
}
