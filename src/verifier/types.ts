export type VerificationStatus = "SELECTED" | "NOT_SELECTED" | "UNKNOWN";

export interface VerificationResult {
  status: VerificationStatus;
  detail: string;
}

export interface CourseVerifier {
  verify(lessonId: string, signal: AbortSignal): Promise<VerificationResult>;
}
