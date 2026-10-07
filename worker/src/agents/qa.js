// Quality Assurance: checks every site before a customer or prospect sees it.
// Real browser checks on phone and desktop: layout, links, forms, accessibility basics, weight.
import { db, must, say, enqueue, download } from '../lib/db.js';
import { withPage, PHONE, DESKTOP } from '../lib/browser.js';
import { advance, findWorkflow, logEvent } from '../lib/workflows.js';

export async function checkHtml(html) {
  const issues = [];
  const passes = [];
  const bytes = Buffer.byteLength(html);
  (bytes < 400_000 ? passes : issues).push(`Page weight ${(bytes / 1024).toFixed(0)} KB`);

  const phone = await withPage(PHONE, async (page) => {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    return page.evaluate(() => {
      const r = {};
      r.viewport = !!document.querySelector('meta[name="viewport"]');
      r.overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
      r.title = document.title.trim().length > 0;
      r.h1 = document.querySelectorAll('h1').length;
      r.imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length;
      r.badLinks = [...document.querySelectorAll('a')].filter((a) => { const h = (a.getAttribute('href') || '').trim(); return !h || h === '#' || /^javascript:/i.test(h); }).map((a) => a.textContent.trim().slice(0, 40));
      r.tel = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href'));
      r.badTel = r.tel.filter((h) => h.replace(/\D/g, '').length < 10);
      r.unlabeled = [...document.querySelectorAll('input, select, textarea')].filter((el) => {
        if (['hidden', 'submit', 'button'].includes(el.type)) return false;
        return !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest('label') && !el.getAttribute('aria-label');
      }).length;
      r.formsNoAction = [...document.querySelectorAll('form')].filter((f) => !f.getAttribute('action')).length;
      const small = [...document.querySelectorAll('p, li')].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 15).length;
      r.smallTextShare = small / Math.max(1, document.querySelectorAll('p, li').length);
      r.lang = !!document.documentElement.getAttribute('lang');
      r.tinyTargets = [...document.querySelectorAll('a, button')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 32; }).length;
      return r;
    });
  });

  const desktop = await withPage(DESKTOP, async (page) => {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    return page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 2 }));
  });

  const rule = (ok, pass, fail) => (ok ? passes : issues).push(ok ? pass : fail);
  rule(phone.viewport, 'Mobile viewport set', 'Missing mobile viewport tag');
  rule(!phone.overflow, 'No sideways scrolling on phones', 'Content is wider than a phone screen');
  rule(!desktop.overflow, 'No sideways scrolling on desktop', 'Content is wider than a desktop screen');
  rule(phone.title, 'Page has a title', 'Page title is empty');
  rule(phone.h1 === 1, 'One main heading', `Expected one H1, found ${phone.h1}`);
  rule(phone.imgsNoAlt === 0, 'All images have alt text', `${phone.imgsNoAlt} images missing alt text`);
  rule(phone.badLinks.length === 0, 'All links go somewhere', `Dead links: ${phone.badLinks.slice(0, 5).join(', ')}`);
  rule(phone.tel.length > 0, 'Tap-to-call link present', 'No tap-to-call link');
  rule(phone.badTel.length === 0, 'Phone links are valid', `Invalid phone links: ${phone.badTel.join(', ')}`);
  rule(phone.unlabeled === 0, 'Form fields are labeled', `${phone.unlabeled} form fields have no label`);
  rule(phone.formsNoAction === 0, 'Forms have a destination', `${phone.formsNoAction} forms have nowhere to send (connect a form service before launch)`);
  rule(phone.smallTextShare < 0.3, 'Body text is readable on phones', 'Much of the body text is under 15px on phones');
  rule(phone.lang, 'Page language set', 'Missing lang attribute');
  rule(phone.tinyTargets < 4, 'Tap targets are large enough', `${phone.tinyTargets} links/buttons are shorter than 32px`);

  const blocking = issues.filter((i) => /viewport|wider than|Dead links|Invalid phone|title is empty/.test(i));
  return { passed: blocking.length === 0, issues, passes, blocking, checked_at: new Date().toISOString() };
}

export const handlers = {
  async check_site(task) {
    const p = must(await db.from('prospects').select('*').eq('id', task.input.prospect_id).single());
    if (!p.new_html) return { skipped: 'no design yet' };
    await say('qa', `Checking ${p.name}'s new page on phone and desktop...`);
    const html = (await download(p.new_html)).toString('utf-8');
    const report = await checkHtml(html);
    await db.from('prospects').update({ audit: { ...(p.audit || {}), qa: report }, updated_at: new Date().toISOString() }).eq('id', p.id);
    const wf = await findWorkflow('prospect', p.id, 'agency_lead');
    await logEvent(wf?.id, 'qa', report.passed ? 'result' : 'error', `QA ${report.passed ? 'passed' : 'failed'}: ${report.issues.length} issues`, report);

    const attempt = Number(task.input.attempt || 1);
    if (!report.passed && attempt < 2) {
      await say('qa', `${p.name}: ${report.blocking.join('; ')}. Sent back to Website Production.`, 'warn');
      await enqueue('designer', 'design_page', { prospect_id: p.id, fix: report.blocking, attempt: attempt + 1 }, { createdBy: 'qa', priority: 4 });
      await advance(wf?.id, 'qa', { stage: 'preview_fix', nextAction: 'Fix QA issues' });
      return report;
    }
    if (!report.passed) {
      await advance(wf?.id, 'qa', { status: 'blocked', blockers: `QA failed twice: ${report.blocking.join('; ')}`, recovery: 'Open the Workshop, request a redesign, or skip this lead.' });
      return report;
    }
    await say('qa', `${p.name}'s preview passed QA (${report.passes.length} checks).`, 'success');
    await advance(wf?.id, 'qa', { stage: 'prepare_outreach', nextAction: p.email ? 'Draft outreach email' : 'Prepare call script' });
    if (p.email) await enqueue('postmaster', 'draft_email', { prospect_id: p.id }, { createdBy: 'qa', priority: 4 });
    else await enqueue('caller', 'prepare_call', { prospect_id: p.id, reason: 'no verified email' }, { createdBy: 'qa', priority: 4 });
    return report;
  },
};
