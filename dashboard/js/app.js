// Command center shell: station rail, command bar + search, view modes, 3D trading floor (or 2D department cards),
// detail panel, filterable live ticker, and every action. All actions go through the same controls and approval rules.
import { STATIONS, byId, stationForDept } from './stations.js';
import { PANELS } from './panels.js';
import { esc, ct, ago, agentExplainer } from './ui-core.js';
import * as M from './metrics.js';
import * as F from './floor-model.js';
import { VIEWS, deptStrip, execPanel } from './views.js';
import { createLiveStore, createDemoStore } from './store.js';
import { seedDemo } from './demo.js';

const $ = (s, el = document) => el.querySelector(s);
const PREF_KEY = 'kj-command-center';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };

let S, floor = null;
const ui = { station: null, tab: 'pending', filter: '', sub: null, mode: 'floor', mon: {}, history: [] };
const MODES = [
  { id: 'floor', key: 'f', label: 'Live Floor' }, { id: 'money', key: 'm', label: 'Money' }, { id: 'workflow', key: 'w', label: 'Workflow' },
  { id: 'customer', key: 'c', label: 'Customer' }, { id: 'content', key: 'v', label: 'Content Studio' }, { id: 'approvals', key: 'a', label: 'Approvals' }, { id: 'health', key: 'h', label: 'System Health' },
];
const MODE_VIEW = { money: 'mode-money', workflow: 'mode-workflow', customer: 'mode-customer', content: 'media', approvals: 'approvals', health: 'mode-health' };

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }
window.__toast = toast;

// "Last visit": the previous session's last-seen time, so the briefing covers what happened while you were away.
const lastVisit = prefs.lastSeen && Date.now() - prefs.lastSeen > 5 * 60000 ? new Date(prefs.lastSeen).toISOString() : prefs.prevVisit || new Date(Date.now() - 864e5).toISOString();
prefs.prevVisit = lastVisit; savePrefs();
const touch = () => { prefs.lastSeen = Date.now(); savePrefs(); };

// ------------------------------------------------------------------ derived context (one per render tick)
let ctxCache = null;
function ctx() {
  if (ctxCache) return ctxCache;
  const desks = F.deskStates(S);
  ctxCache = { desks, workload: F.workload(S, desks), walls: F.walls(S), lastVisit, conn: S.conn?.() };
  return ctxCache;
}

// ------------------------------------------------------------------ shell
function shellHtml(demo) {
  return `<div class="shell" id="shell">
    <header class="top">
      <button class="btn sm menu-btn" id="menu" aria-label="Stations">☰</button>
      <div class="brand"><span class="mark" aria-hidden="true"></span>KJ Agentic</div>
      ${demo ? '<span class="pill demo-flag" title="Demonstration data: isolated, nothing is real or sent">DEMO<span class="hide-sm">&nbsp;DATA: nothing is real or sent</span></span>' : '<span class="pill hide-sm live-flag" title="Live data from your Supabase project">LIVE DATA</span>'}
      <span class="pill paused-flag" id="paused-flag" hidden>ALL AGENTS PAUSED</span>
      <div class="search"><input id="search" placeholder="Search or type a command (e.g. “show blocked orders”)  /" autocomplete="off" aria-label="Command bar and search"><div class="search-results" id="search-results" hidden></div></div>
      <div class="spacer"></div>
      <span class="pill hide-sm" id="spend"></span>
      <span class="pill" id="conn" title="Live updates"></span>
      <span class="pill" id="online"><span class="dot"></span>worker</span>
      <button class="btn danger sm" id="pause" title="Pause or resume every agent (P)">Pause all</button>
    </header>
    <nav class="rail" id="rail" aria-label="Stations"></nav>
    <main class="stage" id="stage">
      <canvas id="floor" aria-label="3D trading floor. Use the station list, the agent monitor, or keyboard shortcuts to navigate."></canvas>
      <div class="labels" id="labels"></div>
      <div class="flat" id="flat" hidden></div>
      <div class="modebar" id="modebar" role="tablist" aria-label="View mode"></div>
      <div class="since-banner" id="since-banner" hidden></div>
      <div class="migrate-banner" id="migrate" hidden></div>
      <div class="stage-ctrl" id="stage-ctrl"></div>
      <div class="legend" id="legend"></div>
      <div class="intro" id="intro" hidden><div class="t"><h1>KJ Agentic</h1><p>Trading floor · Bryan–College Station</p></div></div>
      <button class="btn sm skip" id="skip" hidden>Skip intro</button>
      <aside class="panel closed" id="panel" aria-label="Details"><div class="panel-head"><span class="bar" id="panel-bar"></span><h2 id="panel-title"></h2><button class="btn sm" data-act="close" aria-label="Close panel">Close <kbd>Esc</kbd></button></div><div class="panel-body" id="panel-body"></div></aside>
    </main>
    <footer class="tape"><button class="lbl" id="tape-filter" aria-haspopup="true" title="Filter the ticker">LIVE ▾</button><div class="track" id="track"><div class="items" id="tape"></div></div>
      <div class="tape-menu" id="tape-menu" hidden></div></footer>
  </div>`;
}

function renderRail() {
  const need = M.approvalsNeeded(S).length;
  const c = ctx();
  const blocked = Object.values(c.desks).filter((d) => d.status === 'blocked').length;
  const paused = new Set(S.t('divisions').filter((d) => d.status === 'paused').map((d) => d.id));
  const group = (title, ids) => `<h4>${title}</h4>${ids.map((id) => { const s = byId[id];
    const w = s.dept ? c.workload[s.dept] : null;
    const badge = id === 'approvals' && need ? `<span class="badge">${need}</span>` : id === 'monitor' && blocked ? `<span class="badge red">${blocked}</span>`
      : s.division && paused.has(s.division) ? '<span class="chip warn">paused</span>' : w?.blocked ? `<span class="badge red">${w.blocked}</span>` : w?.working ? `<span class="wk">▶${w.working}</span>` : s.key ? `<span class="key">${s.key.toUpperCase()}</span>` : '';
    return `<button class="station-btn" data-act="goto" data-id="${id}" style="--accent:${s.accent}" aria-current="${ui.station === id}"><span class="glyph"></span><span>${esc(s.name)}</span>${badge}</button>`; }).join('')}`;
  $('#rail').innerHTML = group('Command', ['overview', 'approvals', 'monitor', 'timeline']) + group('Businesses', ['agency', 'sports', 'etsy', 'dropship', 'realestate', 'media']) + group('Operations', ['ventures', 'customers', 'finance', 'hq', 'setup']);
}

