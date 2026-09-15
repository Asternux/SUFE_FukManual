import assert from "node:assert/strict";
import test from "node:test";
import type { LessonRecord } from "../src/browser/readCourseData.js";
import type { SubmissionContext, SubmissionExecutor, SubmissionResult } from "../src/executor/types.js";
import type { ResolvedTarget } from "../src/resolver/resolveTargets.js";
import { Scheduler, type ObservationProvider } from "../src/scheduler/Scheduler.js";
import { CourseWorker, type WorkerLogSink } from "../src/state/CourseWorker.js";
import { CourseState, type RetryConfig } from "../src/types.js";
import type { CourseVerifier, VerificationResult } from "../src/verifier/types.js";

const silentLogger: WorkerLogSink = {
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined
};

const retry: RetryConfig = {
  maxAttempts: 2,
  minDelayMs: 5,
  unknownVerificationDelayMs: 5,
  maxUnknownVerifications: 2
};

function resolved(name: string, lessonId: string): ResolvedTarget {
  const lesson: LessonRecord = {
    id: lessonId,
    lessonNo: lessonId,
    courseCode: `CODE-${lessonId}`,
    name,
    teachers: "Teacher",
    activities: [],
    elected: false,
    defaultElected: false,
    withdrawable: true
  };
  return { target: { name, lessonId, priority: 1 }, lesson, method: "lessonId" };
}

class MockExecutor implements SubmissionExecutor {
  public activeTotal = 0;
  public maxActiveTotal = 0;
  public readonly activeByLesson = new Map<string, number>();
  public readonly maxActiveByLesson = new Map<string, number>();
  public constructor(private readonly results: Map<string, SubmissionResult[]>) {}

  public async submit(context: SubmissionContext): Promise<SubmissionResult> {
    this.activeTotal += 1;
    this.maxActiveTotal = Math.max(this.maxActiveTotal, this.activeTotal);
    const active = (this.activeByLesson.get(context.lessonId) ?? 0) + 1;
    this.activeByLesson.set(context.lessonId, active);
    this.maxActiveByLesson.set(context.lessonId, Math.max(this.maxActiveByLesson.get(context.lessonId) ?? 0, active));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    this.activeTotal -= 1;
    this.activeByLesson.set(context.lessonId, active - 1);
    const queue = this.results.get(context.lessonId) ?? [];
    const result = queue.shift();
    if (!result) throw new Error("mock network timeout");
    return result;
  }
}

class MockVerifier implements CourseVerifier {
  public constructor(private readonly results: Map<string, VerificationResult[]>) {}
  public async verify(lessonId: string): Promise<VerificationResult> {
    return this.results.get(lessonId)?.shift() ?? { status: "UNKNOWN", detail: "no mock result" };
  }
}

const availableProvider: ObservationProvider = {
  observe: async (lessonIds) =>
    new Map(
      lessonIds.map((lessonId) => [
        lessonId,
        {
          lessonId,
          electionOpen: true,
          pageActionAvailable: true,
          selected: false,
          count: { lessonId, sc: 0, lc: 1, nominalAvailable: true }
        }
      ])
    )
};

