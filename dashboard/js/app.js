// Command center shell: station rail, search, shortcuts, 3D floor, detail panel, live tape, and every action.
import { STATIONS, byId } from './stations.js';
import { PANELS } from './panels.js';
import { esc, ct, ago } from './ui-core.js';
import * as M from './metrics.js';
import { createLiveStore, createDemoStore } from './store.js';
import { seedDemo } from './demo.js';

const $ = (s, el = document) => el.querySelector(s);
const PREF_KEY = 'kj-command-center';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };

let S, floor = null;
const ui = { station: null, tab: 'pending', filter: '', sub: null };

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }
window.__toast = toast;

// ------------------------------------------------------------------ shell
function shellHtml(demo) {
  return `<div class="shell" id="shell">
    <header class="top">
      <button class="btn sm menu-btn" id="menu" aria-label="Stations">☰</button>
      <div class="brand"><span class="mark" aria-hidden="true"></span>KJ Agentic</div>
      ${demo ? '<span class="pill demo-flag" title="Demo data: nothing is real or sent">DEMO<span class="hide-sm">&nbsp;DATA: nothing is real or sent</span></span>' : ''}
      <span class="pill paused-flag" id="paused-flag" hidden>ALL AGENTS PAUSED</span>
      <div class="search"><input id="search" placeholder="Search stations, leads, orders, deals…  ( / )" autocomplete="off" aria-label="Search"><div class="search-results" id="search-results" hidden></div></div>
      <div class="spacer"></div>
      <span class="pill hide-sm" id="spend"></span>
      <span class="pill hide-sm" id="clock"></span>
      <span class="pill" id="online"><span class="dot"></span>worker</span>
      <button class="btn danger sm" id="pause" title="Pause or resume every agent (P)">Pause all</button>
    </header>
    <nav class="rail" id="rail" aria-label="Stations"></nav>
    <main class="stage" id="stage">
      <canvas id="floor" aria-label="3D trading floor. Use the station list or number keys to navigate."></canvas>
      <div class="labels" id="labels"></div>
      <div class="flat" id="flat" hidden></div>
      <div class="stage-hud" id="hud"></div>
      <div class="stage-ctrl"><button class="btn sm" data-act="goto" data-id="overview">Overview</button><button class="btn sm gold" data-act="goto" data-id="approvals" id="hud-approvals">Approvals</button></div>
      <div class="intro" id="intro" hidden><div class="t"><h1>KJ Agentic</h1><p>Command center · Bryan–College Station</p></div></div>
      <button class="btn sm skip" id="skip" hidden>Skip intro</button>
      <aside class="panel closed" id="panel" aria-label="Station details"><div class="panel-head"><span class="bar" id="panel-bar"></span><h2 id="panel-title"></h2><button class="btn sm" data-act="close" aria-label="Close panel">Close <kbd>Esc</kbd></button></div><div class="panel-body" id="panel-body"></div></aside>
    </main>
    <footer class="tape"><div class="lbl">LIVE</div><div class="track"><div class="items" id="tape"></div></div></footer>
  </div>`;
}

function renderRail() {
  const need = M.approvalsNeeded(S).length;
  const blocked = M.failures(S).blocked.length;
  const group = (title, ids) => `<h4>${title}</h4>${ids.map((id) => { const s = byId[id];
    const badge = id === 'approvals' && need ? `<span class="badge">${need}</span>` : id === 'overview' && blocked ? `<span class="badge red">${blocked}</span>` : `<span class="key">${s.key.toUpperCase()}</span>`;
    return `<button class="station-btn" data-act="goto" data-id="${id}" style="--accent:${s.accent}" aria-current="${ui.station === id}"><span class="glyph"></span><span>${esc(s.name)}</span>${badge}</button>`; }).join('')}`;
  $('#rail').innerHTML = group('Command', ['overview', 'approvals']) + group('Businesses', ['agency', 'sports', 'etsy', 'dropship', 'realestate']) + group('Operations', ['ventures', 'customers', 'finance', 'setup']);
}

function renderTop() {
  const st = S.t('settings')[0] || {};
  const on = M.online(S);
  $('#online').innerHTML = `<span class="dot ${on ? 'ok' : 'bad'}"></span><span class="hide-sm">${on ? 'worker online' : 'worker offline'}</span>`;
  $('#online').title = on ? 'The cloud worker checked in within 4 minutes' : 'No heartbeat in 4+ minutes. Check Railway.';
  const ai = M.aiToday(S), budget = Number(st.daily_budget_usd || 5);
  $('#spend').innerHTML = `AI today <b class="${ai >= budget * 0.9 ? 'down' : ''}">${M.money(ai, 2)}</b> / ${M.money(budget, 2)}`;
  $('#paused-flag').hidden = !st.paused;
  const pb = $('#pause'); pb.textContent = st.paused ? 'Resume all' : 'Pause all'; pb.className = `btn sm ${st.paused ? 'go' : 'danger'}`;
  const need = M.approvalsNeeded(S).length;
  $('#hud-approvals').textContent = need ? `${need} need you` : 'Approvals';
}

