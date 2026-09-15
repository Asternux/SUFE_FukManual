import { resolve } from "node:path";
import { startCommandConsole } from "./cli/commands.js";
import { requireArmPhrase } from "./cli/arm.js";
import { launchBrowser } from "./browser/launchBrowser.js";
import { readCourseData } from "./browser/readCourseData.js";
import { waitForCoursePage } from "./browser/waitForCoursePage.js";
import { loadConfig } from "./config/loadConfig.js";
import { Logger, redactLogMessage } from "./logger/Logger.js";
import { attachNetworkMetadataRecorder } from "./logger/NetworkMetadataRecorder.js";
import { writeLessonCatalog } from "./logger/writeLessonCatalog.js";
import { writeRunSummary } from "./logger/writeRunSummary.js";
import { LoginRequiredError, PageObservationProvider } from "./monitor/PageObservationProvider.js";
import { formatCandidates, resolveTargets } from "./resolver/resolveTargets.js";
import { AsyncMutex } from "./scheduler/AsyncMutex.js";
import { Scheduler } from "./scheduler/Scheduler.js";
import { CourseWorker } from "./state/CourseWorker.js";
import { PageSubmissionExecutor } from "./executor/PageSubmissionExecutor.js";
import { PageCourseVerifier } from "./verifier/PageCourseVerifier.js";
import { RunPhase } from "./types.js";

let activeLogger: Logger | undefined;

function configPathFromArgs(args: string[]): string {
  const index = args.indexOf("--config");
  const supplied = index >= 0 ? args[index + 1] : undefined;
  return supplied ?? "config/courses.json";
}

function modeFromArgs(args: string[]): "inspect" | "run" {
  const index = args.indexOf("--mode");
  const supplied = index >= 0 ? args[index + 1] : undefined;
  if (supplied === undefined || supplied === "inspect") return "inspect";
  if (supplied === "run") return "run";
  throw new Error("--mode must be inspect or run");
}