test("Phase 5 runs courses concurrently, retries independently, and isolates failure", async () => {
  const executor = new MockExecutor(
    new Map([
      ["A", [{ kind: "SUBMITTED", detail: "accepted", retryable: true }]],
      [
        "B",
        [
          { kind: "FULL", detail: "full", retryable: true },
          { kind: "SUBMITTED", detail: "accepted", retryable: true }
        ]
      ]
    ])
  );
  const verifier = new MockVerifier(
    new Map([
      ["A", [{ status: "SELECTED", detail: "selected list contains A" }]],
      [
        "B",
        [
          { status: "NOT_SELECTED", detail: "B absent" },
          { status: "SELECTED", detail: "selected list contains B" }
        ]
      ],
      [
        "C",
        [
          { status: "UNKNOWN", detail: "page unavailable" },
          { status: "UNKNOWN", detail: "page still unavailable" }
        ]
      ]
    ])
  );
  const workers = ["A", "B", "C"].map(
    (lessonId) => new CourseWorker(resolved(`Course ${lessonId}`, lessonId), executor, verifier, retry, silentLogger)
  );
  const scheduler = new Scheduler(workers, availableProvider, silentLogger, { tickIntervalMs: 1 });
  await scheduler.start();

  assert.equal(workers[0]?.state, CourseState.SUCCESS);
  assert.equal(workers[1]?.state, CourseState.SUCCESS);
  assert.equal(workers[2]?.state, CourseState.FAILED);
  assert.equal(workers[1]?.attempts.length, 2);
  assert.equal(workers[2]?.attempts.length, 1);
  assert.ok(executor.maxActiveTotal >= 2, "different lessons should submit concurrently");
  assert.deepEqual([...executor.maxActiveByLesson.values()], [1, 1, 1]);
  assert.equal(workers[0]?.attempts[0]?.endReason, "verifier confirmed SELECTED");
  assert.match(workers[1]?.attempts[0]?.endReason ?? "", /retry after/);
  assert.match(workers[2]?.attempts[0]?.endReason ?? "", /manual review/);
});

test("Phase 5 never starts a second in-flight submit for the same lesson", async () => {
  const executor = new MockExecutor(
    new Map([["A", [{ kind: "SUBMITTED", detail: "accepted", retryable: true }]]])
  );
  const verifier = new MockVerifier(
    new Map([["A", [{ status: "SELECTED", detail: "selected" }]]])
  );
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, silentLogger);
  const observation = (await availableProvider.observe(["A"], new AbortController().signal)).get("A")!;
  await Promise.all([worker.tick(observation), worker.tick(observation), worker.tick(observation)]);
  assert.equal(worker.attempts.length, 1);
  assert.equal(executor.maxActiveByLesson.get("A"), 1);
  assert.equal(worker.state, CourseState.SUCCESS);
});

test("completed attempts are emitted as auditable structured log records", async () => {
  const messages: string[] = [];
  const recordingLogger: WorkerLogSink = {
    info: async (_scope, message) => { messages.push(message); },
    warn: async (_scope, message) => { messages.push(message); },
    error: async (_scope, message) => { messages.push(message); }
  };
  const executor = new MockExecutor(
    new Map([["A", [{ kind: "SUBMITTED", detail: "completed", retryable: true }]]])
  );
  const verifier = new MockVerifier(
    new Map([["A", [{ status: "SELECTED", detail: "fresh selected state" }]]])
  );
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, recordingLogger);
  const observation = (await availableProvider.observe(["A"], new AbortController().signal)).get("A")!;
  await worker.tick(observation);

  const attemptLine = messages.find((message) => message.startsWith("ATTEMPT "));
  assert.ok(attemptLine);
  assert.match(attemptLine, /"attemptId"/);
  assert.match(attemptLine, /"startedAt"/);
  assert.match(attemptLine, /"endedAt"/);
  assert.match(attemptLine, /"finalVerification"/);
  assert.match(attemptLine, /"endReason":"verifier confirmed SELECTED"/);
});

test("Phase 9 obeys Retry-After before a second submit", async () => {
  const executor = new MockExecutor(
    new Map([
      [
        "A",
        [
          { kind: "RATE_LIMITED", detail: "429", retryable: true, retryAfterMs: 100 },
          { kind: "SUBMITTED", detail: "accepted", retryable: true }
        ]
      ]
    ])
  );
  const verifier = new MockVerifier(
    new Map([
      [
        "A",
        [
          { status: "NOT_SELECTED", detail: "absent" },
          { status: "SELECTED", detail: "selected" }
        ]
      ]
    ])
  );
  const rateRetry: RetryConfig = {
    maxAttempts: 2,
    minDelayMs: 20,
    unknownVerificationDelayMs: 5,
    maxUnknownVerifications: 2
  };
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, rateRetry, silentLogger);
  const observation = (await availableProvider.observe(["A"], new AbortController().signal)).get("A")!;
  await worker.tick(observation, 1_000);
  assert.equal(worker.state, CourseState.RETRY_WAIT);
  assert.equal(worker.attempts.length, 1);
  await worker.tick(observation, 1_099);
  assert.equal(worker.attempts.length, 1);
  await worker.tick(observation, 1_100);
  assert.equal(worker.attempts.length, 2);
  assert.equal(worker.state, CourseState.SUCCESS);
});