function renderTape() {
  const evs = S.t('events').slice(0, 24);
  const names = Object.fromEntries(S.t('agents').map((a) => [a.id, a.name]));
  const items = evs.map((e) => `<span><b class="${e.level === 'error' ? 'down' : e.level === 'warn' ? 'gold' : e.level === 'success' ? 'up' : ''}">${esc(names[e.agent_id] || e.agent_id || '')}</b> ${esc(e.message)} <span class="faint">${ago(e.created_at)}</span></span>`).join('');
  $('#tape').innerHTML = items + items; // doubled for a seamless loop
}

// ------------------------------------------------------------------ 3D / 2D floor
function floorData() {
  const f7 = M.finance(S, 7), f30 = M.finance(S, 30), need = M.approvalsNeeded(S);
  const ds = M.orderStats(S, 'dropship'), et = M.orderStats(S, 'etsy'), re = M.reStats(S), ag = M.agencyFunnel(S), sp = M.sportsStats(S);
  const div = (d) => M.finance(S, 30, d);
  const agentState = {};
  for (const s of STATIONS) {
    const as = S.t('agents').filter((a) => a.division === s.division);
    agentState[s.id] = as.some((a) => a.status === 'error') ? 'error' : as.some((a) => a.status === 'working') ? 'working' : 'idle';
  }
  return {
    approvals: need.length,
    approvalsSub: need.length ? `oldest ${ago(need[need.length - 1].created_at)}` : 'all clear',
    wall: [['Collected 7d (actual)', M.money(f7.collected), '#2fd38a'], ['Contribution 7d (est.)', M.money(f7.contribution), f7.contribution < 0 ? '#ff5d5d' : '#9b8cff'],
      ['Pipeline (not revenue)', M.money(M.pipeline(S).total), '#9b8cff'], ['Open orders', ds.open + et.open], ['Failures 24h', M.failures(S).tasks.length, M.failures(S).tasks.length ? '#ff5d5d' : null]],
    stations: {
      agency: [['Leads', ag.total], ['Contacted', ag.contacted], ['Reply rate', M.pct(ag.replyRate)], ['Collected 30d', M.money(div('agency').collected), '#2fd38a']],
      sports: [['Record', sp.record || '—'], ['Units', sp.units ?? '—'], ['Posts pending', sp.pending], ['Data', sp.connected ? (sp.stale ? 'STALE' : 'fresh') : 'off', sp.stale ? '#ff5d5d' : null]],
      etsy: [['Collected 30d', M.money(div('etsy').collected), '#2fd38a'], ['Open orders', et.open], ['Exceptions', et.exceptions, et.exceptions ? '#ff5d5d' : null], ['Listed', S.t('products').filter((p) => p.stage === 'listed').length]],
      dropship: [['Collected 30d', M.money(div('dropship').collected), '#2fd38a'], ['Open orders', ds.open], ['Exceptions', ds.exceptions, ds.exceptions ? '#ff5d5d' : null], ['Obligations', M.money(ds.obligations)]],
      realestate: [['Leads', re.leads], ['Under contract', re.executed], ['Deadlines 7d', re.deadlines, re.deadlines ? '#f2c14e' : null], ['Fees collected', M.money(re.feesCollected), '#2fd38a']],
      ventures: [['Memos', S.t('opportunities').length], ['Experiments', S.t('experiments').length], ['Reports', S.t('documents').filter((d) => d.kind === 'research_report').length]],
      customers: [['Open', S.t('conversations').filter((c) => c.status !== 'resolved').length], ['Waiting on us', S.t('conversations').filter((c) => c.status === 'waiting_on_us').length], ['Do-not-contact', S.t('suppression').length]],
      finance: [['Collected 30d', M.money(f30.collected), '#2fd38a'], ['Contribution', M.money(f30.contribution), '#9b8cff'], ['AI 30d', M.money(f30.ai)], ['Refunds', M.money(f30.refunds)]],
    },
    labels: { approvals: need.length ? `${need.length} need you` : '', agency: `${ag.total} leads`, dropship: ds.exceptions ? `${ds.exceptions} exceptions` : `${ds.open} open`, realestate: re.deadlines ? `${re.deadlines} deadlines` : `${re.leads} leads`,
      etsy: `${et.open} open`, sports: sp.connected ? (sp.stale ? 'stale' : sp.record || '') : 'off', customers: `${S.t('conversations').filter((c) => c.status === 'waiting_on_us').length} waiting`, finance: M.money(f30.collected), ventures: `${S.t('opportunities').length} memos` },
    agentState,
  };
}

