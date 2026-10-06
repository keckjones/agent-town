// Inspector Ida: visits each business website, screenshots it, and scores it.
import { config } from '../config.js';
import { db, must, say, enqueue, upload } from '../lib/db.js';
import { withPage, PHONE, DESKTOP } from '../lib/browser.js';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /(example\.com|sentry|wixpress|godaddy|domain\.com|\.png|\.jpg|\.gif|\.webp|@2x)/i;

async function pageSpeed(url) {
  if (!config.googleApiKey) return null;
  try {
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${config.googleApiKey}`;
    const res = await fetch(api, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) return null;
    const j = await res.json();
    const lh = j.lighthouseResult;
    return {
      performance: Math.round((lh?.categories?.performance?.score ?? 0) * 100),
      lcp_seconds: Number(((lh?.audits?.['largest-contentful-paint']?.numericValue ?? 0) / 1000).toFixed(1)),
    };
  } catch { return null; }
}

function pickEmail(found, website) {
  const list = [...new Set(found.map((e) => e.toLowerCase()))].filter((e) => !BAD_EMAIL.test(e));
  if (!list.length) return null;
  let host = '';
  try { host = new URL(website).hostname.replace(/^www\./, ''); } catch {}
  return list.find((e) => host && e.endsWith('@' + host)) || list[0];
}

export const handlers = {
  async audit_site(task) {
    const p = must(await db.from('prospects').select('*').eq('id', task.input.prospect_id).single());
    const reviewBoost = Math.min(25, Math.round((p.review_count || 0) / 10)) + ((p.rating || 0) >= 4.3 ? 10 : 0);

    // No website at all: still a great prospect.
    if (!p.website) {
      const opportunity = Math.min(100, 70 + reviewBoost);
      await db.from('prospects').update({
        stage: 'audited', site_score: 0, opportunity,
        audit: { no_website: true, findings: ['No website listed on Google. Customers searching online cannot find details.'] },
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);
      await say('inspector', `${p.name} has no website at all. Flagging for Builder Bea.`);
      await enqueue('designer', 'design_page', { prospect_id: p.id }, { createdBy: 'inspector', priority: 4 });
      return { prospect: p.name, no_website: true, opportunity };
    }

    await say('inspector', `Inspecting ${p.website}...`);
    const findings = [];
    let score = 100;
    const emails = [];

    // Phone visit: the most important view for local businesses.
    const phone = await withPage(PHONE, async (page) => {
      const t0 = Date.now();
      let ok = true;
      try { await page.goto(p.website, { waitUntil: 'load', timeout: 30000 }); }
      catch { ok = false; }
      const loadSeconds = (Date.now() - t0) / 1000;
      if (!ok) return { ok, loadSeconds };
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
        const fontSizes = [...document.querySelectorAll('p, li, span')].slice(0, 80)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)).filter(Boolean);
        return {
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content || '',
          hasViewport: !!document.querySelector('meta[name="viewport"]'),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 5,
          text: text.slice(0, 8000),
          html: document.documentElement.outerHTML.slice(0, 200000),
          telLinks: links.filter((h) => h.startsWith('tel:')).length,
          mailtos: links.filter((h) => h.startsWith('mailto:')).map((h) => h.slice(7).split('?')[0]),
          contactLink: links.find((h) => /contact/i.test(h)) || null,
          smallText: fontSizes.length ? fontSizes.filter((s) => s < 14).length / fontSizes.length : 0,
          finalUrl: location.href,
        };
      });
      const shot = await page.screenshot({ type: 'jpeg', quality: 75 });
      return { ok, loadSeconds, ...info, shot };
    });

    if (!phone.ok) {
      findings.push('The website did not load (it may be down or very slow).');
      score = 10;
    } else {
      emails.push(...phone.mailtos, ...(phone.html.match(EMAIL_RE) || []));
      if (!phone.finalUrl.startsWith('https://')) { score -= 15; findings.push('No secure connection (no HTTPS). Browsers show a "Not secure" warning.'); }
      if (!phone.hasViewport) { score -= 20; findings.push('Not built for phones: no mobile viewport, so the page shows tiny on mobile.'); }
      if (phone.overflow) { score -= 10; findings.push('Page is wider than a phone screen; visitors have to scroll sideways.'); }
      if (phone.smallText > 0.5) { score -= 8; findings.push('Most text is smaller than 14px on phones, which is hard to read.'); }
      if (phone.telLinks === 0) { score -= 8; findings.push('No tap-to-call phone button on mobile.'); }
      if (phone.loadSeconds > 6) { score -= 10; findings.push(`Took ${phone.loadSeconds.toFixed(1)} seconds to load on our test.`); }
      const years = [...phone.text.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
      const year = years.length ? Math.max(...years) : null;
      if (year && year < new Date().getFullYear() - 2) { score -= 8; findings.push(`Footer says © ${year}, so the site looks unmaintained.`); }
      if (!phone.description) { score -= 4; findings.push('No search description, which hurts how it appears on Google.'); }
      if (phone.text.length < 300) { score -= 6; findings.push('Very little text, so Google has little to show in search results.'); }

      // Look for an email on the contact page if the homepage had none.
      if (!pickEmail(emails, p.website) && phone.contactLink) {
        try {
          const url = new URL(phone.contactLink, phone.finalUrl).href;
          const extra = await withPage(DESKTOP, async (page) => {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            return page.content();
          });
          emails.push(...(extra.match(EMAIL_RE) || []));
        } catch {}
      }
    }

    const speed = phone.ok ? await pageSpeed(p.website) : null;
    if (speed) {
      if (speed.performance < 50) { score -= 12; findings.push(`Google rates its mobile speed ${speed.performance}/100 (main content takes ${speed.lcp_seconds}s to appear).`); }
      else if (speed.performance < 75) { score -= 5; findings.push(`Google rates its mobile speed ${speed.performance}/100.`); }
    }

    score = Math.max(0, Math.min(100, score));
    const opportunity = Math.max(0, Math.min(100, Math.round((100 - score) * 0.75) + reviewBoost));

    let old_screenshot = null;
    if (phone.shot) old_screenshot = await upload(`prospects/${p.id}/old-phone.jpg`, phone.shot, 'image/jpeg');

    const email = p.email || pickEmail(emails, p.website);
    const worthIt = opportunity >= Number(task.input.min_opportunity ?? 45) && phone.ok !== false;
    await db.from('prospects').update({
      stage: worthIt ? 'audited' : 'skipped',
      site_score: score, opportunity, email,
      audit: { findings, speed, load_seconds: phone.loadSeconds, title: phone.title, description: phone.description },
      site_text: phone.text || null,
      old_screenshot,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    if (worthIt) {
      await say('inspector', `${p.name}: site scored ${score}/100. ${findings.length} problems found. Sending to the Workshop.`, 'success');
      await enqueue('designer', 'design_page', { prospect_id: p.id }, { createdBy: 'inspector', priority: 4 });
    } else {
      await say('inspector', `${p.name}: site is in decent shape (${score}/100). Skipping.`);
    }
    return { prospect: p.name, score, opportunity, findings, email };
  },
};