function renderTop() {
  const st = S.t('settings')[0] || {};
  const on = M.online(S);
  $('#online').innerHTML = `<span class="dot ${on ? 'ok' : 'bad'}"></span><span class="hide-sm">${on ? 'worker online' : 'worker offline'}</span>`;
  $('#online').title = on ? 'The cloud worker checked in within 4 minutes' : 'No heartbeat in 4+ minutes. Agent statuses may be out of date. Check Railway.';
  const ai = M.aiToday(S), budget = Number(st.daily_budget_usd || 5);
  $('#spend').innerHTML = `AI today <b class="${ai >= budget * 0.9 ? 'down' : ''}">${M.money(ai, 2)}</b> / ${M.money(budget, 2)}`;
  $('#paused-flag').hidden = !st.paused;
  const pb = $('#pause'); pb.textContent = st.paused ? 'Resume all' : 'Pause all'; pb.className = `btn sm ${st.paused ? 'go' : 'danger'}`;
  const c = S.conn?.() || {};
  const age = c.last ? Math.round((Date.now() - c.last) / 1000) : null;
  const stale = age == null || age > 180;
  $('#conn').innerHTML = `<span class="dot ${S.demo ? 'warn' : stale ? 'bad' : c.state === 'live' ? 'ok' : 'warn'}"></span><span class="hide-sm">${S.demo ? 'demo' : stale ? `stale${age != null ? ` · ${Math.round(age / 60)}m` : ''}` : `${c.state === 'live' ? 'live' : 'polling'} · ${age < 60 ? `${age}s` : `${Math.round(age / 60)}m`}`}</span>`;
  $('#conn').title = S.demo ? 'Demonstration data: isolated from production' : `Live updates: ${c.label || '—'}. Last successful update ${age != null ? `${age}s ago` : 'never'}.${stale ? ' Data may be stale.' : ''}`;
  $('#conn').classList.toggle('bad', !S.demo && stale);
}

// Which database update files haven't been run yet (detected from missing tables/columns).
function migrationsNeeded() {
  if (S.demo) return [];
  const out = [];
  const ap = S.t('approvals')[0], dv = S.t('divisions')[0];
  if (S.missing.has('workflows') || (ap && !('payload_hash' in ap))) out.push('002_command_center.sql');
  if (S.missing.has('ds_products')) out.push('003_dropship_realestate.sql');
  if (S.missing.has('brands')) out.push('004_brands_media.sql');
  if (dv && !('paused_at' in dv)) out.push('005_trading_floor.sql');
  return out;
}
function renderMigrate() {
  const need = migrationsNeeded();
  const el = $('#migrate');
  const gm = S.t('integrations').find((i) => i.id === 'gmail');
  const pub = S.t('integrations').find((i) => i.id === 'public_url' && i.status === 'connected')?.detail;
  if (!need.length && gm?.status === 'error' && /expired|revoked|Connect Gmail/i.test(gm.detail || '')) {
    el.hidden = false;
    el.innerHTML = `<b>Email is paused:</b> ${esc(gm.detail)} ${pub ? `<a href="${esc(pub.replace(/\/$/, ''))}/oauth/gmail/start" target="_blank" rel="noopener">Reconnect Gmail →</a>` : ''} <span class="faint">(While the Google app is in Testing mode, Google asks for this about once a week. Approved emails wait and send after you reconnect.)</span>`;
    return;
  }
  el.hidden = !need.length;
  if (need.length) el.innerHTML = `<b>Database update needed.</b> In Supabase → SQL Editor, run ${need.map((f) => `<a href="https://github.com/keckjones/agent-town/blob/main/supabase/${f}" target="_blank" rel="noopener">${f}</a>`).join(', then ')} (in that order). ${need.includes('002_command_center.sql') ? 'Approved items will not send until 002 is run.' : ''}`;
}

function renderModebar() {
  $('#modebar').innerHTML = MODES.map((m) => `<button role="tab" aria-selected="${ui.mode === m.id}" data-act="mode-view" data-id="${m.id}" title="${m.label} (${m.key.toUpperCase()})">${m.label}${m.id === 'approvals' && M.approvalsNeeded(S).length ? ` <b>${M.approvalsNeeded(S).length}</b>` : ''}</button>`).join('');
}
function renderCtrl() {
  const cams = prefs.cams || [];
  $('#stage-ctrl').innerHTML = `<button class="btn sm" data-act="return-floor" title="Return to Floor (F)">⌂ Return to Floor</button>
    <button class="btn sm gold" data-act="goto" data-id="overview" title="Executive Office (E)">Executive Office</button>
    <select class="i sm" id="dept-nav" aria-label="Go to department"><option value="">Departments…</option>${F.DEPTS.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
    ${floor ? `<select class="i sm" id="cam-nav" aria-label="Saved views"><option value="">Saved views…</option>${cams.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('')}<option value="save">＋ Save this view</option>${cams.length ? '<option value="clear">Clear saved views</option>' : ''}</select>
    <button class="btn sm ${prefs.fixedCam ? 'primary' : ''}" data-act="fixed-cam" title="Lock the camera (no drag or zoom)">${prefs.fixedCam ? 'Camera locked' : 'Lock camera'}</button>` : ''}
    ${floor ? `<button class="btn sm ${prefs.ambient !== false ? 'primary' : ''}" data-act="ambient" title="Idle agents sometimes take a coffee or water break. Their tag always says Idle.">${prefs.ambient !== false ? 'Breaks: on' : 'Breaks: off'}</button>` : ''}
    <button class="btn sm" data-act="sound" title="Sound alerts for new approvals and failures">${prefs.sound ? '🔔 Sound on' : '🔕 Sound off'}</button>
    <select class="i sm" id="quality" aria-label="Graphics quality"><option value="full" ${prefs.mode === 'full' || !prefs.mode ? 'selected' : ''}>3D: full</option><option value="low" ${prefs.mode === 'low' ? 'selected' : ''}>3D: simplified</option><option value="off" ${prefs.mode === 'off' ? 'selected' : ''}>2D cards</option></select>`;
  $('#legend').innerHTML = Object.values(F.STATUS).map((s) => `<span style="--c:${s.color}">${s.icon} ${s.label}</span>`).join('');
}