function renderFlat() {
  const d = floorData();
  $('#flat').innerHTML = STATIONS.map((s) => {
    const lines = s.id === 'approvals' ? [['Waiting', d.approvals]] : s.id === 'overview' ? d.wall.slice(0, 4) : (d.stations[s.id] || []);
    return `<button class="tile" data-act="goto" data-id="${s.id}" style="--accent:${s.accent}"><h3>${esc(s.name)}</h3>${lines.map(([l, v]) => `<div class="kv"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</button>`;
  }).join('');
}

async function startFloor() {
  const mode = prefs.mode || (window.innerWidth < 900 ? 'off' : 'full');
  const reduced = prefs.reduced ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduced', !!reduced);
  if (floor) { floor.destroy(); floor = null; }
  $('#flat').hidden = true; $('#floor').hidden = false;
  if (mode === 'off') return useFlat();
  try {
    const mod = await import('./floor.js');
    if (!mod.webglAvailable()) return useFlat('WebGL is not available on this device, so the 2D view is shown.');
    floor = mod.createFloor({ canvas: $('#floor'), labelsEl: $('#labels'), onSelect: (id) => go(id), mode, reducedMotion: !!reduced, introDone: !!prefs.introSeen });
    floor.setCamera(prefs.camera);
    floor.update(floorData());
    if (ui.station) floor.focus(ui.station);
    if (!prefs.introSeen && !reduced) runIntro();
  } catch (e) {
    console.error(e);
    useFlat('The 3D view could not load, so the 2D view is shown.');
  }
}
function useFlat(msg) {
  $('#floor').hidden = true; $('#labels').innerHTML = ''; $('#flat').hidden = false; renderFlat();
  if (msg) toast(msg);
}
function runIntro() {
  const intro = $('#intro'), skip = $('#skip');
  intro.hidden = false; skip.hidden = false;
  const end = () => { intro.classList.add('gone'); skip.hidden = true; prefs.introSeen = true; savePrefs(); setTimeout(() => { intro.hidden = true; intro.classList.remove('gone'); }, 900); };
  skip.onclick = () => { end(); floor?.focus(ui.station || 'overview'); };
  setTimeout(end, 3200);
}

// ------------------------------------------------------------------ panel
function go(id, opts = {}) {
  if (!byId[id]) return;
  if (ui.station !== id) { ui.sub = null; ui.filter = ''; }
  ui.station = id;
  Object.assign(ui, opts);
  prefs.station = id; savePrefs();
  renderRail(); renderPanel();
  floor?.focus(id);
  $('#rail').classList.remove('open');
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
}
function closePanel() { $('#panel').classList.add('closed'); $('#stage').classList.remove('has-panel'); ui.station = null; renderRail(); floor?.focus('overview'); history.replaceState(null, '', location.pathname); }

let panelScroll = 0;
function renderPanel() {
  const s = byId[ui.station];
  if (!s) return;
  const body = $('#panel-body');
  const keepScroll = body.dataset.station === ui.station && body.dataset.sub === JSON.stringify(ui.sub);
  panelScroll = keepScroll ? body.scrollTop : 0;
  $('#panel').classList.remove('closed'); $('#stage').classList.add('has-panel');
  $('#panel').style.setProperty('--accent', s.accent);
  $('#panel-title').textContent = s.name;
  // Don't wipe a form the owner is typing in.
  const active = document.activeElement;
  if (active && body.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && keepScroll) return;
  try { body.innerHTML = PANELS[s.id](S, ui); }
  catch (e) { console.error(e); body.innerHTML = `<div class="note err">This station could not render: ${esc(e.message)}. If you just updated, run the latest SQL migration.</div>`; }
  body.dataset.station = ui.station; body.dataset.sub = JSON.stringify(ui.sub);
  body.scrollTop = panelScroll;
  hydrateImages(body);
}
async function hydrateImages(root) {
  for (const img of root.querySelectorAll('img[data-path]')) {
    if (img.dataset.done) continue; img.dataset.done = '1';
    const url = await S.fileUrl(img.dataset.path);
    if (url) img.src = url; else img.remove();
  }
}

// ------------------------------------------------------------------ search
function searchIndex(q) {
  q = q.toLowerCase().trim();
  if (!q) return [];
  const out = [];
  for (const s of STATIONS) if (s.name.toLowerCase().includes(q)) out.push({ label: s.name, kind: 'Station', go: () => go(s.id) });
  for (const p of S.t('prospects')) if (`${p.name} ${p.email || ''} ${p.address || ''}`.toLowerCase().includes(q)) out.push({ label: p.name, kind: 'Lead', go: () => go('agency', { sub: { type: 'prospect', id: p.id } }) });
  const props = Object.fromEntries(S.t('properties').map((p) => [p.id, p]));
  for (const d of S.t('re_deals')) { const a = props[d.property_id]?.address || ''; if (a.toLowerCase().includes(q)) out.push({ label: a, kind: 'Deal', go: () => go('realestate', { sub: { type: 'deal', id: d.id } }) }); }
  for (const o of S.t('orders')) if (String(o.external_id).toLowerCase().includes(q)) out.push({ label: o.external_id, kind: `${o.division} order`, go: () => go(o.division === 'dropship' ? 'dropship' : 'etsy') });
  for (const a of S.t('approvals')) if (a.status === 'pending' && a.title.toLowerCase().includes(q)) out.push({ label: a.title, kind: 'Approval', go: () => go('approvals') });
  for (const a of S.t('agents')) if (a.name.toLowerCase().includes(q)) out.push({ label: a.name, kind: 'Agent', go: () => go(STATIONS.find((s) => s.division === a.division)?.id || 'overview') });
  for (const e of S.t('events')) if (e.message.toLowerCase().includes(q)) out.push({ label: e.message.slice(0, 90), kind: `Activity · ${ago(e.created_at)}`, go: () => go('overview') });
  return out.slice(0, 20);
}
let searchHits = [];
function renderSearch() {
  const q = $('#search').value;
  searchHits = searchIndex(q);
  const box = $('#search-results');
  box.hidden = !q;
  box.innerHTML = searchHits.length ? searchHits.map((h, i) => `<button data-hit="${i}"><span class="faint" style="font:11px var(--mono)">${esc(h.kind)}</span><br>${esc(h.label)}</button>`).join('') : '<div style="padding:10px" class="muted">No matches.</div>';
}

// ------------------------------------------------------------------ actions
const val = (id, root = document) => root.querySelector('#' + id)?.value?.trim() ?? '';
function collectApproval(id) {
  const a = S.t('approvals').find((x) => String(x.id) === String(id));
  const payload = { ...a.payload };
  for (const f of document.querySelectorAll(`[data-appr="${id}"] [data-f]`)) payload[f.dataset.f] = f.type === 'number' ? Number(f.value) : f.value;
  return { a, payload, changed: JSON.stringify(payload) !== JSON.stringify(a.payload) };
}
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box" role="dialog" aria-label="${esc(title)}"><h3 style="margin:0;font:600 20px var(--display)">${esc(title)}</h3><p>${text}</p><div class="row"><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(okLabel)}</button><button class="btn" data-cancel>Cancel</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('[data-ok]').onclick = () => { m.remove(); resolve(true); };
    m.querySelector('[data-cancel]').onclick = () => { m.remove(); resolve(false); };
    m.querySelector('[data-ok]').focus();
  });
}
function modalForm(title, html, onSubmit) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<form class="box">${`<h3 style="margin:0;font:600 20px var(--display)">${esc(title)}</h3>`}${html}<div class="row"><button class="btn primary">Save</button><button class="btn" type="button" data-cancel>Cancel</button></div></form>`;
  document.body.appendChild(m);
  m.querySelector('[data-cancel]').onclick = () => m.remove();
  m.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await onSubmit(m); m.remove(); } catch (err) { toast(err.message); } };
  m.querySelector('input, textarea, select')?.focus();
}

