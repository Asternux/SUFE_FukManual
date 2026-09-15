import type { Page } from "playwright";
import { isCoursePage } from "../browser/waitForCoursePage.js";

export interface ElectionOpenEvidence {
  open: boolean;
  reason: string;
}

export async function isElectionOpen(page: Page): Promise<ElectionOpenEvidence> {
  if (!(await isCoursePage(page))) return { open: false, reason: "course page is not ready" };
  const evidence = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const explicitClosed = /选课尚未开始|选课未开放|选课已结束|不在选课时间/i.test(bodyText);
    const visibleElectionAction = Array.from(
      document.querySelectorAll<HTMLElement>('a.lessonListOperator[operator="ELECTION"]')
    ).some((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    return { explicitClosed, visibleElectionAction };
  });
  if (evidence.visibleElectionAction) return { open: true, reason: "normal election action is visible" };
  if (evidence.explicitClosed) return { open: false, reason: "page explicitly reports election closed" };
  return { open: false, reason: "no operable election action is visible" };
}
