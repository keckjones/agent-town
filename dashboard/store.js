// Data layer. Two versions with the same methods:
//  - LiveStore: your real Supabase data, with live updates
//  - DemoStore: made-up sample data with simulated agents (for previewing the town)
(function () {
  const weekStart = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d; };
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  // ---------------------------------------------------------------- LIVE
  function LiveStore(sb) {
    const state = { agents: [], events: [], approvals: [], prospects: [], revenue: [], settings: {}, spentToday: 0, demo: false };
    let notify = () => {}, onEvent = () => {};
    const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

    const loaders = {
      agents: async () => { state.agents = must(await sb.from('agents').select('*').order('id')); },
      events: async () => { state.events = must(await sb.from('events').select('*').order('created_at', { ascending: false }).limit(80)); },
      approvals: async () => { state.approvals = must(await sb.from('approvals').select('*').order('created_at', { ascending: false }).limit(150)); },
      prospects: async () => { state.prospects = must(await sb.from('prospects').select('id,name,category,address,phone,website,email,rating,review_count,stage,site_score,opportunity,audit,old_screenshot,new_screenshot,new_html,comparison,updated_at').order('updated_at', { ascending: false }).limit(300)); },
      revenue: async () => { state.revenue = must(await sb.from('revenue').select('*').gte('received_at', weekStart().toISOString().slice(0, 10)).order('received_at', { ascending: false })); },
      settings: async () => { state.settings = must(await sb.from('settings').select('*').eq('id', 1).single()); },
      usage: async () => { const rows = must(await sb.from('usage').select('cost_usd').gte('created_at', today0().toISOString())); state.spentToday = rows.reduce((s, r) => s + Number(r.cost_usd), 0); },
    };
    const timers = {};
    const reload = (t) => { clearTimeout(timers[t]); timers[t] = setTimeout(async () => { try { await loaders[t](); notify(t); } catch (e) { console.error(e); } }, 400); };

    return {
      state,
      async init(onChange, onNewEvent) {
        notify = onChange; onEvent = onNewEvent;
        await Promise.all(Object.values(loaders).map((f) => f()));
        sb.channel('town')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, (p) => {
            const i = state.agents.findIndex((a) => a.id === p.new.id);
            if (i >= 0) state.agents[i] = p.new; else state.agents.push(p.new);
            notify('agents');
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => {
            state.events.unshift(p.new); state.events.length = Math.min(state.events.length, 120);
            onEvent(p.new); notify('events');
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals' }, () => reload('approvals'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'prospects' }, () => reload('prospects'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'revenue' }, () => reload('revenue'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => reload('settings'))
          .subscribe();
        setInterval(() => reload('usage'), 60000);
        setInterval(() => reload('agents'), 120000);
      },
      async updateApproval(id, fields) { must(await sb.from('approvals').update(fields).eq('id', id)); reload('approvals'); },
      async decide(id, status, payload) {
        const fields = { status, decided_at: new Date().toISOString() };
        if (payload) fields.payload = payload;
        must(await sb.from('approvals').update(fields).eq('id', id)); reload('approvals');
      },
      async enqueue(agent_id, kind, input = {}) { must(await sb.from('tasks').insert({ agent_id, kind, input, priority: 2, created_by: 'owner' })); },
      async saveSettings(patch) { must(await sb.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)); reload('settings'); },
      async addRevenue(amount, source, note) { must(await sb.from('revenue').insert({ amount, source, note })); reload('revenue'); },
      async suppress(email) { must(await sb.from('suppression').upsert({ email: email.toLowerCase(), reason: 'opted out' })); },
      async setProspectStage(id, stage) { must(await sb.from('prospects').update({ stage, updated_at: new Date().toISOString() }).eq('id', id)); reload('prospects'); },
      async docs(kind, limit = 20) { return must(await sb.from('documents').select('*').eq('kind', kind).order('created_at', { ascending: false }).limit(limit)); },
      async fileUrl(path) { if (!path) return null; const { data } = await sb.storage.from('town-files').createSignedUrl(path, 3600); return data?.signedUrl || null; },
      async fileText(path) { const { data } = await sb.storage.from('town-files').download(path); return data ? data.text() : ''; },
      async signOut() { await sb.auth.signOut(); location.reload(); },
    };
  }

  // ---------------------------------------------------------------- DEMO
  function DemoStore() {
    const now = Date.now();
    const ago = (m) => new Date(now - m * 60000).toISOString();
    const agents = [
      ['manager', 'Mayor Mae', 'town_hall', 'Sets goals, assigns tasks, reviews progress', 140],
      ['research', 'Librarian Lou', 'library', 'Market research and opportunity reports', 90],
      ['scout', 'Scout Sam', 'lodge', 'Finds local businesses to pitch', 210],
      ['inspector', 'Inspector Ida', 'inspector', 'Audits and scores business websites', 180],
      ['designer', 'Builder Bea', 'workshop', 'Designs new landing pages', 120],
      ['postmaster', 'Postmaster Pete', 'post_office', 'Drafts and sends outreach emails', 100],
      ['merchant', 'Merchant Mo', 'store', 'Creates product listings', 40],
      ['marketer', 'Barker Ben', 'billboard', 'Plans marketing campaigns', 30],
      ['social', 'Crier Cleo', 'square', 'Writes social media posts', 60],
    ].map(([id, name, building, role, xp]) => ({ id, name, building, role, xp, tasks_done: xp / 10, status: 'idle', current_task: null, speech: null, last_seen: ago(0) }));

    const svg = (label, bg, fg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="380"><rect width="560" height="380" fill="#f4f1ea"/>` +
      `<rect x="70" y="40" width="170" height="320" rx="22" fill="#1d1d1f"/><rect x="80" y="52" width="150" height="296" rx="12" fill="#d8d4cc"/><rect x="92" y="70" width="126" height="18" fill="#9a9a9a"/><rect x="92" y="98" width="90" height="8" fill="#b5b5b5"/><rect x="92" y="114" width="110" height="8" fill="#b5b5b5"/><text x="155" y="30" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#666">Today</text>` +
      `<rect x="320" y="40" width="170" height="320" rx="22" fill="#1d1d1f"/><rect x="330" y="52" width="150" height="296" rx="12" fill="${bg}"/><rect x="342" y="80" width="126" height="26" rx="4" fill="${fg}"/><rect x="342" y="120" width="100" height="10" rx="3" fill="#ffffff" opacity=".85"/><rect x="342" y="138" width="80" height="10" rx="3" fill="#ffffff" opacity=".6"/><rect x="342" y="290" width="126" height="34" rx="17" fill="#ffffff"/><text x="405" y="30" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#1f8a5b">New design</text>` +
      `<text x="280" y="372" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#888">${label} (sample)</text></svg>`);

    const prospects = [
      { id: 1, name: 'Sample: Brazos Lane Bakery', category: 'Bakery', stage: 'drafted', site_score: 34, opportunity: 82, rating: 4.8, review_count: 212, email: 'hello@sample-bakery.test', website: 'http://sample-bakery.test', comparison: svg('Brazos Lane Bakery', '#7a3e2b', '#f3c64f'), audit: { findings: ['Not built for phones: no mobile viewport.', 'No tap-to-call phone button on mobile.', 'Footer says © 2017, so the site looks unmaintained.'] } },
      { id: 2, name: 'Sample: Northgate Auto Care', category: 'Auto repair', stage: 'designed', site_score: 41, opportunity: 74, rating: 4.6, review_count: 98, email: null, phone: '(979) 555-0142', website: 'http://sample-auto.test', comparison: svg('Northgate Auto Care', '#1f3346', '#e2604b'), audit: { findings: ['Google rates its mobile speed 23/100.', 'No secure connection (no HTTPS).'] } },
      { id: 3, name: 'Sample: Wellborn Road Salon', category: 'Hair salon', stage: 'audited', site_score: 52, opportunity: 61, rating: 4.9, review_count: 77, website: 'http://sample-salon.test', audit: { findings: ['Page is wider than a phone screen.', 'No search description.'] } },
      { id: 4, name: 'Sample: Aggieland Plumbing Co', category: 'Plumber', stage: 'audited', site_score: 0, opportunity: 88, rating: 4.7, review_count: 140, website: null, audit: { no_website: true, findings: ['No website listed on Google.'] } },
      { id: 5, name: 'Sample: Southwest Pkwy Dental', category: 'Dentist', stage: 'skipped', site_score: 86, opportunity: 21, rating: 4.5, review_count: 60, website: 'http://sample-dental.test', audit: { findings: [] } },
      { id: 6, name: 'Sample: Harvey Mitchell Landscaping', category: 'Landscaping', stage: 'contacted', site_score: 38, opportunity: 70, rating: 4.4, review_count: 35, email: 'info@sample-landscape.test', website: 'http://sample-landscape.test', audit: { findings: ['Took 8.2 seconds to load.'] } },
      { id: 7, name: 'Sample: University Dr Tacos', category: 'Restaurant', stage: 'client', site_score: 30, opportunity: 80, rating: 4.6, review_count: 410, email: 'owner@sample-tacos.test', website: 'http://sample-tacos.test', audit: { findings: ['Menu is a blurry photo.'] } },
    ].map((p) => ({ address: 'College Station, TX', updated_at: ago(30), ...p }));

    const footer = '\n--\nYour Name | Your Studio\n(979) 555-0100 | yourstudio.com\nPO Box 0000, College Station, TX 77840\nNot interested? Just reply "unsubscribe" and I won\'t email you again.';
    const approvals = [
      { id: 101, agent_id: 'postmaster', kind: 'email', status: 'pending', prospect_id: 1, title: 'Email to Sample: Brazos Lane Bakery', preview: prospects[0].comparison, created_at: ago(12),
        payload: { to: 'hello@sample-bakery.test', subject: 'A phone-friendly site for Brazos Lane', body: "Hi there,\n\nI'm a web designer here in College Station. I pulled up your site on my phone and noticed it shows as a tiny desktop page, with no button to tap and call you. Your 4.8 stars deserve better than that.\n\nI went ahead and mocked up a new homepage so you can see the difference (before and after attached). I'm offering local businesses a low introductory rate on a new site, and I'm happy to talk through the price.\n\nWould a quick 10-minute call this week work?" + footer } },
      { id: 102, agent_id: 'postmaster', kind: 'email', status: 'pending', prospect_id: 2, title: 'Email to Sample: Northgate Auto Care (no email found; add one or call (979) 555-0142)', preview: prospects[1].comparison, created_at: ago(40),
        payload: { to: '', phone: '(979) 555-0142', subject: 'Faster site for Northgate Auto Care', body: "Hi there,\n\nI'm a local web designer. Google scores your site's mobile speed at 23 out of 100, and browsers flag it as not secure, which can scare off new customers.\n\nI built a quick concept of a new homepage (attached). I'm offering a low local rate to start, and the exact price is open for discussion.\n\nOpen to a short call?" + footer } },
      { id: 103, agent_id: 'social', kind: 'social_post', status: 'pending', title: 'Facebook post', created_at: ago(55),
        payload: { platform: 'Facebook', text: 'Quick test for College Station business owners: pull up your website on your phone right now. Can a customer find your hours and call you with one tap? If not, I can help. Message me for a free mockup.', image_idea: 'Split-screen phone photo: old site vs. new site', best_time: 'Tue 11am' } },
      { id: 104, agent_id: 'merchant', kind: 'product', status: 'pending', title: 'New listing: Small Business Website Checklist ($9)', created_at: ago(90),
        payload: { title: 'Small Business Website Checklist', price_usd: 9, short_description: 'A 25-point checklist to make your site work on phones and show up on Google.', description: '<p>Everything a local business site needs, in plain English.</p>', tags: ['small business', 'website', 'checklist'], platform_suggestion: 'Gumroad' } },
    ];

    const events = [
      ['manager', 'Focus today: finish 5 bakery and salon mockups, then send letters.', 'success', 5],
      ['postmaster', 'Letter to Sample: Brazos Lane Bakery is waiting for your stamp in the approval inbox.', 'success', 12],
      ['designer', 'New homepage for Sample: Brazos Lane Bakery is on the easel.', 'success', 18],
      ['inspector', 'Sample: Southwest Pkwy Dental: site is in decent shape (86/100). Skipping.', 'info', 25],
      ['scout', 'Back from the field: 9 new bakery prospects (20 checked).', 'success', 33],
      ['research', 'New report shelved in the Library: "Local website pricing in College Station"', 'success', 60],
    ].map(([agent_id, message, level, m], i) => ({ id: i + 1, agent_id, message, level, created_at: ago(m) }));

    const state = {
      demo: true, agents, events, approvals, prospects,
      revenue: [{ id: 1, amount: 450, source: 'Web client', note: 'Sample: University Dr Tacos site build', received_at: new Date().toISOString().slice(0, 10) }, { id: 2, amount: 100, source: 'Web client', note: 'Sample: monthly care plan', received_at: new Date().toISOString().slice(0, 10) }],
      settings: { paused: false, weekly_goal: 2000, daily_budget_usd: 5, daily_email_cap: 15, daily_prospect_cap: 40, outreach_city: 'College Station, TX', outreach_categories: ['restaurant', 'hair salon', 'plumber', 'auto repair', 'dentist', 'landscaping', 'HVAC', 'bakery'], outreach_offer: 'A new mobile-friendly site at a low local introductory rate, with the exact price to be discussed on a quick call.', business_focus: 'Local website redesign service for small businesses, plus simple digital products.', manager_notes: '' },
      spentToday: 1.84,
    };

    const docs = {
      manager_plan: [{ id: 1, title: 'Town meeting (sample)', created_at: ago(5), body: '**Focus:** Finish 5 bakery and salon mockups, then send letters.\n\nThe pipeline has 2 drafts waiting for you and 3 sites audited. Revenue this week is $550 of $2,000.\n\n**Needs you:**\n- Approve the Brazos Lane Bakery email\n- Find an email for Northgate Auto Care, or call them\n\n**Assigned:**\n- scout: find_prospects (hair salons)\n- research: pricing for monthly care plans' }],
      research_report: [{ id: 2, title: 'Local website pricing in College Station (sample)', created_at: ago(60), body: '## Summary\nThis is sample text. Your real reports appear here once the worker is running.\n\n## Recommended next steps\n- Offer a simple 1-page site plus a monthly care plan\n- Lead with mobile speed and tap-to-call\n\n## Sources\n- (real reports list the links they used)' }],
      campaign: [{ id: 3, title: 'Phone check challenge (sample)', created_at: ago(120), body: '# Phone check challenge\n**Goal:** 10 replies from local owners\n## Channels\n- **Local Facebook groups**: post the phone test (2x per week)' }],
      product: [{ id: 4, title: 'Small Business Website Checklist (sample)', created_at: ago(90), body: '<p>A 25-point checklist.</p>' }],
      social_post: [],
    };

    let notify = () => {}, onEvent = () => {}, nextId = 1000;
    const script = [
      ['scout', 'Scouting for businesses', 'Heading out to find hair salon businesses in College Station, TX...', 'Back from the field: 7 new hair salon prospects (20 checked).'],
      ['inspector', 'Inspecting a website', 'Inspecting sample-salon.test...', 'Sample: Wellborn Road Salon: site scored 52/100. 4 problems found. Sending to the Workshop.'],
      ['designer', 'Designing a homepage', 'Sketching a new homepage for Sample: Wellborn Road Salon...', 'New homepage for Sample: Wellborn Road Salon is on the easel. Passing it to the Post Office.'],
      ['postmaster', 'Writing a letter', 'Writing a note to Sample: Wellborn Road Salon...', 'Letter to Sample: Wellborn Road Salon is waiting for your stamp.'],
      ['research', 'Researching', 'Hitting the books on: monthly website care plan pricing', 'New report shelved in the Library.'],
      ['social', 'Writing posts', 'Hear ye! Drafting 3 posts about "the phone test"', '3 posts are waiting for your approval.'],
      ['marketer', 'Planning a campaign', 'Painting a new campaign on the billboard...', 'Campaign "Phone check challenge" is up.'],
      ['merchant', 'Drafting a product', 'Stocking the shelves: drafting a new product listing...', 'Listing "Google Business Profile Setup Guide" is waiting for your approval.'],
      ['manager', 'Holding a town meeting', 'Calling a town meeting to review progress...', 'Focus: salons and auto shops this afternoon (4 tasks assigned)'],
    ];
    function emit(agent_id, message, level = 'info') {
      const ev = { id: nextId++, agent_id, message, level, created_at: new Date().toISOString() };
      state.events.unshift(ev); state.events.length = Math.min(state.events.length, 80);
      onEvent(ev); notify('events');
    }
    function setA(id, f) { Object.assign(state.agents.find((a) => a.id === id), f); notify('agents'); }
    function simulate() {
      let i = 0;
      const go = () => {
        if (state.settings.paused) return setTimeout(go, 3000);
        const [id, label, start, end] = script[i++ % script.length];
        setA(id, { status: 'working', current_task: label });
        emit(id, start);
        setTimeout(() => {
          const a = state.agents.find((x) => x.id === id);
          setA(id, { status: 'idle', current_task: null, xp: a.xp + 10, tasks_done: a.tasks_done + 1 });
          emit(id, end, 'success');
          state.spentToday += 0.04; notify('usage');
        }, 9000 + Math.random() * 5000);
        setTimeout(go, 5000 + Math.random() * 3000);
      };
      setTimeout(go, 1200);
    }

    return {
      state,
      async init(onChange, onNewEvent) { notify = onChange; onEvent = onNewEvent; simulate(); },
      async updateApproval(id, fields) { Object.assign(state.approvals.find((a) => a.id === id), fields); notify('approvals'); },
      async decide(id, status, payload) {
        const a = state.approvals.find((x) => x.id === id);
        a.status = status; if (payload) a.payload = payload;
        notify('approvals');
        if (status === 'approved') setTimeout(() => {
          if (a.kind === 'email' && !a.payload.to) { a.status = 'held'; a.result = { note: 'No valid email address. Add one, or call them instead.' }; }
          else if (a.kind === 'email') { a.status = 'approved'; a.result = { waiting: 'Demo: in the real town this sends once your outreach mailbox is set up.' }; emit('postmaster', `Stamped and ready: letter to ${a.payload.to}`, 'success'); }
          else { a.status = 'executed'; a.result = { manual: true, note: 'Approved. Copy it from here and post it.' }; }
          notify('approvals');
        }, 1500);
      },
      async enqueue(agent_id, kind, input) {
        emit('manager', `Owner asked ${agent_id} to ${kind.replace('_', ' ')}${input?.topic ? `: ${input.topic}` : input?.category ? `: ${input.category}` : ''}. (Demo)`, 'info');
        setA(agent_id, { status: 'working', current_task: 'On it!' });
        setTimeout(() => setA(agent_id, { status: 'idle', current_task: null }), 8000);
      },
      async saveSettings(patch) { Object.assign(state.settings, patch); notify('settings'); },
      async addRevenue(amount, source, note) { state.revenue.unshift({ id: nextId++, amount, source, note, received_at: new Date().toISOString().slice(0, 10) }); notify('revenue'); emit('manager', `Ka-ching! $${amount} logged from ${source || 'a sale'}.`, 'success'); },
      async suppress() {},
      async setProspectStage(id, stage) { state.prospects.find((p) => p.id === id).stage = stage; notify('prospects'); },
      async docs(kind) { return docs[kind] || []; },
      async fileUrl(path) { return path && path.startsWith('data:') ? path : null; },
      async fileText() { return ''; },
      async signOut() {},
    };
  }

  window.Stores = { LiveStore, DemoStore };
})();
