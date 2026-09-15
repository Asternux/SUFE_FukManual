import type { SubmissionResult } from "./types.js";

export interface ResponseEvidence {
  status: number;
  method: string;
  contentType: string;
  bodyText: string;
  retryAfter?: string;
}

function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const target = Date.parse(value);
  return Number.isFinite(target) ? Math.max(0, target - now) : undefined;
}

function compactText(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function classifySubmissionResponse(evidence: ResponseEvidence): SubmissionResult {
  const text = compactText(evidence.bodyText).toLocaleLowerCase("zh-CN");
  const retryAfterMs = parseRetryAfter(evidence.retryAfter);
  if (evidence.status === 429 || /操作.{0,4}频繁|请求.{0,4}频繁|稍后再试|too many requests|rate.?limit/i.test(text)) {
    return {
      kind: "RATE_LIMITED",
      detail: `server rate limit signal; status=${evidence.status}`,
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs })
    };
  }
  if (/人数已满|容量已满|名额已满|没有余量|\bfull\b/i.test(text)) {
    return { kind: "FULL", detail: "response explicitly reports full capacity", retryable: true };
  }
  if (/时间冲突|课程冲突|上课时间.{0,4}冲突|\bconflict\b/i.test(text)) {
    return { kind: "CONFLICT", detail: "response explicitly reports a conflict", retryable: false };
  }
  if (/无.{0,3}资格|没有.{0,3}资格|不允许.{0,6}(选课|选择)|不能同时.{0,6}(选择|修读)|不在选课范围|未开放|超(?:出|过).{0,24}(学分|门数|上限|限制)|已达.{0,16}(上限|限制)|不满足.{0,16}(条件|要求)|not eligible|permission denied/i.test(text)) {
    return { kind: "NOT_ELIGIBLE", detail: "response explicitly reports no eligibility", retryable: false };
  }
  if (/选课失败|操作失败|未能选中|未选成功|无法选择|系统异常/i.test(text)) {
    return { kind: "UNKNOWN", detail: "response explicitly reports failure; verifier required", retryable: true };
  }
  if (evidence.status >= 500 || evidence.status === 0) {
    return { kind: "UNKNOWN", detail: `transport/server status=${evidence.status}; verifier required`, retryable: true };
  }
  if (evidence.status >= 400) {
    return { kind: "FAILED", detail: `HTTP status=${evidence.status}`, retryable: false };
  }
  return {
    kind: "SUBMITTED",
    detail: `${evidence.method} completed with HTTP ${evidence.status}; no success assumption`,
    retryable: true
  };
}

export function classifyDialog(type: string, message: string): SubmissionResult {
  const base = classifySubmissionResponse({ status: 200, method: "DIALOG", contentType: "text/plain", bodyText: message });
  if (base.kind !== "SUBMITTED") return base;
  return {
    kind: "UNKNOWN",
    detail: `${type} dialog dismissed; verifier required`,
    retryable: true
  };
}
