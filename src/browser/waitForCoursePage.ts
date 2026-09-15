import type { Page } from "playwright";

const COURSE_PAGE_PATH = "/eams/stdElectCourse!defaultPage.action";

export async function isCoursePage(page: Page): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(page.url());
  } catch {
    return false;
  }
  if (url.hostname !== "eams.sufe.edu.cn" || url.pathname !== COURSE_PAGE_PATH) return false;
  return page.locator("#electableLessonList, #electCourseTableToolbar").first().isVisible().catch(() => false);
}

export async function waitForCoursePage(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCoursePage(page)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`login timed out after ${timeoutMs}ms before the course page became ready`);
}
