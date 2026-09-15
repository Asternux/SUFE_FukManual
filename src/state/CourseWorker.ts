import { randomUUID } from "node:crypto";
import type { LessonCount } from "../monitor/readLessonCounts.js";
import type { ResolvedTarget } from "../resolver/resolveTargets.js";
import type { SubmissionExecutor, SubmissionResult } from "../executor/types.js";
import type { CourseVerifier, VerificationResult } from "../verifier/types.js";
import { CourseState, type RetryConfig } from "../types.js";
import { directRunner, type ExclusiveRunner } from "../scheduler/AsyncMutex.js";

export type PreflightBlock = "CONFLICT" | "NOT_ELIGIBLE";

export interface CourseObservation {
  lessonId: string;
  electionOpen: boolean;
  pageActionAvailable: boolean;
  selected: boolean;
  count?: LessonCount;
  block?: PreflightBlock;
  detail?: string;
}

export interface AttemptRecord {
  attemptId: string;
  lessonId: string;
  startedAt: string;
  endedAt?: string;
  submission?: SubmissionResult;
  finalVerification?: VerificationResult;
  endReason?: string;
}

export interface WorkerLogSink {
  info(scope: string, message: string): Promise<void>;
  warn(scope: string, message: string): Promise<void>;
  error(scope: string, message: string): Promise<void>;
}

const TERMINAL_STATES = new Set<CourseState>([
  CourseState.SUCCESS,
  CourseState.FULL,
  CourseState.CONFLICT,
  CourseState.NOT_ELIGIBLE,
  CourseState.FAILED,
  CourseState.STOPPED
]);

export class CourseWorker {
  public state = CourseState.PENDING;
  public readonly attempts: AttemptRecord[] = [];
  public inFlight = false;
  private nextAttemptAt = 0;
  private nextVerificationAt = 0;
  private unknownVerificationCount = 0;
  private pendingSubmission: SubmissionResult | undefined;
  private currentAttempt: AttemptRecord | undefined;
  private readonly completedAttemptLogs: AttemptRecord[] = [];
  private readonly abortController = new AbortController();

  public constructor(
    public readonly resolved: ResolvedTarget,
    private readonly executor: SubmissionExecutor,
    private readonly verifier: CourseVerifier,
    private readonly retry: RetryConfig,
    private readonly logger: WorkerLogSink,
    private readonly exclusiveRunner: ExclusiveRunner = directRunner
  ) {}

  public get lessonId(): string {
    return this.resolved.lesson.id;
  }

  public get name(): string {
    return this.resolved.target.name;
  }

  public isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  public async tick(observation: CourseObservation, now = Date.now()): Promise<void> {
    if (this.isTerminal() || this.inFlight) return;
    if (observation.lessonId !== this.lessonId) {
      await this.fail(`observation lessonId mismatch: ${observation.lessonId}`);
      return;
    }
    if (observation.selected) {
      await this.finishSelected("authoritative observation reports selected");
      return;
    }
    if (observation.block === "CONFLICT") {
      await this.transition(CourseState.CONFLICT, observation.detail ?? "preflight conflict");
      return;
    }
    if (observation.block === "NOT_ELIGIBLE") {
      await this.transition(CourseState.NOT_ELIGIBLE, observation.detail ?? "preflight not eligible");
      return;
    }
    if (this.state === CourseState.UNKNOWN) {
      if (now >= this.nextVerificationAt) await this.runFollowUpVerification(now);
      return;
    }
    if (this.state === CourseState.RETRY_WAIT && now < this.nextAttemptAt) return;
    if (!observation.electionOpen || !observation.pageActionAvailable) {
      if (this.state !== CourseState.PENDING) await this.transition(CourseState.PENDING, "waiting for page to become operable");
      return;
    }
    if (!observation.count || !observation.count.nominalAvailable) {
      if (this.state !== CourseState.PENDING && this.state !== CourseState.RETRY_WAIT) {
        await this.transition(CourseState.PENDING, "waiting for a nominally available count");
      }
      return;
    }
    if (this.attempts.length >= this.retry.maxAttempts) {
      await this.transition(CourseState.FAILED, "max attempts reached before another submission");
      return;
    }
    // Acquire before the first await so concurrent ticks cannot pass the guard.
    this.inFlight = true;
    try {
      await this.transition(CourseState.AVAILABLE, `count=${observation.count.sc}/${observation.count.lc}`);
      await this.runAttempt(now);
    } finally {
      this.inFlight = false;
    }
  }

  public async fail(reason: string): Promise<void> {
    if (!this.isTerminal()) await this.transition(CourseState.FAILED, reason);
  }

  public async stop(reason = "stopped by scheduler"): Promise<void> {
    if (this.isTerminal()) return;
    this.abortController.abort(reason);
    await this.transition(CourseState.STOPPED, reason);
  }

  private async runAttempt(now: number): Promise<void> {
    const attempt: AttemptRecord = {
      attemptId: randomUUID(),
      lessonId: this.lessonId,
      startedAt: new Date(now).toISOString()
    };
    this.attempts.push(attempt);
    this.currentAttempt = attempt;
    try {
      await this.exclusiveRunner.runExclusive(async () => {
        if (this.abortController.signal.aborted) throw new Error("attempt aborted before page transaction");
        await this.transition(CourseState.SUBMITTING, `attempt=${this.attempts.length} attemptId=${attempt.attemptId}`);
        const submission = await this.executor.submit({
          attemptId: attempt.attemptId,
          lessonId: this.lessonId,
          signal: this.abortController.signal
        });
        attempt.submission = submission;
        this.pendingSubmission = submission;
        await this.transition(CourseState.VERIFYING, `${submission.kind}: ${submission.detail}`);
        await this.verifyAfterSubmission(now);
      });
    } catch (error: unknown) {
      if (this.abortController.signal.aborted) {
        this.finishAttempt("aborted");
        if (!this.isTerminal()) await this.transition(CourseState.STOPPED, "attempt aborted");
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        const submission: SubmissionResult = { kind: "UNKNOWN", detail, retryable: true };
        attempt.submission = submission;
        this.pendingSubmission = submission;
        await this.transition(CourseState.UNKNOWN, `submit threw; verifying before any retry: ${detail}`);
        this.nextVerificationAt = now + this.retry.unknownVerificationDelayMs;
      }
    }
  }