const ACTIONS = {
  goto: (d) => go(d.id),
  'goto-div': (d) => go(STATIONS.find((s) => s.division === d.id)?.id || 'overview'),
  close: () => closePanel(),
  back: () => { ui.sub = null; renderPanel(); },
  tab: (d) => { ui.tab = d.id; renderPanel(); },
  filter: (d) => { ui.filter = d.id; renderPanel(); },
  'open-prospect': (d) => { ui.sub = { type: 'prospect', id: d.id }; renderPanel(); },
  'open-call': (d) => { ui.sub = { type: 'call', id: d.id }; renderPanel(); },
  'open-deal': (d) => { ui.sub = { type: 'deal', id: d.id }; renderPanel(); },
  'open-conv': (d) => { ui.sub = { type: 'conv', id: d.id }; renderPanel(); },
  async run(d) { await S.runTask(d.agent, d.kind, JSON.parse(d.input || '{}')); if (!S.demo) toast('Sent to the agent. Watch the live tape.'); },
  async 'ask-research'() {
    modalForm('Ask Market Research', '<label class="f">Question<textarea class="i" id="q-topic" required placeholder="e.g. What do salons in Bryan pay for websites?"></textarea></label>', async (m) => { await S.runTask('research', 'research', { topic: val('q-topic', m) }); toast('Research started.'); });
  },
  async approve(d) {
    const { a, payload, changed } = collectApproval(d.id);
    if (a.reversible === false || a.standing || Number(a.max_exposure_usd) > 0) {
      const ok = await confirmBox(a.standing ? 'Approve standing permission?' : 'Approve this action?', `${esc(a.title)}<br><br>${a.reversible === false ? '<b class="down">This cannot be undone.</b> ' : ''}${Number(a.max_exposure_usd) ? `Maximum exposure ${M.money(a.max_exposure_usd, 2)}. ` : ''}${a.standing ? 'Routine actions inside these exact limits will run without asking again until it ends or you pause it.' : ''}`, 'Approve', a.reversible === false);
      if (!ok) return;
    }
    // Saving edits and approving in one update means the approved hash covers exactly what you see.
    await S.update('approvals', { id: a.id }, changed ? { payload, status: 'approved' } : { status: 'approved' });
    if (!S.demo) toast('Approved');
  },
  async 'save-edit'(d) { const { a, payload } = collectApproval(d.id); await S.update('approvals', { id: a.id }, { payload, status: 'pending' }); if (!S.demo) toast('Saved. Still waiting for your approval.'); },
  async changes(d) {
    modalForm('Request changes', '<label class="f">What should change?<textarea class="i" id="rc-note" required></textarea></label>', async (m) => {
      await S.update('approvals', { id: Number(d.id) }, { status: 'changes_requested', decision_note: val('rc-note', m) }); if (!S.demo) toast('Sent back with your note.');
    });
  },
  async reject(d) { await S.update('approvals', { id: Number(d.id) }, { status: 'rejected' }); if (!S.demo) toast('Rejected'); },
  async 'pause-wf'(d) { await S.update('workflows', { id: Number(d.id) }, { status: 'paused' }); if (!S.demo) toast('Workflow paused'); },
  async 'resume-wf'(d) { await S.update('workflows', { id: Number(d.id) }, { status: 'active' }); if (!S.demo) toast('Workflow resumed'); },
  async 'auth-status'(d) {
    if (d.status === 'revoked' && !(await confirmBox('Revoke standing approval?', 'Routine actions under it stop immediately. To restart you will need a new approval.', 'Revoke', true))) return;
    await S.update('authorities', { id: Number(d.id) }, { status: d.status }); if (!S.demo) toast(`Standing approval ${d.status}`);
  },
  async 'pause-all'() {
    const st = S.t('settings')[0] || {};
    await S.update('settings', { id: 1 }, { paused: !st.paused });
    if (!S.demo) toast(st.paused ? 'Agents resumed' : 'All agents paused. Nothing new will run.');
  },
  async copy(d) { try { await navigator.clipboard.writeText(d.text); toast('Copied'); } catch { toast('Select the text and copy it manually.'); } },
  async 'open-html'(d) { const html = await S.fileText(d.path); const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(url, '_blank', 'noopener'); },
  async optout(d) {
    const p = S.t('prospects').find((x) => String(x.id) === String(d.id));
    if (!(await confirmBox('Never contact this business?', `${esc(p.name)} will be removed from all outreach and its pending drafts cancelled.`, 'Do not contact', true))) return;
    await S.update('prospects', { id: p.id }, { opted_out: true, deal_stage: 'lost', next_step: null, next_step_at: null });
    if (p.email) await S.upsert('suppression', { email: p.email.toLowerCase(), reason: 'owner marked do-not-contact' }, 'email');
    await S.update('approvals', { prospect_id: p.id, status: 'pending' }, { status: 'rejected', decision_note: 'Owner marked do-not-contact' });
    if (!S.demo) toast('Marked do-not-contact');
  },
  async 'mark-posted'(d) {
    modalForm('Mark as posted', '<label class="f">Live post URL<input class="i" id="mp-url" type="url" required></label>', async (m) => {
      await S.update('content_items', { id: Number(d.id) }, { status: 'published', published_at: new Date().toISOString(), assets: { live_url: val('mp-url', m) } }); if (!S.demo) toast('Recorded');
    });
  },
  async 'etsy-sample'(d) { await S.update('products', { id: Number(d.id) }, { sample_status: d.status }); if (!S.demo) toast(`Sample ${d.status}`); },
  async 'ds-sample'(d) {
    await S.update('ds_products', { id: Number(d.id) }, { sample_status: d.status, ...(d.status === 'rejected' ? { stage: 'rejected', recommendation: 'do_not_launch' } : {}) });
    if (d.status === 'approved') await S.runTask('ds_store', 'build_listing', { product_id: Number(d.id) });
    if (!S.demo) toast(d.status === 'approved' ? 'Sample approved. Building the product page.' : 'Sample rejected. Product will not launch.');
  },
  async 'ds-release'(d) { await S.update('orders', { id: Number(d.id) }, { status: 'new' }); await S.runTask('ds_orders', 'review_order', { order_id: Number(d.id) }); if (!S.demo) toast('Re-checking the order'); },
  async 'conv-status'(d) { await S.update('conversations', { id: Number(d.id) }, { status: d.status }); if (!S.demo) toast('Updated'); },
  async 'test-text'() {
    if (!(await confirmBox('Send a test text?', 'A test message goes to (940) 366-1992. The morning text is marked active only after this test is delivered.', 'Send test'))) return;
    await S.command('send_test_text'); if (!S.demo) toast('Test text requested. Delivery status appears here within a minute or two.');
  },
  mode: (d) => { prefs.mode = d.id; savePrefs(); startFloor(); toast(`Display: ${d.id === 'off' ? '2D' : d.id}`); },
  motion: () => { prefs.reduced = !(prefs.reduced ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches); savePrefs(); startFloor(); toast(prefs.reduced ? 'Reduced motion on' : 'Reduced motion off'); },
  'replay-intro': () => { prefs.introSeen = false; savePrefs(); prefs.mode = prefs.mode === 'off' ? 'full' : prefs.mode; startFloor(); },
  signout: () => S.signOut(),
  modal: (d) => MODALS[d.id]?.(),
};

