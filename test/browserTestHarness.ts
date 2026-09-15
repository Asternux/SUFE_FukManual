import { chromium, type Browser } from "playwright";

export async function launchInstalledBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError: unknown) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch (edgeError: unknown) {
      const chromeMessage = chromeError instanceof Error ? chromeError.message : String(chromeError);
      const edgeMessage = edgeError instanceof Error ? edgeError.message : String(edgeError);
      throw new Error(`no installed Chromium browser available; chrome=${chromeMessage}; edge=${edgeMessage}`);
    }
  }
}