  private async verifyAfterSubmission(now: number): Promise<void> {
    const result = await this.verifier.verify(this.lessonId, this.abortController.signal);
    if (this.currentAttempt) this.currentAttempt.finalVerification = result;
    if (result.status === "SELECTED") {
      await this.finishSelected(result.detail);
      return;
    }
    if (result.status === "UNKNOWN") {
      this.unknownVerificationCount = 1;
      this.nextVerificationAt = now + this.retry.unknownVerificationDelayMs;
      await this.transition(CourseState.UNKNOWN, `verification unknown; no retry: ${result.detail}`);
      return;
    }
    await this.handleConfirmedNotSelected(now, result);
  }

  private async runFollowUpVerification(now: number): Promise<void> {
    this.inFlight = true;
    try {
      await this.exclusiveRunner.runExclusive(async () => {
        await this.transition(CourseState.VERIFYING, `follow-up verification=${this.unknownVerificationCount + 1}`);
        const result = await this.verifier.verify(this.lessonId, this.abortController.signal);
        if (this.currentAttempt) this.currentAttempt.finalVerification = result;
        if (result.status === "SELECTED") {
          await this.finishSelected(result.detail);
        } else if (result.status === "NOT_SELECTED") {
          await this.handleConfirmedNotSelected(now, result);
        } else {
          this.unknownVerificationCount += 1;
          if (this.unknownVerificationCount >= this.retry.maxUnknownVerifications) {
            this.finishAttempt("verification remained unknown; manual review required");
            await this.transition(CourseState.FAILED, "verification remained UNKNOWN");
          } else {
            this.nextVerificationAt = now + this.retry.unknownVerificationDelayMs;
            await this.transition(CourseState.UNKNOWN, `verification still unknown; no submit retry: ${result.detail}`);
          }
        }
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.unknownVerificationCount += 1;
      if (this.unknownVerificationCount >= this.retry.maxUnknownVerifications) {
        this.finishAttempt("verification failed repeatedly; manual review required");
        await this.transition(CourseState.FAILED, detail);
      } else {
        this.nextVerificationAt = now + this.retry.unknownVerificationDelayMs;
        await this.transition(CourseState.UNKNOWN, `verification error; no submit retry: ${detail}`);
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async handleConfirmedNotSelected(now: number, verification: VerificationResult): Promise<void> {
    const submission = this.pendingSubmission;
    if (!submission) {
      this.finishAttempt("not selected without a recorded submission");
      await this.transition(CourseState.FAILED, verification.detail);
      return;
    }
    if (submission.kind === "CONFLICT") {
      this.finishAttempt("confirmed not selected: conflict");
      await this.transition(CourseState.CONFLICT, submission.detail);
      return;
    }
    if (submission.kind === "NOT_ELIGIBLE") {
      this.finishAttempt("confirmed not selected: not eligible");
      await this.transition(CourseState.NOT_ELIGIBLE, submission.detail);
      return;
    }
    if (!submission.retryable || this.attempts.length >= this.retry.maxAttempts) {
      const terminal = submission.kind === "FULL" ? CourseState.FULL : CourseState.FAILED;
      this.finishAttempt(`confirmed not selected: ${submission.kind}; retry stopped`);
      await this.transition(terminal, submission.detail);
      return;
    }
    const serverDelay = submission.retryAfterMs ?? 0;
    const delay = Math.max(this.retry.minDelayMs, serverDelay);
    this.nextAttemptAt = now + delay;
    this.finishAttempt(`confirmed not selected; retry after ${delay}ms`);
    await this.transition(CourseState.RETRY_WAIT, `${submission.kind}; delay=${delay}ms`);
  }

  private async finishSelected(detail: string): Promise<void> {
    this.finishAttempt("verifier confirmed SELECTED");
    await this.transition(CourseState.SUCCESS, detail);
  }

  private finishAttempt(reason: string): void {
    if (this.currentAttempt && !this.currentAttempt.endedAt) {
      this.currentAttempt.endedAt = new Date().toISOString();
      this.currentAttempt.endReason = reason;
      this.completedAttemptLogs.push({ ...this.currentAttempt });
    }
    this.currentAttempt = undefined;
    this.pendingSubmission = undefined;
    this.unknownVerificationCount = 0;
  }

  private async transition(next: CourseState, detail: string): Promise<void> {
    if (this.isTerminal() && next !== this.state) {
      await this.flushCompletedAttemptLogs();
      return;
    }
    this.state = next;
    const message = `${next}${detail ? ` ${detail}` : ""}`;
    if (next === CourseState.FAILED || next === CourseState.UNKNOWN) {
      await this.logger.warn(this.name, message);
    } else {
      await this.logger.info(this.name, message);
    }
    await this.flushCompletedAttemptLogs();
  }

  private async flushCompletedAttemptLogs(): Promise<void> {
    while (this.completedAttemptLogs.length > 0) {
      const attempt = this.completedAttemptLogs.shift();
      if (attempt) await this.logger.info(this.name, `ATTEMPT ${JSON.stringify(attempt)}`);
    }
  }
}
