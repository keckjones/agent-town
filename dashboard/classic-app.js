// Agent Town dashboard: wires the town, the notice board, and the approval inbox to the data store.
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const money2 = (n) => '$' + Number(n || 0).toFixed(2);
  const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

  let store, S, view = 'home', inboxTab = 'pending', avatars = {};
  const agentById = (id) => S.agents.find((a) => a.id === id) || { id, name: id };

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  function md(text) {
    const lines = esc(text || '').split('\n');
    let html = '', inList = false;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    for (const l of lines) {
      const li = l.match(/^\s*[-*]\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = l.match(/^(#{1,4})\s+(.*)/);
      if (h) html += `<h3>${inline(h[2])}</h3>`;
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }

  // ---------------------------------------------------------------- HUD
  function renderHUD() {
    const goal = Number(S.settings.weekly_goal || 2000);
    const earned = S.revenue.reduce((s, r) => s + Number(r.amount), 0);
    $('#rev-text').innerHTML = `<span>This week's earnings</span><b>${money(earned)} / ${money(goal)}</b>`;
    $('#rev-bar').style.width = Math.min(100, (earned / goal) * 100) + '%';
    const budget = Number(S.settings.daily_budget_usd || 5);
    $('#spend-text').innerHTML = `<span>AI spend today</span><b>${money2(S.spentToday)} / ${money2(budget)}</b>`;
    $('#spend-bar').style.width = Math.min(100, (S.spentToday / budget) * 100) + '%';
    $('#spend-bar').parentElement.classList.toggle('hot', S.spentToday >= budget * 0.9);
    const pending = S.approvals.filter((a) => a.status === 'pending').length;
    const badge = $('#inbox-count'); badge.textContent = pending; badge.dataset.n = pending;
    const paused = !!S.settings.paused;
    const pb = $('#pause-btn'); pb.textContent = paused ? 'Resume town' : 'Pause all'; pb.className = 'btn ' + (paused ? 'go' : 'stop');
    const mgr = agentById('manager');
    const online = S.demo || (mgr.last_seen && Date.now() - new Date(mgr.last_seen) < 4 * 60000);
    $('#online').className = 'dot' + (online ? ' on' : '');
    $('#online').title = online ? 'Worker is online' : 'Worker looks offline. Check Railway.';
  }

  // ---------------------------------------------------------------- BOARD
  function chip(status) { return `<span class="chip ${esc(status)}">${esc(status)}</span>`; }
  function level(xp) { return 1 + Math.floor((xp || 0) / 100); }
  function avatar(id) { return avatars[id] || (avatars[id] = Town.avatar(id)); }

  function agentCard(a) {
    const xpIn = (a.xp || 0) % 100;
    return `<div class="card"><div class="row" style="flex-wrap:nowrap">
        <img class="avatar" src="${avatar(a.id)}" alt="">
        <div style="flex:1;min-width:0"><b style="font-family:var(--display);font-size:16px">${esc(a.name)}</b> ${chip(a.status)}
          <div class="muted">${esc(a.role || '')}</div></div></div>
      <div class="muted" style="margin-top:6px">${a.current_task ? 'Now: ' + esc(a.current_task) : esc(a.speech || 'Waiting for work')}</div>
      <div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted">Level ${level(a.xp)} · ${a.tasks_done || 0} jobs done</span><span class="muted">${xpIn}/100 XP</span></div>
      <div class="xp"><i style="width:${xpIn}%"></i></div></div>`;
  }

  function logRows(events, max = 30) {
    if (!events.length) return '<p class="muted light">Nothing yet.</p>';
    return `<div class="log">${events.slice(0, max).map((e) => `<div class="log-row ${esc(e.level)}"><time>${timeOf(e.created_at)}</time><div><b>${esc(agentById(e.agent_id).name || e.agent_id)}</b> ${esc(e.message)}</div></div>`).join('')}</div>`;
  }

  function prospectItem(p, extra = '') {
    const sc = p.site_score ?? null;
    const cls = sc === null ? '' : sc < 45 ? 'bad' : sc < 70 ? 'ok' : 'good';
    return `<div class="card item"><div class="item-head"><b>${esc(p.name)}</b>${sc !== null ? `<span class="score ${cls}" title="Current site score">${sc}/100</span>` : ''}</div>
      <div class="muted">${esc(p.category || '')}${p.rating ? ` · ★ ${p.rating} (${p.review_count})` : ''} · ${esc(p.stage)}</div>
      ${p.website ? `<div class="muted" style="overflow-wrap:anywhere">${esc(p.website)}</div>` : '<div class="muted">No website</div>'}
      ${extra}</div>`;
  }

  async function lazyImages(root) {
    for (const img of root.querySelectorAll('img[data-path]')) {
      const url = await store.fileUrl(img.dataset.path);
      if (url) img.src = url; else img.remove();
    }
  }

  const builders = {
    async town_hall() {
      const plan = (await store.docs('manager_plan', 1))[0];
      const s = S.settings;
      return `<button class="btn go" data-act="enqueue" data-agent="manager" data-kind="plan">Call a town meeting now</button>
        <h3>Latest town meeting</h3>
        <div class="card md">${plan ? `<div class="muted">${esc(plan.title)}</div>${md(plan.body)}` : 'No meeting yet. The mayor meets every few hours.'}</div>
        <h3>Log a payment</h3>
        <form class="card stack" data-form="revenue">
          <div class="row"><input id="rev-amount" type="number" min="1" step="1" placeholder="Amount ($)" required><input id="rev-source" placeholder="From (e.g. Joe's Tacos)"></div>
          <button class="btn gold">Add to this week</button>
          ${S.revenue.length ? `<div class="muted">${S.revenue.slice(0, 6).map((r) => `${money(r.amount)} · ${esc(r.source || r.note || '')}`).join('<br>')}</div>` : ''}
        </form>
        <h3>Town rules</h3>
        <form class="card stack" data-form="settings">
          <div class="row"><label>Weekly goal ($)<input id="s-goal" type="number" value="${esc(s.weekly_goal)}"></label><label>Max AI spend per day ($)<input id="s-budget" type="number" step="0.5" value="${esc(s.daily_budget_usd)}"></label></div>
          <div class="row"><label>Emails per day<input id="s-emails" type="number" value="${esc(s.daily_email_cap)}"></label><label>New prospects per day<input id="s-prospects" type="number" value="${esc(s.daily_prospect_cap)}"></label></div>
          <label>City to scout<input id="s-city" value="${esc(s.outreach_city)}"></label>
          <label>Business types to scout (comma separated)<input id="s-cats" value="${esc((s.outreach_categories || []).join(', '))}"></label>
          <label>Your offer (used in emails)<textarea id="s-offer" style="min-height:70px">${esc(s.outreach_offer)}</textarea></label>
          <label>What the business is about<textarea id="s-focus" style="min-height:60px">${esc(s.business_focus)}</textarea></label>
          <label>Notes for the mayor (priorities, things to avoid)<textarea id="s-notes" style="min-height:60px">${esc(s.manager_notes)}</textarea></label>
          <button class="btn go">Save rules</button>
        </form>`;
    },
    async library() {
      const reports = await store.docs('research_report');
      return `<form class="card stack" data-form="research"><label>Ask Lou to research<input id="r-topic" placeholder="e.g. What do salons in Bryan-College Station pay for websites?" required></label><button class="btn go">Send to the Library</button></form>
        <h3>Reports</h3>${reports.length ? reports.map((r) => `<details class="card"><summary>${esc(r.title)}</summary><div class="muted">${ago(r.created_at)}</div><div class="md">${md(r.body)}</div></details>`).join('') : '<p class="muted light">No reports yet.</p>'}`;
    },
    async lodge() {
      const cats = S.settings.outreach_categories || [];
      const counts = S.prospects.reduce((m, p) => ((m[p.stage] = (m[p.stage] || 0) + 1), m), {});
      const order = ['found', 'audited', 'designed', 'drafted', 'contacted', 'replied', 'client', 'skipped', 'lost'];
      return `<form class="card stack" data-form="scout"><label>Send Sam scouting for<select id="sc-cat">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><input id="sc-other" placeholder="…or type another business type"><button class="btn go">Send scout</button></form>
        <h3>Pipeline</h3><div class="stats">${order.map((k) => `<div class="stat"><b>${counts[k] || 0}</b><span>${k}</span></div>`).join('')}</div>
        <h3>Newest finds</h3><div class="stack">${S.prospects.slice(0, 12).map((p) => prospectItem(p)).join('') || '<p class="muted light">No prospects yet.</p>'}</div>`;
    },
    async inspector() {
      const list = S.prospects.filter((p) => p.audit).sort((a, b) => (b.opportunity || 0) - (a.opportunity || 0)).slice(0, 15);
      return `<p class="muted light">Ida scores each website out of 100 (lower = worse site = better prospect).</p><div class="stack">${list.map((p) => prospectItem(p,
        `${(p.audit.findings || []).length ? `<ul class="findings">${p.audit.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
         ${p.old_screenshot ? `<details><summary>Their site on a phone</summary><img class="thumb" alt="Current site on a phone" data-path="${esc(p.old_screenshot)}"></details>` : ''}`)).join('') || '<p class="muted light">Nothing inspected yet.</p>'}</div>`;
    },
    async workshop() {
      const list = S.prospects.filter((p) => p.comparison || p.new_html).slice(0, 12);
      return `<p class="muted light">Every new homepage Bea builds. Open one to see the full page.</p><div class="stack">${list.map((p) => prospectItem(p,
        `${p.comparison ? (p.comparison.startsWith('data:') ? `<img class="thumb" alt="Before and after" src="${p.comparison}">` : `<img class="thumb" alt="Before and after" data-path="${esc(p.comparison)}">`) : ''}
         <div class="row">${p.new_html ? `<button class="btn small" data-act="open-html" data-path="${esc(p.new_html)}">Open new page</button>` : ''}<button class="btn small" data-act="enqueue" data-agent="designer" data-kind="design_page" data-prospect="${p.id}">Redesign</button></div>`)).join('') || '<p class="muted light">No designs yet.</p>'}</div>`;
    },
    async post_office() {
      const waiting = S.approvals.filter((a) => a.kind === 'email' && a.status === 'pending').length;
      const contacted = S.prospects.filter((p) => ['contacted', 'replied', 'client'].includes(p.stage));
      return `<button class="btn gold" data-act="inbox">Open approval inbox (${waiting} letters waiting)</button>
        <p class="muted light">Approved letters go out automatically once your outreach mailbox is set up, up to your daily email limit.</p>
        <h3>Letters sent</h3><div class="stack">${contacted.map((p) => prospectItem(p,
          `<div class="row"><button class="btn small" data-act="stage" data-id="${p.id}" data-stage="replied">They replied</button><button class="btn small gold" data-act="stage" data-id="${p.id}" data-stage="client">Became a client</button><button class="btn small" data-act="stage" data-id="${p.id}" data-stage="lost">Not interested</button></div>`)).join('') || '<p class="muted light">None sent yet.</p>'}</div>
        <h3>Do-not-contact list</h3><form class="card stack" data-form="suppress"><label>Someone asked to unsubscribe? Add their email<input id="sup-email" type="email" required></label><button class="btn">Never email them again</button></form>`;
    },
    async store() {
      const items = await store.docs('product');
      return `<form class="card stack" data-form="product"><label>Product idea (optional)<input id="pr-idea" placeholder="Leave blank and Mo picks from research"></label><button class="btn go">Draft a listing</button></form>
        <h3>Listings</h3>${items.map((d) => `<details class="card"><summary>${esc(d.title)}${d.data?.price_usd ? ` · $${esc(d.data.price_usd)}` : ''}</summary><div class="muted">${esc(d.data?.short_description || '')}</div>${d.data?.production_outline ? `<p class="muted">How to make it:</p><ul class="findings">${d.data.production_outline.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</details>`).join('') || '<p class="muted light">No listings yet.</p>'}`;
    },
    async billboard() {
      const items = await store.docs('campaign');
      return `<form class="card stack" data-form="campaign"><label>Campaign goal (optional)<input id="cp-focus" placeholder="e.g. get 5 calls from auto shops"></label><button class="btn go">Plan a campaign</button></form>
        <h3>Campaigns</h3>${items.map((d) => `<details class="card"><summary>${esc(d.title)}</summary><div class="md">${md(d.body)}</div></details>`).join('') || '<p class="muted light">No campaigns yet.</p>'}`;
    },
    async square() {
      const done = S.approvals.filter((a) => a.kind === 'social_post' && a.status === 'executed').slice(0, 10);
      return `<form class="card stack" data-form="posts"><label>Post theme<input id="po-theme" placeholder="e.g. the 10-second phone test" required></label><button class="btn go">Write 3 posts</button></form>
        <h3>Approved, ready to post</h3><div class="stack">${done.map((a) => `<div class="card item"><div class="item-head"><b>${esc(a.payload.platform)}</b><button class="btn small" data-act="copy" data-text="${esc(a.payload.text)}">Copy</button></div><div class="pre">${esc(a.payload.text)}</div></div>`).join('') || '<p class="muted light">Approve posts in the inbox and they show up here.</p>'}</div>`;
    },
  };

  async function renderBoard() {
    const el = $('#board');
    if (view === 'home') {
      el.innerHTML = `<h2>Town board</h2>
        <div class="roster">${S.agents.map((a) => `<button class="who" data-act="view" data-view="${Town.buildingOf(a.id)}"><img class="avatar" src="${avatar(a.id)}" alt=""><div style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="tk">${esc(a.current_task || a.speech || a.role)}</div></div>${chip(a.status)}</button>`).join('')}</div>
        <h3>Town news</h3>${logRows(S.events)}`;
      return;
    }
    const b = Town.BUILDINGS[view];
    const a = agentById(b.agent);
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h2>${esc(b.label)}</h2><button class="btn small" data-act="view" data-view="home">Back to board</button></div>
      ${agentCard(a)}<div class="stack" id="bdetail"><p class="muted light">Loading…</p></div>
      <h3>${esc(a.name)}'s log</h3>${logRows(S.events.filter((e) => e.agent_id === a.id), 15)}`;
    try { $('#bdetail').innerHTML = await builders[view](); lazyImages($('#bdetail')); }
    catch (e) { $('#bdetail').innerHTML = `<p class="err">Could not load: ${esc(e.message)}</p>`; }
  }

  function refreshAgentCard() {
    if (view === 'home') return renderBoard();
    const card = $('#board .card'); const a = agentById(Town.BUILDINGS[view].agent);
    if (card) card.outerHTML = agentCard(a);
  }

  // ---------------------------------------------------------------- INBOX
  function approvalCard(a) {
    const p = a.payload || {};
    const editable = a.status === 'pending' || a.status === 'held';
    const res = a.result?.note || a.result?.waiting || a.result?.error;
    let body = '';
    if (a.kind === 'email') {
      body = `<div class="appr-grid"><div class="stack">
          <label>To<input data-f="to" value="${esc(p.to)}" placeholder="owner@business.com" ${editable ? '' : 'disabled'}></label>
          ${p.phone ? `<div class="muted">Phone: ${esc(p.phone)}</div>` : ''}
          <label>Subject<input data-f="subject" value="${esc(p.subject)}" ${editable ? '' : 'disabled'}></label>
          <label>Message<textarea data-f="body" ${editable ? '' : 'disabled'}>${esc(p.body)}</textarea></label></div>
        <div>${a.preview ? (a.preview.startsWith('data:') ? `<img class="thumb" alt="Before and after attachment" src="${a.preview}">` : `<img class="thumb" alt="Before and after attachment" data-path="${esc(a.preview)}">`) : ''}<div class="muted" style="margin-top:4px">Attached to the email</div></div></div>`;
    } else if (a.kind === 'social_post') {
      body = `<label>${esc(p.platform)} post${p.best_time ? ` · best time ${esc(p.best_time)}` : ''}<textarea data-f="text" ${editable ? '' : 'disabled'}>${esc(p.text)}</textarea></label>${p.image_idea ? `<div class="muted">Image idea: ${esc(p.image_idea)}</div>` : ''}`;
    } else if (a.kind === 'product') {
      body = `<div class="row"><label>Title<input data-f="title" value="${esc(p.title)}" ${editable ? '' : 'disabled'}></label><label style="flex:0 0 110px">Price ($)<input data-f="price_usd" type="number" value="${esc(p.price_usd)}" ${editable ? '' : 'disabled'}></label></div>
        <div class="muted">${esc(p.short_description || '')}</div>${p.platform_suggestion ? `<div class="muted">Suggested platform: ${esc(p.platform_suggestion)}</div>` : ''}`;
    } else body = `<div class="pre">${esc(JSON.stringify(p, null, 2))}</div>`;

    const actions = editable
      ? `<div class="row"><button class="btn go" data-act="approve" data-id="${a.id}">Approve</button><button class="btn" data-act="reject" data-id="${a.id}">Reject</button></div>`
      : (a.kind === 'social_post' && a.status === 'executed' ? `<button class="btn small" data-act="copy" data-text="${esc(p.text)}">Copy post</button>` : '');
    return `<div class="card appr" data-appr="${a.id}">
      <div class="item-head"><b>${esc(a.title)}</b>${chip(a.status === 'executed' ? 'done' : a.status)}</div>
      <div class="muted">From ${esc(agentById(a.agent_id).name)} · ${ago(a.created_at)}</div>
      ${body}${res ? `<div class="note">${esc(res)}</div>` : ''}${actions}</div>`;
  }

  function renderInbox() {
    const m = $('#inbox'); if (m.hidden) return;
    const groups = {
      pending: S.approvals.filter((a) => a.status === 'pending'),
      progress: S.approvals.filter((a) => ['approved', 'held', 'failed'].includes(a.status)),
      done: S.approvals.filter((a) => ['executed', 'rejected'].includes(a.status)).slice(0, 30),
    };
    const names = { pending: 'Needs you', progress: 'In progress', done: 'Done' };
    $('#inbox-tabs').innerHTML = Object.keys(groups).map((k) => `<button class="btn small" data-act="tab" data-tab="${k}" aria-pressed="${k === inboxTab}">${names[k]} (${groups[k].length})</button>`).join('');
    const list = groups[inboxTab];
    $('#inbox-list').innerHTML = list.length ? list.map(approvalCard).join('') : `<p class="muted light">${inboxTab === 'pending' ? 'All caught up. New drafts show up here.' : 'Nothing here.'}</p>`;
    lazyImages($('#inbox-list'));
  }

  function collect(id) {
    const a = S.approvals.find((x) => x.id === id);
    const payload = { ...a.payload };
    for (const f of document.querySelectorAll(`[data-appr="${id}"] [data-f]`)) payload[f.dataset.f] = f.type === 'number' ? Number(f.value) : f.value;
    return payload;
  }

  // ---------------------------------------------------------------- ACTIONS
  async function act(e) {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const d = t.dataset;
    try {
      if (d.act === 'view') { view = d.view; renderBoard(); $('#board').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      if (d.act === 'inbox') openInbox();
      if (d.act === 'tab') { inboxTab = d.tab; renderInbox(); }
      if (d.act === 'approve') { await store.decide(Number(d.id), 'approved', collect(Number(d.id))); toast('Approved'); }
      if (d.act === 'reject') { await store.decide(Number(d.id), 'rejected'); toast('Rejected'); }
      if (d.act === 'enqueue') { await store.enqueue(d.agent, d.kind, d.prospect ? { prospect_id: Number(d.prospect) } : {}); toast('Task sent'); }
      if (d.act === 'stage') { await store.setProspectStage(Number(d.id), d.stage); toast('Updated'); }
      if (d.act === 'copy') { try { await navigator.clipboard.writeText(d.text); toast('Copied'); } catch { toast('Select the text and copy it'); } }
      if (d.act === 'open-html') { const html = await store.fileText(d.path); const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(url, '_blank'); }
    } catch (err) { toast(err.message); }
  }

  async function submit(e) {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const v = (id) => $('#' + id, f)?.value?.trim();
    try {
      switch (f.dataset.form) {
        case 'revenue': await store.addRevenue(Number(v('rev-amount')), v('rev-source'), ''); toast('Payment logged'); f.reset(); break;
        case 'settings': await store.saveSettings({
          weekly_goal: Number(v('s-goal')), daily_budget_usd: Number(v('s-budget')), daily_email_cap: Number(v('s-emails')), daily_prospect_cap: Number(v('s-prospects')),
          outreach_city: v('s-city'), outreach_categories: v('s-cats').split(',').map((x) => x.trim()).filter(Boolean),
          outreach_offer: v('s-offer'), business_focus: v('s-focus'), manager_notes: v('s-notes') }); toast('Rules saved'); break;
        case 'research': await store.enqueue('research', 'research', { topic: v('r-topic') }); toast('Sent to the Library'); f.reset(); break;
        case 'scout': await store.enqueue('scout', 'find_prospects', { category: v('sc-other') || v('sc-cat'), limit: 15 }); toast('Scout is heading out'); f.reset(); break;
        case 'product': await store.enqueue('merchant', 'create_product', { idea: v('pr-idea') }); toast('Mo is on it'); f.reset(); break;
        case 'campaign': await store.enqueue('marketer', 'plan_campaign', { focus: v('cp-focus') }); toast('Ben is on it'); f.reset(); break;
        case 'posts': await store.enqueue('social', 'write_posts', { theme: v('po-theme'), count: 3 }); toast('Cleo is on it'); f.reset(); break;
        case 'suppress': await store.suppress(v('sup-email')); toast('Added to do-not-contact list'); f.reset(); break;
      }
    } catch (err) { toast(err.message); }
  }

  function openInbox() { $('#inbox').hidden = false; inboxTab = 'pending'; renderInbox(); }

  // ---------------------------------------------------------------- BOOT
  async function start(theStore) {
    store = theStore; S = store.state;
    $('#login').hidden = true; $('#app').hidden = false;
    if (S.demo) $('#demo-banner').hidden = false;
    Town.mount($('#town'), $('#overlay'), (hit) => { view = hit.building || Town.buildingOf(hit.agent); renderBoard(); if (window.innerWidth < 980) $('#board').scrollIntoView({ behavior: 'smooth' }); });

    await store.init((what) => {
      if (what === 'agents') { Town.setAgents(S.agents); refreshAgentCard(); renderHUD(); }
      else if (what === 'events') { if (view === 'home') renderBoard(); }
      else if (what === 'approvals') { renderHUD(); renderInbox(); }
      else if (what === 'settings' || what === 'revenue' || what === 'usage') renderHUD();
      else if (what === 'prospects' && ['lodge', 'inspector', 'workshop', 'post_office'].includes(view)) renderBoard();
    }, (ev) => Town.speak(ev.agent_id, ev.message, ev.level));

    Town.setAgents(S.agents);
    for (const a of S.agents) if (a.speech && a.last_seen && Date.now() - new Date(a.last_seen) < 10 * 60000) Town.speak(a.id, a.speech, 'info', 6);
    renderHUD(); renderBoard();

    document.addEventListener('click', act);
    document.addEventListener('submit', submit);
    $('#inbox-btn').onclick = openInbox;
    $('#inbox-close').onclick = () => { $('#inbox').hidden = true; };
    $('#inbox').addEventListener('click', (e) => { if (e.target.id === 'inbox') e.target.hidden = true; });
    $('#pause-btn').onclick = async () => { await store.saveSettings({ paused: !S.settings.paused }); toast(S.settings.paused ? 'Town paused' : 'Town resumed'); renderHUD(); };
    $('#signout').onclick = () => store.signOut();
    if (S.demo) $('#signout').hidden = true;
  }

  async function boot() {
    const cfg = window.TOWN_CONFIG || {};
    const wantDemo = /[?&]demo\b/.test(location.search) || location.hash === '#demo' || !cfg.supabaseUrl || !window.supabase;
    if (wantDemo) return start(Stores.DemoStore());

    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const { data } = await sb.auth.getSession();
    if (data.session) return start(Stores.LiveStore(sb));
    $('#login').hidden = false;
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault(); $('#login-err').textContent = '';
      const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value, password: $('#login-pass').value });
      if (error) { $('#login-err').textContent = error.message; return; }
      start(Stores.LiveStore(sb));
    };
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