// ------------------------------------------------------------------ ticker
function renderTape() {
  const f = prefs.tick || {};
  const items = F.ticker(S, f, 30);
  const html = items.map((e) => `<button class="tk ${e.priority}" data-act="ref" data-ref="${esc(e.ref)}" title="${esc(ct(e.at))}"><i class="k">${esc(e.deptName)}</i><b class="${e.level === 'error' ? 'down' : e.level === 'warn' ? 'gold' : e.level === 'success' ? 'up' : ''}">${esc(e.agentName)}</b> ${esc(e.text)}${e.count > 1 ? ` <span class="x">×${e.count}</span>` : ''} <span class="faint">${ago(e.at)}</span></button>`).join('');
  $('#tape').innerHTML = html ? html + html : '<span class="faint">No recorded events match this filter.</span>';
  $('#tape').classList.toggle('still', !html);
  $('#tape-filter').textContent = `LIVE${f.dept || f.kind || f.priority === 'all' || f.priority === 'high' ? ' · filtered' : ''} ▾`;
}
function renderTapeMenu() {
  const f = prefs.tick || {};
  const kinds = ['approval', 'money', 'order', 'deadline', 'content', 'sales', 'lead', 'handoff', 'failure', 'update'];
  $('#tape-menu').innerHTML = `<label class="f">Business<select class="i" data-tick="dept"><option value="">All</option>${F.DEPTS.map((d) => `<option value="${d.id}" ${f.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="f">Priority<select class="i" data-tick="priority"><option value="important" ${(f.priority || 'important') === 'important' ? 'selected' : ''}>Important (hide routine)</option><option value="all" ${f.priority === 'all' ? 'selected' : ''}>Everything</option></select></label>
    <label class="f">Event type<select class="i" data-tick="kind"><option value="">All</option>${kinds.map((k) => `<option ${f.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <button class="btn sm" data-act="tick-reset">Reset</button>`;
}

// ------------------------------------------------------------------ 3D / 2D floor
function wallData(c) {
  const P = c.walls.performance, Sa = c.walls.sales, Co = c.walls.commerce, Ct = c.walls.content, At = c.walls.attention;
  const m = M.money, g = '#2fd38a', v = '#9b8cff', r = '#ff5d5d', y = '#f2c14e';
  const biz = Object.entries(P.byBusiness).sort((a, b) => b[1].collected - a[1].collected).slice(0, 2).map(([k, x]) => [`  ${F.deptById[k]?.short || k}`, m(x.collected), g, 'ACTUAL']);
  return {
    performance: { title: 'Business performance · 7 days', accent: '#2fd38a', rows: [[P.collected.label, m(P.collected.v), g, 'ACTUAL'], [P.contribution.label, m(P.contribution.v), P.contribution.v < 0 ? r : v, 'EST.'], [P.costs.label, m(P.costs.v), null, 'EST.'], [P.commitments.label, m(P.commitments.v), v, 'PIPELINE'], [P.pipeline.label, m(P.pipeline.v), v, 'PIPELINE'], ...biz], foot: S.demo ? 'DEMO DATA' : 'Pipeline is not revenue · click to expand' },
    sales: { title: 'Sales activity', accent: '#3aa0ff', rows: Object.values(Sa).map((x) => [x.label, x.v, null, 'ACTUAL']), foot: S.demo ? 'DEMO DATA' : 'From prospects, call reports and projects' },
    commerce: { title: 'Commerce & fulfillment', accent: '#2fd38a', rows: Object.entries(Co).map(([k, x]) => [x.label, x.v, ['exceptions', 'refunds'].includes(k) && x.v ? r : null, 'ACTUAL']), foot: S.demo ? 'DEMO DATA' : 'Orders confirmed by Shopify / Etsy' },
    content: { title: 'Content operations', accent: '#ff8bd1', rows: Object.values(Ct).map((x) => [x.label, x.v ?? '—', null, x.basis === 'na' ? 'N/A' : 'ACTUAL']), foot: S.demo ? 'DEMO DATA' : 'Published = live URL confirmed by the platform' },
    attention: { title: 'Attention required', accent: '#f2c14e', rows: Object.entries(At).map(([k, x]) => [x.label, x.v, x.v ? (k === 'approvals' ? y : r) : '#566275', null]), foot: S.demo ? 'DEMO DATA' : 'Click to see each item' },
  };
}
function execScreens(c) {
  const P = c.walls.performance, need = M.approvalsNeeded(S);
  return {
    perf: { title: 'Performance · 7d', accent: '#2fd38a', rows: [['Collected', M.money(P.collected.v), '#2fd38a', 'ACTUAL'], ['Contribution', M.money(P.contribution.v), '#9b8cff', 'EST.'], ['Pipeline', M.money(P.pipeline.v), '#9b8cff', 'PIPELINE']] },
    depts: { title: 'Departments', accent: '#3aa0ff', rows: F.DEPTS.filter((d) => d.id !== 'exec').slice(0, 9).map((d) => { const w = c.workload[d.id] || {}; return [d.short, w.blocked ? `✕${w.blocked}` : w.needs ? `!${w.needs}` : w.working ? `▶${w.working}` : '–', w.blocked ? '#ff5d5d' : w.needs ? '#f2c14e' : w.working ? '#3aa0ff' : '#566275', null]; }) },
    approvals: { title: 'Needs your approval', accent: '#f2c14e', rows: [['Waiting', need.length, need.length ? '#f2c14e' : '#566275', null], ...need.slice(0, 4).map((a) => [`  ${a.title.slice(0, 28)}`, ago(a.created_at), '#8f9bb0', null])] },
  };
}
const seenHandoffs = new Set();
let firstFloorUpdate = true;
function floorData() {
  const c = ctx();
  const all = F.handoffs(S);
  const fresh = [];
  for (const h of all) {
    if (seenHandoffs.has(h.id)) continue;
    seenHandoffs.add(h.id);
    // On first load only animate handoffs from the last two minutes; afterwards every new one.
    if (!firstFloorUpdate || Date.now() - new Date(h.at) < 120000) fresh.push(h);
  }
  firstFloorUpdate = false;
  const tick = F.ticker(S, { priority: 'important' }, 14).map((e) => `${e.deptName.toUpperCase()} · ${e.agentName}: ${e.text}\u241f${e.level === 'error' ? '#ff7b7b' : e.level === 'warn' ? '#f2c14e' : e.level === 'success' ? '#7be0a8' : '#cfe0ff'}`).join('\u241e');
  return { desks: c.desks, workload: c.workload, walls: wallData(c), exec: execScreens(c), newHandoffs: fresh, recentHandoffs: all.filter((h) => Date.now() - new Date(h.at) < 864e5), tickerText: (S.demo ? 'DEMO DATA\u241f#f2c14e\u241e' : '') + tick };
}

function renderFlat() {
  const c = ctx();
  const need = M.approvalsNeeded(S);
  const att = c.walls.attention;
  const cards = F.DEPTS.map((d) => {
    const ds = Object.values(c.desks).filter((x) => x.dept === d.id).sort((a, b) => F.STATUS_ORDER.indexOf(a.status) - F.STATUS_ORDER.indexOf(b.status));
    if (!ds.length) return '';
    const w = c.workload[d.id];
    return `<section class="tile dept" style="--accent:${d.accent}"><button class="tile-h" data-act="goto" data-id="${stationForDept(d.id)}"><h3>${esc(d.name)}</h3><span class="meta">${w.working ? `▶${w.working} ` : ''}${w.needs ? `<b class="gold">!${w.needs}</b> ` : ''}${w.blocked ? `<b class="down">✕${w.blocked}</b> ` : ''}${w.paused ? 'paused' : ''}</span></button>
      ${ds.map((x) => `<button class="deskrow" data-act="desk" data-id="${x.id}" style="--c:${x.color}"><span class="i" aria-hidden="true">${x.icon}</span><span class="nm">${esc(x.name)}</span><span class="sl">${esc(x.statusLabel)}</span>${x.task ? `<span class="tk">${esc(String(x.task).slice(0, 80))}</span>` : ''}${x.needsYou ? '<span class="ny">needs you</span>' : ''}</button>`).join('')}</section>`;
  }).join('');
  $('#flat').innerHTML = `<section class="tile attn" style="--accent:#f2c14e"><h3>Needs you</h3>
      <button class="btn gold" data-act="goto" data-id="approvals">${need.length} approvals waiting</button>
      <div class="meta">${Object.values(att).filter((x) => x.v).map((x) => `${esc(x.label)}: ${x.v}`).join(' · ') || 'Nothing else needs attention.'}</div>
      ${floor ? '' : '<button class="btn sm" data-act="quality" data-id="low">Show simplified 3D floor</button>'}</section>${cards}`;
}

async function startFloor() {
  const mode = prefs.mode || (window.innerWidth < 900 ? 'off' : 'full');
  const reduced = prefs.reduced ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduced', !!reduced);
  if (floor) { floor.destroy(); floor = null; }
  $('#flat').hidden = true; $('#floor').hidden = false;
  firstFloorUpdate = true; seenHandoffs.clear();
  if (mode === 'off') { useFlat(); renderCtrl(); return; }
  try {
    const mod = await import('./floor.js');
    if (!mod.webglAvailable()) { useFlat('WebGL is not available on this device, so department cards are shown.'); renderCtrl(); return; }
    floor = mod.createFloor({ canvas: $('#floor'), labelsEl: $('#labels'), quality: mode, reducedMotion: !!reduced, fixed: !!prefs.fixedCam, ambient: prefs.ambient !== false,
      on: { agent: (id) => openDesk(id), dept: (id) => go(stationForDept(id)), wall: (id) => go('wall', { sub: { wall: id } }), exec: () => go('overview'), ref: (r) => openRef(r) } });
    floor.update(floorData());
    window.__floor = floor;
    floor.setMode(ui.mode);
    if (prefs.camera) floor.setCamera(prefs.camera); else floor.overview();
    syncInset();
    if (ui.station) focusFor(ui.station);
    $('#stage').classList.remove('flat-mode');
    if (!prefs.introSeen && !reduced) runIntro();
  } catch (e) {
    console.error(e);
    useFlat('The 3D view could not load, so department cards are shown.');
  }
  renderCtrl();
}
function useFlat(msg) { $('#floor').hidden = true; $('#labels').innerHTML = ''; $('#flat').hidden = false; $('#stage').classList.add('flat-mode'); renderFlat(); if (msg) toast(msg); }
function runIntro() {
  const intro = $('#intro'), skip = $('#skip');
  intro.hidden = false; skip.hidden = false;
  const end = () => { intro.classList.add('gone'); skip.hidden = true; prefs.introSeen = true; savePrefs(); setTimeout(() => { intro.hidden = true; intro.classList.remove('gone'); }, 900); };
  skip.onclick = end;
  setTimeout(end, 3000);
}
function focusFor(id) {
  if (!floor) return;
  const s = byId[id];
  if (id === 'desk') return floor.focusAgent(ui.sub?.agent);
  if (id === 'wall') return floor.focusWall(ui.sub?.wall);
  if (id === 'overview') return floor.focusExec();
  if (s?.dept) return floor.focusDept(s.dept);
}

// ------------------------------------------------------------------ navigation + panel
function meta(id) {
  if (VIEWS[id]) return { name: VIEWS[id].name(S, ui), accent: VIEWS[id].accent };
  return byId[id] || null;
}
function go(id, opts = {}) {
  if (!meta(id)) return;
  if (ui.station && (ui.station !== id || JSON.stringify(ui.sub) !== JSON.stringify(opts.sub ?? null))) ui.history.push({ station: ui.station, sub: ui.sub, filter: ui.filter });
  if (ui.history.length > 20) ui.history.shift();
  if (ui.station !== id) { ui.filter = ''; }
  ui.sub = null;
  ui.station = id;
  Object.assign(ui, opts);
  const modeFor = Object.entries(MODE_VIEW).find(([, v]) => v === id)?.[0];
  if (modeFor && ui.mode !== modeFor) { ui.mode = modeFor; floor?.setMode(modeFor); renderModebar(); }
  if (!['desk', 'record'].includes(id)) { prefs.station = id; savePrefs(); }
  floor?.select(id === 'desk' ? ui.sub?.agent : null);
  renderRail(); renderPanel();
  focusFor(id);
  $('#rail').classList.remove('open');
  const hash = id === 'desk' ? `desk/${ui.sub.agent}` : id === 'record' ? `record/${ui.sub.ref}` : id === 'wall' ? `wall/${ui.sub.wall}` : id;
  if (location.hash !== `#${hash}`) history.replaceState(null, '', `#${hash}`);
}
function openDesk(id) { go('desk', { sub: { agent: id } }); }
function openRef(ref) {
  const [type, id] = String(ref).split(':');
  if (type === 'agent') return openDesk(id);
  if (type === 'wall') return go('wall', { sub: { wall: id } });
  go('record', { sub: { ref } });
}
function back() {
  const prev = ui.history.pop();
  if (!prev) return closePanel();
  ui.station = prev.station; ui.sub = prev.sub; ui.filter = prev.filter || '';
  floor?.select(ui.station === 'desk' ? ui.sub?.agent : null);
  renderRail(); renderPanel(); focusFor(ui.station);
}
function syncInset() { floor?.setInset(window.innerWidth >= 900 && !$('#panel').classList.contains('closed') ? $('#panel').getBoundingClientRect().width || Math.min(640, window.innerWidth) : 0); }
function closePanel() {
  $('#panel').classList.add('closed'); $('#stage').classList.remove('has-panel'); syncInset(); ui.station = null; ui.history = [];
  floor?.select(null); renderRail(); history.replaceState(null, '', location.pathname + location.search);
}
function returnToFloor() { ui.mode = 'floor'; floor?.setMode('floor'); renderModebar(); closePanel(); floor?.overview(); }

let panelScroll = 0;
function genericDept(S, deptId) { return agentExplainer(S, S.t('agents').filter((a) => F.deptOf(a) === deptId).map((a) => a.id)); }
function renderPanel() {
  const id = ui.station; const m = meta(id);
  if (!m) return;
  const body = $('#panel-body');
  const sig = JSON.stringify([id, ui.sub]);
  const keepScroll = body.dataset.sig === sig;
  panelScroll = keepScroll ? body.scrollTop : 0;
  $('#panel').classList.remove('closed'); $('#stage').classList.add('has-panel'); syncInset();
  $('#panel').style.setProperty('--accent', id === 'desk' ? ctx().desks[ui.sub?.agent]?.color || m.accent : m.accent);
  $('#panel-title').textContent = m.name;
  const active = document.activeElement;
  if (active && body.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && keepScroll) return;
  try {
    const c = ctx();
    const s = byId[id];
    const strip = s?.dept && id !== 'overview' && id !== 'media' ? deptStrip(S, c, s.dept) : '';
    const html = VIEWS[id] ? VIEWS[id].render(S, ui, c) : id === 'overview' ? execPanel(S, ui, c) : PANELS[id] ? PANELS[id](S, ui) : genericDept(S, s?.dept);
    body.innerHTML = strip + html;
  } catch (e) { console.error(e); body.innerHTML = `<div class="note err">This view could not render: ${esc(e.message)}. If you just updated, run the latest SQL migration.</div>`; }
  body.dataset.sig = sig;
  body.scrollTop = panelScroll;
  hydrateMedia(body);
}
async function hydrateMedia(root) {
  for (const img of root.querySelectorAll('img[data-path]')) {
    if (img.dataset.done) continue; img.dataset.done = '1';
    const url = await S.fileUrl(img.dataset.path);
    if (url) img.src = url; else img.remove();
  }
  for (const v of root.querySelectorAll('video[data-video]')) {
    if (v.dataset.done) continue; v.dataset.done = '1';
    const url = await S.fileUrl(v.dataset.video);
    if (url) v.src = url; else v.remove();
  }
}

// ------------------------------------------------------------------ command bar + global search
function searchIndex(q) {
  q = q.toLowerCase().trim();
  if (!q) return [];
  const out = [];
  const has = (s) => String(s || '').toLowerCase().includes(q);
  for (const s of STATIONS) if (has(s.name)) out.push({ label: s.name, kind: 'Station', go: () => go(s.id) });
  for (const a of S.t('agents')) if (has(a.name) || has(a.role) || has(a.id)) out.push({ label: a.name, kind: `Agent · ${ctx().desks[a.id]?.statusLabel || ''}`, go: () => openDesk(a.id) });
  for (const p of S.t('prospects')) if (has(`${p.name} ${p.email || ''} ${p.address || ''}`)) out.push({ label: p.name, kind: 'Lead', go: () => go('agency', { sub: { type: 'prospect', id: p.id } }) });
  for (const c of S.t('conversations')) if (has(c.subject) || has(c.summary)) out.push({ label: c.subject || 'Conversation', kind: 'Customer', go: () => go('customers', { sub: { type: 'conv', id: c.id } }) });
  for (const o of S.t('orders')) if (has(o.external_id)) out.push({ label: o.external_id, kind: `${o.division} order · ${o.status}`, go: () => openRef(`order:${o.id}`) });
  const props = Object.fromEntries(S.t('properties').map((p) => [p.id, p]));
  for (const d of S.t('re_deals')) { const a = props[d.property_id]?.address || ''; if (has(a)) out.push({ label: a, kind: 'Deal', go: () => go('realestate', { sub: { type: 'deal', id: d.id } }) }); }
  for (const c of S.t('content_items')) if (has(c.title) || has(c.topic)) out.push({ label: c.title || c.topic, kind: `Content · ${c.stage || c.status}`, go: () => openRef(`content:${c.id}`) });
  for (const b of S.t('brands')) if (has(b.name)) out.push({ label: b.name, kind: 'Brand', go: () => openRef(`brand:${b.id}`) });
  for (const w of S.t('workflows')) if (has(w.objective)) out.push({ label: w.objective, kind: `Workflow · ${w.status}`, go: () => openRef(`workflow:${w.id}`) });
  for (const a of S.t('approvals')) if (a.status === 'pending' && has(a.title)) out.push({ label: a.title, kind: 'Approval', go: () => openRef(`approval:${a.id}`) });
  for (const e of S.t('events')) if (has(e.message)) out.push({ label: e.message.slice(0, 90), kind: `Activity · ${ago(e.created_at)}`, go: () => openRef(`event:${e.id}`) });
  return out.slice(0, 20);
}
let searchHits = [], cmd = null;
function renderSearch() {
  const q = $('#search').value;
  searchHits = searchIndex(q);
  cmd = q.trim().length > 2 ? F.parseCommand(q) : null;
  const box = $('#search-results');
  box.hidden = !q;
  const cmdRow = cmd && !(cmd.action === 'ask' && searchHits.length) ? `<button data-hit="cmd" class="cmd"><span class="faint" style="font:11px var(--mono)">Command · Enter</span><br>→ ${esc(cmd.label)}</button>` : '';
  box.innerHTML = cmdRow + (searchHits.length ? searchHits.map((h, i) => `<button data-hit="${i}"><span class="faint" style="font:11px var(--mono)">${esc(h.kind)}</span><br>${esc(h.label)}</button>`).join('') : cmdRow ? '' : '<div style="padding:10px" class="muted">No matches.</div>');
}
async function runCommand(c, text) {
  if (!c) return;
  if (c.action === 'pause-all') return ACTIONS['pause-all']();
  if (c.action === 'pause-business') return ACTIONS['pause-business']({ id: c.args.id, to: c.args.to });
  if (c.action === 'view') { setMode(c.args.mode); if (c.args.filter) { ui.filter = c.args.filter === 'blocked-orders' ? 'blocked-orders' : c.args.filter; renderPanel(); } return; }
  if (c.action === 'since') return go('since');
  if (c.action === 'exec') return go('overview');
  if (c.action === 'monitor') return go('monitor');
  if (c.action === 'dept') return go(stationForDept(c.args.id));
  if (c.action === 'ask') { go('overview'); return askBoss(text); }
}
function setMode(mode) {
  ui.mode = mode; floor?.setMode(mode); renderModebar();
  if (mode === 'floor') { closePanel(); floor?.overview(); return; }
  go(MODE_VIEW[mode]);
  floor?.overview();
}

// ------------------------------------------------------------------ Big Boss
async function askBoss(question) {
  const q = String(question || '').trim();
  if (!q) return;
  if (S.demo) {
    // Demo: answered locally from sample data (no AI, nothing sent).
    const B = F.briefing(S, lastVisit);
    const answer = `Demo answer from sample data: ${B.approvals.length} approvals are waiting (oldest: ${B.approvals[0]?.text || 'none'}). ${B.blocked.length} items are blocked or stalled${B.blocked[0] ? `, starting with “${B.blocked[0].text}”` : ''}. Collected in 7 days: ${M.money(B.money.collected.v)} (actual).`;
    await S.insert('commands', { kind: 'ask_boss', input: { question: q }, status: 'done', result: { answer, refs: [B.approvals[0]?.ref, B.blocked[0]?.ref].filter(Boolean), actions: B.approvals[0] ? [{ type: 'open', ref: B.approvals[0].ref, label: 'Open the oldest approval' }] : [] } });
    return;
  }
  await S.command('ask_boss', { question: q });
  toast('Sent to the Big Boss. The answer appears here within a minute.');
}

// ------------------------------------------------------------------ sound alerts (muted by default)
let audio = null;
function beep(kind) {
  if (!prefs.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = kind === 'error' ? 220 : 660; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.4);
  } catch {}
}
let knownApprovals = null;
function alertsCheck() {
  const ids = new Set(M.approvalsNeeded(S).map((a) => a.id));
  if (knownApprovals) for (const id of ids) if (!knownApprovals.has(id)) { beep('approval'); break; }
  knownApprovals = ids;
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
  m.innerHTML = `<form class="box"><h3 style="margin:0;font:600 20px var(--display)">${esc(title)}</h3>${html}<div class="row"><button class="btn primary">Save</button><button class="btn" type="button" data-cancel>Cancel</button></div></form>`;
  document.body.appendChild(m);
  m.querySelector('[data-cancel]').onclick = () => m.remove();
  m.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await onSubmit(m); m.remove(); } catch (err) { toast(err.message); } };
  m.querySelector('input, textarea, select')?.focus();
}
// Prevents double clicks from sending the same control twice while the first is in flight.
const inflight = new Set();

