export type SubmissionKind =
  | "SUBMITTED"
  | "FULL"
  | "CONFLICT"
  | "NOT_ELIGIBLE"
  | "RATE_LIMITED"
  | "UNKNOWN"
  | "FAILED";

export interface SubmissionResult {
  kind: SubmissionKind;
  detail: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface SubmissionContext {
  attemptId: string;
  lessonId: string;
  signal: AbortSignal;
}

export interface SubmissionExecutor {
  submit(context: SubmissionContext): Promise<SubmissionResult>;
}
