import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig, BrowserChannel, CourseTarget } from "../types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function requireInteger(value: unknown, field: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function parseTarget(value: unknown, index: number): CourseTarget {
  if (!isObject(value)) throw new Error(`courses[${index}] must be an object`);
  const target: CourseTarget = {
    name: requireString(value.name, `courses[${index}].name`),
    priority: requireInteger(value.priority ?? index + 1, `courses[${index}].priority`, 0)
  };
  const optionalFields = ["lessonId", "lessonNo", "courseCode", "teacher", "time"] as const;
  for (const field of optionalFields) {
    const parsed = optionalString(value[field], `courses[${index}].${field}`);
    if (parsed !== undefined) target[field] = parsed;
  }
  if (!target.lessonId && !target.lessonNo && !target.courseCode && !target.name) {
    throw new Error(`courses[${index}] has no usable matcher`);
  }
  return target;
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const absolutePath = resolve(configPath);
  const raw: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
  if (!isObject(raw)) throw new Error("config root must be an object");
  if (!isObject(raw.browser)) throw new Error("browser must be an object");
  if (!isObject(raw.submission)) throw new Error("submission must be an object");
  if (!isObject(raw.retry)) throw new Error("retry must be an object");
  if (raw.scheduler !== undefined && !isObject(raw.scheduler)) throw new Error("scheduler must be an object");
  if (!Array.isArray(raw.courses) || raw.courses.length === 0) {
    throw new Error("courses must be a non-empty array");
  }

  const entryUrl = requireString(raw.entryUrl, "entryUrl");
  const url = new URL(entryUrl);
  if (url.protocol !== "https:" || url.hostname !== "eams.sufe.edu.cn") {
    throw new Error("entryUrl must use https://eams.sufe.edu.cn");
  }
  if (!url.pathname.endsWith("/stdElectCourse!defaultPage.action")) {
    throw new Error("entryUrl must point to stdElectCourse!defaultPage.action");
  }
  const profile = url.searchParams.get("electionProfile.id");
  if (!profile || profile === "REPLACE_ME") {
    throw new Error("entryUrl must contain a real electionProfile.id in the local config");
  }

  const channelValue = raw.browser.channel;
  let channel: BrowserChannel | undefined;
  if (channelValue !== undefined) {
    if (channelValue !== "chrome" && channelValue !== "msedge") {
      throw new Error("browser.channel must be chrome or msedge");
    }
    channel = channelValue;
  }

  const browser = {
    ...(channel === undefined ? {} : { channel }),
    headless: raw.browser.headless === true,
    loginTimeoutMs: requireInteger(raw.browser.loginTimeoutMs ?? 600_000, "browser.loginTimeoutMs", 10_000)
  };
  const submission = {
    enabled: raw.submission.enabled === true,
    requireArmPhrase: raw.submission.requireArmPhrase !== false,
    minGlobalIntervalMs: requireInteger(
      raw.submission.minGlobalIntervalMs ?? 1_500,
      "submission.minGlobalIntervalMs",
      1_000
    )
  };
  const retry = {
    maxAttempts: requireInteger(raw.retry.maxAttempts ?? 3, "retry.maxAttempts", 1),
    minDelayMs: requireInteger(raw.retry.minDelayMs ?? 15_000, "retry.minDelayMs", 15_000),
    unknownVerificationDelayMs: requireInteger(
      raw.retry.unknownVerificationDelayMs ?? 3_000,
      "retry.unknownVerificationDelayMs",
      500
    ),
    maxUnknownVerifications: requireInteger(
      raw.retry.maxUnknownVerifications ?? 3,
      "retry.maxUnknownVerifications",
      1
    )
  };
  const schedulerSource = isObject(raw.scheduler) ? raw.scheduler : {};
  const scheduler = {
    tickIntervalMs: requireInteger(schedulerSource.tickIntervalMs ?? 1_000, "scheduler.tickIntervalMs", 250),
    maxRunDurationMs: requireInteger(
      schedulerSource.maxRunDurationMs ?? 21_600_000,
      "scheduler.maxRunDurationMs",
      60_000
    )
  };

  return {
    entryUrl,
    browser,
    submission,
    retry,
    scheduler,
    courses: raw.courses.map(parseTarget)
  };
}