test("a terminal STOPPED state is not overwritten by a late submission result", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolvePending) => {
    release = resolvePending;
  });
  const executor: SubmissionExecutor = {
    submit: async () => {
      await pending;
      return { kind: "SUBMITTED", detail: "late result", retryable: true };
    }
  };
  const verifier: CourseVerifier = {
    verify: async () => ({ status: "SELECTED", detail: "late selected" })
  };
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, silentLogger);
  const observation = (await availableProvider.observe(["A"], new AbortController().signal)).get("A")!;
  const tick = worker.tick(observation);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
  await worker.stop("test stop");
  release();
  await tick;
  assert.equal(worker.state, CourseState.STOPPED);
  assert.equal(worker.attempts.length, 1);
});

test("scheduler maximum runtime stops workers that would otherwise wait forever", async () => {
  const executor = new MockExecutor(new Map());
  const verifier = new MockVerifier(new Map());
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, silentLogger);
  const waitingProvider: ObservationProvider = {
    observe: async () => new Map([["A", {
      lessonId: "A",
      electionOpen: false,
      pageActionAvailable: false,
      selected: false,
      count: { lessonId: "A", sc: 1, lc: 1, nominalAvailable: false }
    }]])
  };
  const scheduler = new Scheduler([worker], waitingProvider, silentLogger, {
    tickIntervalMs: 1,
    maxRunDurationMs: 10
  });
  await scheduler.start();
  assert.equal(worker.state, CourseState.STOPPED);
});

test("scheduler pause prevents new work and resume continues the same workers", async () => {
  const executor = new MockExecutor(
    new Map([["A", [{ kind: "SUBMITTED", detail: "accepted", retryable: true }]]])
  );
  const verifier = new MockVerifier(
    new Map([["A", [{ status: "SELECTED", detail: "selected" }]]])
  );
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, silentLogger);
  const scheduler = new Scheduler([worker], availableProvider, silentLogger, { tickIntervalMs: 1 });
  const running = scheduler.start();
  scheduler.pause();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  assert.equal(worker.attempts.length, 0);
  scheduler.resume();
  await running;
  assert.equal(worker.state, CourseState.SUCCESS);
});

test("scheduler isolates an observation failure and resumes after recovery", async () => {
  const executor = new MockExecutor(
    new Map([["A", [{ kind: "SUBMITTED", detail: "accepted", retryable: true }]]])
  );
  const verifier = new MockVerifier(
    new Map([["A", [{ status: "SELECTED", detail: "selected" }]]])
  );
  const worker = new CourseWorker(resolved("Course A", "A"), executor, verifier, retry, silentLogger);
  let observations = 0;
  let recoveries = 0;
  const recoveringProvider: ObservationProvider = {
    observe: async (lessonIds, signal) => {
      observations += 1;
      if (observations === 1) throw new Error("temporary page unavailable");
      return availableProvider.observe(lessonIds, signal);
    }
  };
  const scheduler = new Scheduler([worker], recoveringProvider, silentLogger, {
    tickIntervalMs: 1,
    recoverObservationError: async () => {
      recoveries += 1;
      return true;
    }
  });
  await scheduler.start();
  assert.equal(recoveries, 1);
  assert.equal(worker.state, CourseState.SUCCESS);
});
