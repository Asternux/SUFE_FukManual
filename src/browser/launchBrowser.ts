import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BrowserConfig } from "../types.js";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(config: BrowserConfig): Promise<BrowserSession> {
  const profileDirectory = resolve(".runtime", "browser-profile");
  await mkdir(profileDirectory, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDirectory, {
    headless: config.headless,
    ...(config.channel === undefined ? {} : { channel: config.channel }),
    viewport: null
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}
