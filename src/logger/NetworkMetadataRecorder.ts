import type { Page, Response } from "playwright";

interface NetworkLogSink {
  info(scope: string, message: string): Promise<void>;
  warn(scope: string, message: string): Promise<void>;
}

const OBSERVED_PATHS = [
  "/stdElectCourse!batchOperator.action",
  "/stdElectCourse!data.action",
  "/stdElectCourse!queryStdCount.action"
] as const;

function isObserved(pathname: string): boolean {
  return OBSERVED_PATHS.some((suffix) => pathname.endsWith(suffix));
}

export function attachNetworkMetadataRecorder(page: Page, logger: NetworkLogSink): () => void {
  const onResponse = (response: Response): void => {
    void (async () => {
      const url = new URL(response.url());
      if (!isObserved(url.pathname)) return;
      const request = response.request();
      const parameterNames = [...new Set(url.searchParams.keys())].sort();
      await logger.info(
        "NETWORK",
        JSON.stringify({
          observedAt: new Date().toISOString(),
          method: request.method(),
          path: url.pathname,
          parameterNames,
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "",
          redirected: request.redirectedFrom() !== null
        })
      );
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      void logger.warn("NETWORK", `metadata capture failed: ${detail}`).catch(() => undefined);
    });
  };
  page.on("response", onResponse);
  return () => page.off("response", onResponse);
}
