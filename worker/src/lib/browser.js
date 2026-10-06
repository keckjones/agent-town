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