const ACTIONS = {
  goto: (d) => go(d.id),
  'goto-div': (d) => go(STATIONS.find((s) => s.division === d.id)?.id || 'overview'),
  'goto-conv': (d) => go('customers', { sub: { type: 'conv', id: Number(d.id) } }),
  desk: (d) => openDesk(d.id),
  ref: (d) => openRef(d.ref),
  watch: (d) => { openDesk(d.id); if (!floor) toast('Watch Work needs the 3D floor. Showing the desk details instead.'); },
  close: () => closePanel(),
  back: () => back(),
  'return-floor': () => returnToFloor(),
  'mode-view': (d) => setMode(d.id),
  tab: (d) => { ui.tab = d.id; renderPanel(); },
  filter: (d) => { ui.filter = d.id; renderPanel(); },
  mon: (d) => { ui.mon = { ...ui.mon, [d.k]: d.v }; renderPanel(); },
  'open-prospect': (d) => { ui.sub = { type: 'prospect', id: d.id }; renderPanel(); },
  'open-call': (d) => { ui.sub = { type: 'call', id: d.id }; renderPanel(); },
  'open-deal': (d) => { ui.sub = { type: 'deal', id: d.id }; renderPanel(); },
  'open-conv': (d) => { ui.sub = { type: 'conv', id: d.id }; renderPanel(); },
  async run(d) {
    const key = `run:${d.agent}:${d.kind}:${d.input}`;
    if (inflight.has(key)) return; inflight.add(key); setTimeout(() => inflight.delete(key), 4000);
    await S.runTask(d.agent, d.kind, JSON.parse(d.input || '{}')); if (!S.demo) toast('Sent to the agent. Watch the live ticker.');
  },
  async 'ask-research'() {
    modalForm('Ask Market Research', '<label class="f">Question<textarea class="i" id="q-topic" required placeholder="e.g. What do salons in Bryan pay for websites?"></textarea></label>', async (m) => { await S.runTask('research', 'research', { topic: val('q-topic', m) }); toast('Research started.'); });
  },
  async approve(d) {
    if (inflight.has(`appr:${d.id}`)) return;
    const { a, payload, changed } = collectApproval(d.id);
    if (a.reversible === false || a.standing || Number(a.max_exposure_usd) > 0) {
      const ok = await confirmBox(a.standing ? 'Approve standing permission?' : 'Approve this action?', `${esc(a.title)}<br><br>${a.reversible === false ? '<b class="down">This cannot be undone.</b> ' : ''}${Number(a.max_exposure_usd) ? `Maximum exposure ${M.money(a.max_exposure_usd, 2)}. ` : ''}${a.standing ? 'Routine actions inside these exact limits will run without asking again until it ends or you pause it.' : ''}`, 'Approve', a.reversible === false);
      if (!ok) return;
    }
    inflight.add(`appr:${d.id}`);
    try { await S.update('approvals', { id: a.id }, changed ? { payload, status: 'approved' } : { status: 'approved' }); } finally { setTimeout(() => inflight.delete(`appr:${d.id}`), 3000); }
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
  async retry(d) {
    if (inflight.has(`retry:${d.id}`)) return; inflight.add(`retry:${d.id}`);
    await S.command('retry_task', { task_id: Number(d.id) }); if (!S.demo) toast('Retry requested. It runs once; the worker refuses duplicates.');
  },
  async reassign(d) {
    const to = val(`reassign-${d.id}`); if (!to) return toast('Pick an agent first.');
    if (!(await confirmBox('Reassign this workflow?', `The workflow's owner changes to <b>${esc(S.t('agents').find((a) => a.id === to)?.name || to)}</b>. It's recorded as a handoff. Each agent can still only do its own kind of work.`, 'Reassign'))) return;
    await S.command('reassign_workflow', { workflow_id: Number(d.id), to }); if (!S.demo) toast('Reassignment requested');
  },
  async 'agent-enable'(d) {
    const on = d.on === '1';
    await S.update('agents', { id: d.id }, { enabled: on, ...(on ? {} : { status: 'paused', current_task: 'Paused by owner' }), ...(on ? { status: 'idle', current_task: null } : {}) });
    if (!S.demo) toast(on ? 'Agent resumed' : 'Agent paused: it takes no new tasks. A task already running finishes.');
  },
  async 'pause-business'(d) {
    const div = S.t('divisions').find((x) => x.id === d.id);
    const to = d.to || (div?.status === 'paused' ? 'active' : 'paused');
    if (to === 'paused' && !(await confirmBox(`Pause ${esc(div?.name || d.id)}?`, 'Its agents take no new tasks and approved items for it wait (nothing is cancelled). Tasks already running finish.', 'Pause business', true))) return;
    await S.update('divisions', { id: d.id }, { status: to, paused_at: to === 'paused' ? new Date().toISOString() : null });
    if (!S.demo) toast(to === 'paused' ? 'Business paused' : 'Business resumed');
  },
  async 'auth-status'(d) {
    if (d.status === 'revoked' && !(await confirmBox('Revoke standing approval?', 'Routine actions under it stop immediately. To restart you will need a new approval.', 'Revoke', true))) return;
    await S.update('authorities', { id: Number(d.id) }, { status: d.status }); if (!S.demo) toast(`Standing approval ${d.status}`);
  },
  async 'pause-all'() {
    const st = S.t('settings')[0] || {};
    await S.update('settings', { id: 1 }, { paused: !st.paused });
    if (!S.demo) toast(st.paused ? 'Agents resumed' : 'All agents paused. Nothing new will run.');
  },
  async 'boss-action'(d) {
    const c = S.t('commands').find((x) => String(x.id) === String(d.cmd));
    const a = c?.result?.actions?.[Number(d.i)]; if (!a) return;
    if (a.type === 'open') return openRef(a.ref);
    if (a.type === 'run_task') { if (await confirmBox('Run this job?', `${esc(a.label || '')}<br><span class="meta">${esc(a.agent)} · ${esc(a.kind)}</span><br>The worker only runs jobs the dashboard is allowed to start.`, 'Run')) await ACTIONS.run({ agent: a.agent, kind: a.kind, input: JSON.stringify(a.input || {}) }); return; }
    if (a.type === 'retry_task') return ACTIONS.retry({ id: String(a.ref).split(':')[1] });
    if (a.type === 'pause_workflow') { if (await confirmBox('Pause this workflow?', esc(a.label || a.ref), 'Pause')) await ACTIONS['pause-wf']({ id: String(a.ref).split(':')[1] }); return; }
    if (a.type === 'pause_business') return ACTIONS['pause-business']({ id: a.business, to: 'paused' });
  },
  async 'check-integrations'() { await S.command('check_integrations'); if (!S.demo) toast('Re-checking connections'); },
  async 'gmail-connect'() { await S.command('gmail_connect'); if (!S.demo) toast('Preparing a Google sign-in link…'); },
  async 'retry-approval'(d) {
    if (inflight.has(`rappr:${d.id}`)) return; inflight.add(`rappr:${d.id}`);
    await S.update('approvals', { id: Number(d.id) }, { status: 'approved', result: null }); if (!S.demo) toast('Trying again. Watch this card for the result.');
  },
  async 'yt-connect'(d) { await S.command('youtube_connect', { account_id: Number(d.id) }); if (!S.demo) toast('Preparing a single-use sign-in link…'); },
  async 'acct-task'(d) {
    const a = S.t('brand_accounts').find((x) => String(x.id) === String(d.id)); if (!a) return;
    const tasks = (a.owner_tasks || []).map((t, i) => (i === Number(d.i) ? { ...t, done: !t.done, done_at: !t.done ? new Date().toISOString() : null } : t));
    await S.update('brand_accounts', { id: a.id }, { owner_tasks: tasks, updated_at: new Date().toISOString() });
  },
  async 'acct-manual'(d) {
    modalForm('Record the account you created', '<p class="muted">Paste the public profile link. This marks the account as manual-publish: you post its content yourself (no automated posting).</p><label class="f">Profile URL<input class="i" id="am-url" type="url" required></label><label class="f">Handle<input class="i" id="am-handle" placeholder="@brand"></label>', async (m) => {
      await S.update('brand_accounts', { id: Number(d.id) }, { profile_url: val('am-url', m), handle: val('am-handle', m) || null, status: 'manual_only', publish_mode: 'manual', updated_at: new Date().toISOString() }); toast('Recorded');
    });
  },
  async 'new-brand'() {
    modalForm('Propose a brand', '<p class="muted">Brand Development researches the niche and proposes a name, positioning and identity for your approval. Nothing is created until you approve.</p><label class="f">Niche or idea<input class="i" id="nb-focus" required placeholder="e.g. desk setup fixes"></label>', async (m) => { await S.runTask('brand_dev', 'propose_brand', { focus: val('nb-focus', m) }); toast('Brand research started'); });
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
  quality: (d) => { prefs.mode = d.id; savePrefs(); startFloor(); },
  mode: (d) => { prefs.mode = d.id; savePrefs(); startFloor(); toast(`Display: ${d.id === 'off' ? '2D cards' : d.id}`); },
  motion: () => { prefs.reduced = !(prefs.reduced ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches); savePrefs(); startFloor(); toast(prefs.reduced ? 'Reduced motion on' : 'Reduced motion off'); },
  'fixed-cam': () => { prefs.fixedCam = !prefs.fixedCam; savePrefs(); floor?.setFixed(prefs.fixedCam); renderCtrl(); },
  ambient: () => { prefs.ambient = prefs.ambient === false; savePrefs(); floor?.setAmbient(prefs.ambient !== false); renderCtrl(); },
  sound: () => { prefs.sound = !prefs.sound; savePrefs(); renderCtrl(); if (prefs.sound) beep('approval'); },
  'tick-reset': () => { prefs.tick = {}; savePrefs(); renderTape(); renderTapeMenu(); },
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
  async 'ask-boss'(f) { const q = val('boss-q', f); await askBoss(q); f.reset(); },
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
function routeFromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return false;
  const [kind, ...rest] = h.split('/'); const arg = rest.join('/');
  if (kind === 'desk' && arg) { openDesk(arg); return true; }
  if (kind === 'record' && arg) { openRef(arg); return true; }
  if (kind === 'wall' && arg) { go('wall', { sub: { wall: arg } }); return true; }
  if (meta(kind)) { go(kind); return true; }
  return false;
}

async function start(store) {
  S = store;
  document.body.innerHTML = shellHtml(S.demo);
  await S.init((what) => scheduleRender(what), (ev) => { if (ev.level === 'error') beep('error'); });
  ctxCache = null;
  renderRail(); renderTop(); renderTape(); renderModebar(); renderCtrl(); alertsCheck(); renderMigrate();

  document.addEventListener('click', async (e) => {
    const hit = e.target.closest('[data-hit]');
    if (hit) { const q = $('#search').value; if (hit.dataset.hit === 'cmd') runCommand(cmd, q); else searchHits[Number(hit.dataset.hit)]?.go(); $('#search').value = ''; renderSearch(); return; }
    if (!e.target.closest('#tape-menu') && !e.target.closest('#tape-filter')) $('#tape-menu').hidden = true;
    const t = e.target.closest('[data-act]');
    if (!t) { if (!e.target.closest('.search')) $('#search-results').hidden = true; return; }
    if (t.tagName === 'A') return;
    if (t.type !== 'checkbox') e.preventDefault();
    try { await ACTIONS[t.dataset.act]?.(t.dataset); } catch (err) { console.error(err); toast(err.message); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    try { await FORMS[f.dataset.form]?.(f); } catch (err) { toast(err.message); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'dept-nav' && t.value) { go(stationForDept(t.value)); t.value = ''; }
    if (t.id === 'quality') ACTIONS.quality({ id: t.value });
    if (t.id === 'cam-nav') {
      const v = t.value; t.value = '';
      if (v === 'save' && floor) modalForm('Save this view', '<label class="f">Name<input class="i" id="cam-name" required placeholder="e.g. Agency close-up"></label>', async (m) => { prefs.cams = [...(prefs.cams || []), { name: val('cam-name', m), cam: floor.getCamera() }].slice(-8); savePrefs(); renderCtrl(); toast('View saved'); });
      else if (v === 'clear') { prefs.cams = []; savePrefs(); renderCtrl(); }
      else if (v !== '' && prefs.cams?.[Number(v)]) floor?.setCamera(prefs.cams[Number(v)].cam);
    }
    if (t.dataset.tick !== undefined) { prefs.tick = { ...(prefs.tick || {}), [t.dataset.tick]: t.value || undefined }; savePrefs(); renderTape(); }
    if (t.dataset.mon !== undefined && t.dataset.mon !== 'q') { ui.mon = { ...ui.mon, [t.dataset.mon]: t.type === 'checkbox' ? t.checked : t.value }; renderPanel(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset?.mon === 'q') { ui.mon = { ...ui.mon, q: e.target.value }; clearTimeout(window.__monT); window.__monT = setTimeout(() => { const pos = e.target.selectionStart; renderPanel(); const el = $('#mon-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 250); }
  });
  $('#tape-filter').onclick = () => { renderTapeMenu(); $('#tape-menu').hidden = !$('#tape-menu').hidden; };
  $('#search').addEventListener('input', renderSearch);
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value;
      if (cmd && (cmd.action !== 'ask' || !searchHits.length)) runCommand(cmd, q); else if (searchHits[0]) searchHits[0].go();
      e.target.value = ''; renderSearch(); e.target.blur();
    }
    if (e.key === 'Escape') { e.target.value = ''; renderSearch(); e.target.blur(); }
  });
  $('#pause').onclick = () => ACTIONS['pause-all']();
  $('#menu').onclick = () => $('#rail').classList.toggle('open');

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === '/') { e.preventDefault(); $('#search').focus(); return; }
    if (k === 'Escape' && !$('#tape-menu').hidden) { $('#tape-menu').hidden = true; return; }
    if (k === 'Escape') { if (document.querySelector('.modal')) document.querySelector('.modal').remove(); else if (ui.history.length) back(); else closePanel(); return; }
    if (k === 'p' || k === 'P') return ACTIONS['pause-all']();
    if (k === '?') return go('setup');
    if (k === 'e' || k === 'E') return go('overview');
    if (k === 'Backspace' && ui.station) { e.preventDefault(); return back(); }
    const m = MODES.find((x) => x.key === k.toLowerCase());
    if (m) return setMode(m.id);
    const s = STATIONS.find((x) => x.key && x.key === k.toLowerCase());
    if (s) go(s.id);
  });

  setInterval(() => { renderTop(); touch(); }, 15000);
  touch();
  window.addEventListener('beforeunload', () => { if (floor) prefs.camera = floor.getCamera(); touch(); });

  window.addEventListener('hashchange', () => routeFromHash());
  await startFloor();
  // "What changed since my last visit?"
  const X = F.sinceLastVisit(S, lastVisit);
  if (X.counts.events || X.counts.newApprovals || X.counts.failures) {
    const b = $('#since-banner'); b.hidden = false;
    b.innerHTML = `<button class="btn sm gold" data-act="goto" data-id="since">Since your last visit (${ago(lastVisit)}): ${X.counts.tasksDone} tasks done · ${M.approvalsNeeded(S).length} need approval · ${X.counts.failures} failures · ${M.money(X.counts.collected)} collected</button><button class="btn sm ghost" aria-label="Dismiss" onclick="this.parentElement.hidden=true">✕</button>`;
  }
  if (!routeFromHash() && prefs.station && meta(prefs.station) && !VIEWS[prefs.station] && window.innerWidth >= 900) go(prefs.station);
}

// Live updates must never move things under your cursor: while you're pointing at or typing in the panel,
// its refresh waits (up to 20 seconds) until you move away.
let lastPanelInput = 0;
document.addEventListener('pointermove', (e) => { if (e.target.closest?.('#panel')) lastPanelInput = Date.now(); }, { passive: true });
document.addEventListener('keydown', (e) => { if (e.target.closest?.('#panel')) lastPanelInput = Date.now(); });
let panelDirty = false, panelDirtySince = 0;
setInterval(() => { if (panelDirty && ui.station && (Date.now() - lastPanelInput > 2500 || Date.now() - panelDirtySince > 20000)) { panelDirty = false; renderPanel(); } }, 1000);
// Time-on-task counters on desk tags tick every second without re-rendering.
setInterval(() => { for (const el of document.querySelectorAll('.label3d .tm[data-since]')) { const m = Math.max(0, Math.round((Date.now() - new Date(el.dataset.since)) / 1000)); el.textContent = m < 3600 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 3600)}h ${Math.floor((m % 3600) / 60)}m`; } }, 1000);

let pending = new Set(), rafId = null;
function scheduleRender(what) {
  pending.add(what);
  if (rafId) return;
  rafId = setTimeout(() => {
    rafId = null; const set = pending; pending = new Set();
    ctxCache = null;
    renderTop(); renderRail(); renderModebar(); alertsCheck(); renderMigrate();
    if (set.has('events') || set.has('agents') || set.has('workflow_events')) renderTape();
    if (ui.station) {
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