const MODALS = {
  campaign() {
    const st = S.t('settings')[0] || {};
    modalForm('New outreach campaign (standing approval)', `
      <p class="muted">This creates an approval card. Once you approve it, outreach emails and follow-ups that match these exact limits go out without asking each time.</p>
      <label class="f">Name<input class="i" id="c-name" required value="BCS pilot: ${esc((st.outreach_categories || [])[0] || 'local businesses')}"></label>
      <label class="f">Areas (comma separated)<input class="i" id="c-areas" required value="${esc((st.outreach_areas || ['College Station, TX']).slice(0, 2).join(', '))}"></label>
      <label class="f">Business types<input class="i" id="c-cats" required value="${esc((st.outreach_categories || []).slice(0, 2).join(', '))}"></label>
      <div class="grid2"><label class="f">Minimum lead score<input class="i" id="c-min" type="number" value="60"></label><label class="f">Emails per day (this campaign)<input class="i" id="c-daily" type="number" value="5"></label>
      <label class="f">Run for (days)<input class="i" id="c-days" type="number" value="14"></label><label class="f">Include follow-ups<select class="i" id="c-fu"><option value="1">Yes (per follow-up rules)</option><option value="0">No</option></select></label></div>`,
    async (m) => {
      const rules = { areas: val('c-areas', m).split(',').map((x) => x.trim()).filter(Boolean), categories: val('c-cats', m).split(',').map((x) => x.trim()).filter(Boolean),
        min_lead_score: Number(val('c-min', m)), include_followups: val('c-fu', m) === '1', templates: 'Agent-drafted from the approved offer; honest, one specific verified problem, opt-out footer' };
      await S.insert('approvals', { agent_id: 'postmaster', kind: 'email_campaign', division: 'agency', standing: true, title: `Outreach campaign: ${val('c-name', m)}`,
        reason: 'Created by you in the Agency station', scope: `${rules.areas.join(', ')} · ${rules.categories.join(', ')} · score ≥ ${rules.min_lead_score} · ${val('c-daily', m)}/day · ${val('c-days', m)} days`,
        reversible: true, payload: { authority_kind: 'email_campaign', title: val('c-name', m), rules, daily_limit: Number(val('c-daily', m)), duration_days: Number(val('c-days', m)), budget_usd: 0 } });
      toast('Campaign card created. Approve it in Approvals.'); go('approvals');
    });
  },
  'import-leads'() {
    modalForm('Import property leads', `<p class="muted">Paste CSV from county records (e.g. Brazos CAD): <code>address, owner_name, mailing_address, city, zip, phone, email</code>. One row per line, header optional.</p>
      <label class="f">Source (required)<input class="i" id="il-src" required placeholder="Brazos CAD export, 2026-10-06"></label><label class="f">Rows<textarea class="i" id="il-rows" required style="min-height:160px;font-family:var(--mono)"></textarea></label>`,
    async (m) => {
      const lines = val('il-rows', m).split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((r) => r[0] && !/^address$/i.test(r[0]));
      const rows = lines.map(([address, owner_name, mailing_address, city, zip, phone, email]) => ({ address, owner_name, mailing_address, city, zip, phone, email }));
      await S.runTask('re_leads', 'import_leads', { source: val('il-src', m), rows }); toast(`${rows.length} rows sent for import.`);
    });
  },
  'add-buyer'() {
    modalForm('Add an opt-in buyer', `<p class="muted">Only add investors who asked to receive deals. Record how they opted in.</p>
      <div class="grid2"><label class="f">Name<input class="i" id="b-name" required></label><label class="f">Email<input class="i" id="b-email" type="email"></label><label class="f">Areas / zips<input class="i" id="b-areas" placeholder="77801, 77803"></label>
      <label class="f">Max price ($)<input class="i" id="b-max" type="number"></label></div>
      <label class="f">How they opted in (required)<input class="i" id="b-how" required placeholder="Signed up at REIA meeting 10/2, form on file"></label>`,
    async (m) => {
      await S.insert('buyers', { name: val('b-name', m), email: val('b-email', m) || null, criteria: { areas: val('b-areas', m).split(',').map((x) => x.trim()).filter(Boolean), max_price: Number(val('b-max', m)) || null },
        consent: { how: val('b-how', m), when: new Date().toISOString().slice(0, 10), recorded_by: 'owner' } }); toast('Buyer added');
    });
  },
};

