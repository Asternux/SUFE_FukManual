import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export function redactLogMessage(value: string): string {
  return value
    .replace(/([?&](?:ticket|token|code|session|jsessionid|authorization|signature)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(Authorization\s*:\s*)(?:Bearer\s+)?\S+/gi, "$1[REDACTED]")
    .replace(/\b(Cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/\b(?:password|passwd|sessionId|jsessionid|accessToken|refreshToken)\s*[=:]\s*\S+/gi, "[SENSITIVE_FIELD]=[REDACTED]");
}

export class Logger {
  private readonly filePaths: string[];

  public constructor(...filePaths: Array<string | undefined>) {
    this.filePaths = [...new Set(filePaths.filter((path): path is string => path !== undefined))];
  }

  public async log(level: LogLevel, scope: string, message: string): Promise<void> {
    const line = `[${new Date().toISOString()}] [${level}] [${redactLogMessage(scope)}] ${redactLogMessage(message)}`;
    process.stdout.write(`${line}\n`);
    for (const filePath of this.filePaths) {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${line}\n`, "utf8");
    }
  }

  public info(scope: string, message: string): Promise<void> {
    return this.log("INFO", scope, message);
  }

  public warn(scope: string, message: string): Promise<void> {
    return this.log("WARN", scope, message);
  }

  public error(scope: string, message: string): Promise<void> {
    return this.log("ERROR", scope, message);
  }
}