async function main(): Promise<void> {
  const runId = String(Date.now());
  const runLogPath = resolve("logs", `run-${runId}.log`);
  const logger = new Logger(runLogPath);
  activeLogger = logger;
  const configPath = configPathFromArgs(process.argv.slice(2));
  const mode = modeFromArgs(process.argv.slice(2));
  await logger.info("RUN", RunPhase.INIT);
  const config = await loadConfig(configPath);
  const session = await launchBrowser(config.browser);
  try {
    await logger.info("RUN", RunPhase.LOGIN_REQUIRED);
    if (session.page.url() !== config.entryUrl) await session.page.goto(config.entryUrl, { waitUntil: "domcontentloaded" });
    await logger.info("RUN", "complete normal school login in the opened browser; credentials are never read by this program");
    await waitForCoursePage(session.page, config.browser.loginTimeoutMs);
    await logger.info("RUN", `${RunPhase.LOADING_DATA}: course page identified`);
    const pageData = await readCourseData(session.page);
    await logger.info("RUN", `loaded ${pageData.lessons.length} lessons for the active election profile`);
    const catalogPath = await writeLessonCatalog(pageData.lessons);
    await logger.info("RUN", `share-safe lesson catalog written to ${catalogPath}`);
    await logger.info("RUN", RunPhase.RESOLVING_TARGETS);
    const resolution = resolveTargets(config.courses, pageData.lessons);
    for (const resolved of resolution.resolved) {
      await logger.info(
        resolved.target.name,
        `resolved lessonId=${resolved.lesson.id} via ${resolved.method}`
      );
    }
    for (const issue of resolution.issues) {
      await logger.error(issue.target.name, issue.message);
      const candidates = formatCandidates(issue.candidates);
      if (candidates) await logger.info(issue.target.name, `candidates:\n${candidates}`);
    }
    if (!resolution.ready) throw new Error("target resolution must be fixed before READY/ARMED");
    const observationProvider = new PageObservationProvider(session.page);
    const preflight = await observationProvider.observe(
      resolution.resolved.map((item) => item.lesson.id),
      new AbortController().signal
    );
    for (const resolved of resolution.resolved) {
      const observation = preflight.get(resolved.lesson.id);
      if (!observation) throw new Error(`preflight omitted lessonId=${resolved.lesson.id}`);
      const count = observation.count;
      if (!count) {
        await logger.warn(resolved.target.name, `no count entry for lessonId=${resolved.lesson.id}`);
      } else {
        await logger.info(
          resolved.target.name,
          `count=${count.sc}/${count.lc} nominalAvailable=${count.nominalAvailable}; backend eligibility still authoritative`
        );
      }
      await logger.info(
        resolved.target.name,
        `preflight selected=${observation.selected} electionOpen=${observation.electionOpen} pageActionAvailable=${observation.pageActionAvailable}`
      );
      await logger.info(
        resolved.target.name,
        `selectedEvidence runtime=${pageData.runtimeSelectedLessonIds.has(resolved.lesson.id)} dom=${pageData.domSelectedLessonIds.has(resolved.lesson.id)}`
      );
      if (observation.block) {
        await logger.warn(
          resolved.target.name,
          `preflightBlock=${observation.block} ${observation.detail ?? ""}`.trim()
        );
      }
    }
    await logger.info("RUN", RunPhase.READY);
    if (mode === "inspect") {
      await logger.info("RUN", "inspect mode complete; no submission action was enabled");
      await logger.info("RUN", RunPhase.FINISHED);
      return;
    }
    if (!config.submission.enabled) {
      throw new Error("run mode requires submission.enabled=true in the local config");
    }
    await requireArmPhrase(config.submission.requireArmPhrase);
    await logger.info("RUN", RunPhase.ARMED);

    const pageMutex = new AsyncMutex(config.submission.minGlobalIntervalMs);
    const detachNetworkRecorder = attachNetworkMetadataRecorder(session.page, logger);
    const executor = new PageSubmissionExecutor(session.page, pageData.lessons);
    const verifier = new PageCourseVerifier(session.page);
    const workers = resolution.resolved.map(
      (resolved) => {
        const courseLogger = new Logger(
          runLogPath,
          resolve("logs", "courses", `${runId}-${resolved.lesson.id}.log`)
        );
        return new CourseWorker(resolved, executor, verifier, config.retry, courseLogger, pageMutex);
      }
    );
    const scheduler = new Scheduler(workers, observationProvider, logger, {
      tickIntervalMs: config.scheduler.tickIntervalMs,
      maxRunDurationMs: config.scheduler.maxRunDurationMs,
      recoverObservationError: async (error: unknown) => {
        if (!(error instanceof LoginRequiredError)) return true;
        await logger.warn("RUN", "login required; all new submissions are paused. Complete normal login in the browser.");
        try {
          if (!session.page.url().includes("login.sufe.edu.cn")) {
            await session.page.goto(config.entryUrl, { waitUntil: "domcontentloaded" });
          }
          await waitForCoursePage(session.page, config.browser.loginTimeoutMs);
          return true;
        } catch {
          return false;
        }
      }
    });
    const commandConsole = startCommandConsole(scheduler, logger);
    const onSigint = (): void => {
      void scheduler.stop("SIGINT");
    };
    process.once("SIGINT", onSigint);
    try {
      await scheduler.start();
    } finally {
      process.off("SIGINT", onSigint);
      commandConsole?.close();
      detachNetworkRecorder();
    }
    await logger.info("SUMMARY", workers.map((worker) => `${worker.name}: ${worker.state}`).join(" | "));
    const summaryPath = await writeRunSummary(runId, workers);
    await logger.info("SUMMARY", `machine-readable summary written to ${summaryPath}`);
  } finally {
    await session.context.close();
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const safeDetail = redactLogMessage(detail);
  try {
    await activeLogger?.error("RUN", `FATAL: ${safeDetail}`);
  } catch {
    // stderr remains the final diagnostic path if the log file cannot be written.
  }
  process.stderr.write(`[FATAL] ${safeDetail}\n`);
  process.exitCode = 1;
});