const FORMS = {
  async 'agency-settings'(f) {
    let pricing; try { pricing = JSON.parse(val('f-pricing', f)); } catch { throw new Error('Pricing must be valid JSON.'); }
    await S.update('settings', { id: 1 }, { outreach_areas: val('f-areas', f).split(',').map((x) => x.trim()).filter(Boolean), outreach_categories: val('f-cats', f).split(',').map((x) => x.trim()).filter(Boolean),
      daily_email_cap: Number(val('f-cap', f)), daily_prospect_cap: Number(val('f-leads', f)), outreach_offer: val('f-offer', f), agency_pricing: pricing });
    toast('Agency settings saved');
  },
  async channel(f) {
    const c = S.t('channels').find((x) => x.id === f.dataset.id);
    if (c.enabled) { await S.update('channels', { id: c.id }, { enabled: false }); return toast('Channel disabled'); }
    const notes = val(`pol-${c.id}`, f);
    if (notes.length < 15) throw new Error('Describe what you checked in the platform\'s current rules before enabling.');
    await S.update('channels', { id: c.id }, { enabled: true, policy_verified_at: new Date().toISOString(), policy_notes: notes }); toast('Channel enabled');
  },
  async 'ds-rules'(f) {
    await S.update('settings', { id: 1 }, { dropship_rules: { min_margin_pct: Number(val('ds-margin', f)), max_order_cost_usd: Number(val('ds-cost', f)), max_test_ad_budget_usd: Number(val('ds-ads', f)), hold_high_value_usd: Number(val('ds-hold', f)) } });
    toast('Boundaries saved');
  },
  async 're-legal'(f) {
    if (val('re-confirm', f) !== 'CONFIRMED') throw new Error('Type CONFIRMED to save a legal status change.');
    const templates = val('re-templates', f).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([name, version]) => ({ name, version: version || '1', reviewed_by: val('re-att', f), reviewed_on: val('re-date', f) }));
    const status = val('re-status', f);
    if (status !== 'research_only' && !val('re-att', f)) throw new Error('Record the attorney who reviewed it.');
    await S.update('re_jurisdictions', { id: 'TX' }, { status, approved_templates: templates, attorney_review: { reviewer: val('re-att', f), reviewed_on: val('re-date', f), recorded: new Date().toISOString() }, updated_at: new Date().toISOString() });
    toast('Legal status saved');
  },
  async 're-milestone'(f) {
    const kind = val('ms-kind', f);
    const toIso = (v) => (v ? new Date(v).toISOString() : null);
    const data = { price_usd: Number(val('ms-price', f)) || null, deadlines: { option_period: toIso(val('ms-option', f)), closing: toIso(val('ms-closing', f)) }, fee_collected_usd: Number(val('ms-fee', f)) || 0, reason: val('ms-note', f) };
    if (kind === 'closed_funds_received' && !data.fee_collected_usd) throw new Error('Enter the fee you actually received.');
    if (!(await confirmBox('Record milestone?', kind === 'contract_executed' ? 'Only if both signatures are in hand. Deadlines will be tracked from the dates you entered.' : kind === 'closed_funds_received' ? `Records ${M.money(data.fee_collected_usd)} as collected revenue.` : 'Marks the deal cancelled.', 'Record'))) return;
    await S.command('re_milestone', { deal_id: Number(f.dataset.id), milestone: kind, data }); toast('Recorded');
  },
  async 'call-outcome'(f) {
    const meet = val('co-meet', f);
    await S.runTask('caller', 'record_outcome', { call_task_id: Number(f.dataset.id), outcome: val('co-outcome', f), notes: val('co-notes', f), email: val('co-email', f) || null, meeting_at: meet ? new Date(meet).toISOString() : null });
    toast('Call report filed'); ui.sub = null; renderPanel();
  },
  async suppress(f) { await S.upsert('suppression', { email: val('sup-email', f).toLowerCase(), reason: 'added by owner' }, 'email'); toast('Added to do-not-contact'); f.reset(); },
  async notify(f) {
    await S.update('notify_settings', { id: 1 }, { digest_time: val('n-time', f), digest_enabled: val('n-on', f) === '1', urgent_alerts: val('n-urgent', f) === '1', dashboard_url: val('n-url', f), updated_at: new Date().toISOString() });
    toast('Morning text settings saved');
  },
  async reserves(f) {
    for (const el of f.querySelectorAll('[data-res]')) await S.update('cash_reserves', { id: el.dataset.res }, { amount_usd: Number(el.value || 0) });
    await S.update('settings', { id: 1 }, { daily_budget_usd: Number(val('b-ai', f)), weekly_goal: Number(val('b-goal', f)) });
    toast('Saved');
  },
  async ledger(f) {
    const amt = Number(val('l-amt', f));
    if (!amt) throw new Error('Enter an amount.');
    await S.insert('ledger', { amount_usd: amt, category: val('l-cat', f), division: val('l-div', f), basis: 'actual', source: 'entered by owner', note: val('l-note', f) || null });
    toast('Recorded'); f.reset();
  },
};

