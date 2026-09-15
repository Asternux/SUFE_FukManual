import { setTimeout as delay } from "node:timers/promises";
import type { CourseObservation } from "../state/CourseWorker.js";
import { CourseWorker, type WorkerLogSink } from "../state/CourseWorker.js";
import { RunPhase } from "../types.js";

export interface ObservationProvider {
  observe(lessonIds: string[], signal: AbortSignal): Promise<Map<string, CourseObservation>>;
}

export interface SchedulerOptions {
  tickIntervalMs?: number;
  maxRunDurationMs?: number;
  recoverObservationError?: (error: unknown) => Promise<boolean>;
}

export class Scheduler {
  public phase = RunPhase.READY;
  private paused = false;
  private readonly abortController = new AbortController();

  public constructor(
    public readonly workers: CourseWorker[],
    private readonly observationProvider: ObservationProvider,
    private readonly logger: WorkerLogSink,
    private readonly options: SchedulerOptions = {}
  ) {}

  private get tickIntervalMs(): number {
    return this.options.tickIntervalMs ?? 500;
  }

  public pause(): void {
    if (this.phase === RunPhase.RUNNING) {
      this.paused = true;
      this.phase = RunPhase.ARMED;
    }
  }

  public resume(): void {
    if (this.paused) {
      this.paused = false;
      this.phase = RunPhase.RUNNING;
    }
  }

  public async stop(reason = "scheduler stopped"): Promise<void> {
    this.abortController.abort(reason);
    await Promise.all(this.workers.map((worker) => worker.stop(reason)));
    this.phase = RunPhase.STOPPED;
  }

  public async start(): Promise<void> {
    if (this.phase !== RunPhase.READY && this.phase !== RunPhase.ARMED) {
      throw new Error(`scheduler cannot start from ${this.phase}`);
    }
    this.phase = RunPhase.RUNNING;
    await this.logger.info("RUN", RunPhase.RUNNING);
    const lessonIds = this.workers.map((worker) => worker.lessonId);
    const deadline = this.options.maxRunDurationMs === undefined
      ? undefined
      : Date.now() + this.options.maxRunDurationMs;

    while (!this.abortController.signal.aborted && !this.workers.every((worker) => worker.isTerminal())) {
      if (deadline !== undefined && Date.now() >= deadline) {
        await this.logger.warn("RUN", `maximum runtime ${this.options.maxRunDurationMs}ms reached`);
        await this.stop("maximum runtime reached");
        break;
      }
      if (this.paused) {
        await delay(this.tickIntervalMs, undefined, { signal: this.abortController.signal }).catch(() => undefined);
        continue;
      }
      try {
        const observations = await this.observationProvider.observe(lessonIds, this.abortController.signal);
        const results = await Promise.allSettled(
          this.workers.map(async (worker) => {
            const observation = observations.get(worker.lessonId);
            if (!observation) {
              await worker.fail("observation provider omitted this lesson");
              return;
            }
            await worker.tick(observation);
          })
        );
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          if (result?.status === "rejected") {
            const detail = result.reason instanceof Error ? result.reason.message : String(result.reason);
            await this.workers[index]?.fail(`isolated worker error: ${detail}`);
          }
        }
      } catch (error: unknown) {
        if (this.abortController.signal.aborted) break;
        const detail = error instanceof Error ? error.message : String(error);
        await this.logger.warn("SCHEDULER", `observation failed; workers paused for this tick: ${detail}`);
        if (this.options.recoverObservationError) {
          this.phase = RunPhase.LOGIN_REQUIRED;
          const recovered = await this.options.recoverObservationError(error);
          if (!recovered) {
            await this.stop("observation recovery stopped");
            break;
          }
          this.phase = RunPhase.RUNNING;
          await this.logger.info("RUN", "login/page state recovered; workers resumed after a fresh observation");
        }
      }
      await delay(this.tickIntervalMs, undefined, { signal: this.abortController.signal }).catch(() => undefined);
    }

    if (!this.abortController.signal.aborted) {
      this.phase = RunPhase.FINISHED;
      await this.logger.info("RUN", RunPhase.FINISHED);
    }
  }
}
