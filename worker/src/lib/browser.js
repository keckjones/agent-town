import { chromium } from 'playwright';

let browser = null;

export async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return browser;
}

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
export const DESKTOP = { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 };

/** Open a page with a fresh context; always closes it afterwards. */
export async function withPage(device, fn) {
  const b = await getBrowser();
  const ctx = await b.newContext({ ...device, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  try {
    return await fn(page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Render raw HTML and screenshot it. */
export async function screenshotHtml(html, device = DESKTOP, fullPage = false) {
  return withPage(device, async (page) => {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    return page.screenshot({ type: 'jpeg', quality: 80, fullPage });
  });
}

export async function closeBrowser() {
  if (browser) await browser.close().catch(() => {});
  browser = null;
}

/**
 * Record an HTML animation as a video (VP8 .webm). The page must finish its animation within `seconds`.
 * Returns a Buffer. Used for original short-form videos built from our own graphics and captions (no audio).
 */
export async function recordHtmlVideo(html, seconds, size = { width: 1080, height: 1920 }) {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
  const b = await getBrowser();
  const scale = 2;
  const ctx = await b.newContext({ viewport: { width: size.width / scale, height: size.height / scale }, deviceScaleFactor: scale, recordVideo: { dir, size } });
  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(Math.ceil(seconds * 1000) + 300);
  } finally {
    await ctx.close().catch(() => {});
  }
  const file = await page.video().path();
  const buf = await fs.readFile(file);
  await fs.rm(dir, { recursive: true, force: true });
  return buf;
}
