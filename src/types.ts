export type BrowserChannel = "chrome" | "msedge";

export interface BrowserConfig {
  channel?: BrowserChannel;
  headless: boolean;
  loginTimeoutMs: number;
}

export interface SubmissionConfig {
  enabled: boolean;
  requireArmPhrase: boolean;
  minGlobalIntervalMs: number;
}

export interface RetryConfig {
  maxAttempts: number;
  minDelayMs: number;
  unknownVerificationDelayMs: number;
  maxUnknownVerifications: number;
}

export interface CourseTarget {
  name: string;
  lessonId?: string;
  lessonNo?: string;
  courseCode?: string;
  teacher?: string;
  time?: string;
  priority: number;
}

export interface AppConfig {
  entryUrl: string;
  browser: BrowserConfig;
  submission: SubmissionConfig;
  retry: RetryConfig;
  scheduler: SchedulerConfig;
  courses: CourseTarget[];
}

export interface SchedulerConfig {
  tickIntervalMs: number;
  maxRunDurationMs: number;
}

export enum RunPhase {
  INIT = "INIT",
  LOGIN_REQUIRED = "LOGIN_REQUIRED",
  LOADING_DATA = "LOADING_DATA",
  RESOLVING_TARGETS = "RESOLVING_TARGETS",
  READY = "READY",
  ARMED = "ARMED",
  RUNNING = "RUNNING",
  FINISHED = "FINISHED",
  STOPPED = "STOPPED"
}

export enum CourseState {
  PENDING = "PENDING",
  AVAILABLE = "AVAILABLE",
  SUBMITTING = "SUBMITTING",
  VERIFYING = "VERIFYING",
  SUCCESS = "SUCCESS",
  FULL = "FULL",
  RETRY_WAIT = "RETRY_WAIT",
  CONFLICT = "CONFLICT",
  NOT_ELIGIBLE = "NOT_ELIGIBLE",
  UNKNOWN = "UNKNOWN",
  FAILED = "FAILED",
  STOPPED = "STOPPED"
}
