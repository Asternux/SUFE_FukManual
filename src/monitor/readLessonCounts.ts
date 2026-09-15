import type { Page } from "playwright";

export interface LessonCount {
  lessonId: string;
  sc: number;
  lc: number;
  nominalAvailable: boolean;
}

export interface CountSnapshot {
  observedAt: string;
  counts: Map<string, LessonCount>;
  missingLessonIds: string[];
}

interface RawCount {
  lessonId: string;
  sc: unknown;
  lc: unknown;
}

export async function readLessonCounts(page: Page, lessonIds: string[]): Promise<CountSnapshot> {
  await page.waitForFunction(
    () => {
      const value = (window as unknown as { lessonId2Counts?: unknown }).lessonId2Counts;
      return typeof value === "object" && value !== null;
    },
    undefined,
    { timeout: 20_000 }
  );

  const rawCounts = await page.evaluate<RawCount[], string[]>((ids) => {
    const mapping = (window as unknown as {
      lessonId2Counts?: Record<string, { sc?: unknown; lc?: unknown }>;
    }).lessonId2Counts ?? {};
    return ids.flatMap((lessonId) => {
      const count = mapping[lessonId];
      return count ? [{ lessonId, sc: count.sc, lc: count.lc }] : [];
    });
  }, lessonIds);

  const counts = new Map<string, LessonCount>();
  for (const raw of rawCounts) {
    const sc = Number(raw.sc);
    const lc = Number(raw.lc);
    if (!Number.isFinite(sc) || !Number.isFinite(lc)) continue;
    counts.set(raw.lessonId, { lessonId: raw.lessonId, sc, lc, nominalAvailable: sc < lc });
  }

  return {
    observedAt: new Date().toISOString(),
    counts,
    missingLessonIds: lessonIds.filter((lessonId) => !counts.has(lessonId))
  };
}