// ------------------------------------------------------------------ boot
async function start(store) {
  S = store;
  document.body.innerHTML = shellHtml(S.demo);
  await S.init((what) => scheduleRender(what), (ev) => { /* live tape picks it up */ });
  renderRail(); renderTop(); renderTape();

  document.addEventListener('click', async (e) => {
    const hit = e.target.closest('[data-hit]');
    if (hit) { searchHits[Number(hit.dataset.hit)]?.go(); $('#search').value = ''; renderSearch(); return; }
    const t = e.target.closest('[data-act]');
    if (!t) { if (!e.target.closest('.search')) $('#search-results').hidden = true; return; }
    if (t.tagName === 'A') return;
    e.preventDefault();
    try { await ACTIONS[t.dataset.act]?.(t.dataset); } catch (err) { console.error(err); toast(err.message); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    try { await FORMS[f.dataset.form]?.(f); } catch (err) { toast(err.message); }
  });
  $('#search').addEventListener('input', renderSearch);
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && searchHits[0]) { searchHits[0].go(); e.target.value = ''; renderSearch(); e.target.blur(); } if (e.key === 'Escape') { e.target.value = ''; renderSearch(); e.target.blur(); } });
  $('#pause').onclick = () => ACTIONS['pause-all']();
  $('#menu').onclick = () => $('#rail').classList.toggle('open');

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === 'Escape') { if (document.querySelector('.modal')) document.querySelector('.modal').remove(); else closePanel(); return; }
    if (e.key === 'a' || e.key === 'A') return go('approvals');
    if (e.key === 'p' || e.key === 'P') return ACTIONS['pause-all']();
    if (e.key === '?') return go('setup');
    const s = STATIONS.find((x) => x.key === e.key.toLowerCase());
    if (s) go(s.id);
  });

  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT'; renderTop(); }, 15000);
  $('#clock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';

  await startFloor();
  const hash = location.hash.slice(1);
  if (byId[hash]) go(hash); else if (prefs.station && byId[prefs.station] && window.innerWidth >= 900) go(prefs.station);
  window.addEventListener('beforeunload', () => { if (floor) { prefs.camera = floor.camera(); savePrefs(); } });
}

