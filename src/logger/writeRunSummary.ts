import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CourseWorker } from "../state/CourseWorker.js";

export async function writeRunSummary(runId: string, workers: CourseWorker[]): Promise<string> {
  const outputPath = resolve("logs", `summary-${runId}.json`);
  await mkdir(resolve("logs"), { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    courses: workers.map((worker) => ({
      name: worker.name,
      lessonId: worker.lessonId,
      state: worker.state,
      attempts: worker.attempts
    }))
  };
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return outputPath;
}