// Live updates must never move things under your cursor: while you're pointing at or typing in the panel,
// its refresh waits (up to 20 seconds) until you move away.
let lastPanelInput = 0;
document.addEventListener('pointermove', (e) => { if (e.target.closest?.('#panel')) lastPanelInput = Date.now(); }, { passive: true });
document.addEventListener('keydown', (e) => { if (e.target.closest?.('#panel')) lastPanelInput = Date.now(); });
let panelDirty = false, panelDirtySince = 0;
setInterval(() => { if (panelDirty && ui.station && (Date.now() - lastPanelInput > 2500 || Date.now() - panelDirtySince > 20000)) { panelDirty = false; renderPanel(); } }, 1000);

let pending = new Set(), rafId = null;
function scheduleRender(what) {
  pending.add(what);
  if (rafId) return;
  rafId = setTimeout(() => {
    rafId = null; const set = pending; pending = new Set();
    renderTop(); renderRail();
    if (set.has('events') || set.has('agents')) renderTape();
    const onlyChatter = [...set].every((x) => ['events', 'agents', 'usage', 'commands'].includes(x));
    if (ui.station && !(onlyChatter && !['overview', 'approvals'].includes(ui.station))) {
      if (Date.now() - lastPanelInput < 2500) { if (!panelDirty) panelDirtySince = Date.now(); panelDirty = true; }
      else renderPanel();
    }
    if (floor) floor.update(floorData()); else if (!$('#flat').hidden) renderFlat();
  }, 250);
}

async function boot() {
  const cfg = window.TOWN_CONFIG || {};
  const wantDemo = /[?&]demo\b/.test(location.search) || !cfg.supabaseUrl || !window.supabase;
  if (wantDemo) return start(createDemoStore(seedDemo));
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data } = await sb.auth.getSession();
  if (data.session) return start(createLiveStore(sb));
  document.body.innerHTML = `<div class="center"><form class="login" id="login"><h1>KJ Agentic</h1><p class="muted" style="margin:0">Sign in to the command center.</p>
    <label class="f">Email<input class="i" id="le" type="email" autocomplete="email" required></label><label class="f">Password<input class="i" id="lp" type="password" autocomplete="current-password" required></label>
    <div class="err" id="lerr"></div><button class="btn primary">Enter</button><a class="muted" href="?demo" style="font-size:12px">View the demo with sample data</a></form></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault(); $('#lerr').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#le').value, password: $('#lp').value });
    if (error) { $('#lerr').textContent = error.message; return; }
    start(createLiveStore(sb));
  };
}

boot();
