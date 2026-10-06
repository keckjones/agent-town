// The pixel town. Draws buildings and walking agents on a small canvas that CSS scales up.
// Exposes window.Town = { mount, setAgents, speak, avatar }.
(function () {
  const W = 480, H = 270, ROAD = 156;

  // Buildings: rect, door (where its agent lives), colors, and a sign label.
  const B = {
    town_hall:   { x: 205, y: 40,  w: 70, h: 72, door: [240, 112], label: 'Town Hall',     agent: 'manager',    wall: '#d9c7a3', roof: '#8a3b2e', kind: 'hall' },
    library:     { x: 30,  y: 70,  w: 60, h: 50, door: [60, 120],  label: 'Library',       agent: 'research',   wall: '#b9a58a', roof: '#3d5a80', kind: 'columns' },
    inspector:   { x: 118, y: 86,  w: 52, h: 40, door: [144, 126], label: 'Inspector',     agent: 'inspector',  wall: '#c7b8a0', roof: '#4c4f5a', kind: 'house' },
    workshop:    { x: 300, y: 74,  w: 60, h: 48, door: [330, 122], label: 'Workshop',      agent: 'designer',   wall: '#a67b52', roof: '#5b3b26', kind: 'barn', chimney: true },
    post_office: { x: 390, y: 80,  w: 58, h: 44, door: [419, 124], label: 'Post Office',   agent: 'postmaster', wall: '#d4d0c4', roof: '#2f6a8f', kind: 'house' },
    lodge:       { x: 26,  y: 192, w: 58, h: 42, door: [55, 192],  label: "Scout's Lodge", agent: 'scout',      wall: '#7a4f30', roof: '#3b5d33', kind: 'cabin', doorTop: true },
    store:       { x: 300, y: 190, w: 64, h: 46, door: [332, 190], label: 'General Store', agent: 'merchant',   wall: '#e0b866', roof: '#a1442f', kind: 'store', doorTop: true },
    billboard:   { x: 392, y: 188, w: 66, h: 30, door: [425, 182], label: 'Billboard',     agent: 'marketer',   kind: 'billboard' },
    square:      { x: 205, y: 133, w: 70, h: 46, door: [222, 172], label: 'Town Square',   agent: 'social',     kind: 'plaza' },
  };

  // Where each agent goes when it's working.
  const JOBS = {
    manager:    () => [[250, 168], [240, 116]],
    research:   () => [[208, 140], [60, 124]],
    scout:      () => [[-12, ROAD], [55, 188]],
    inspector:  () => { const keys = ['library', 'workshop', 'post_office', 'store']; const b = B[keys[Math.floor(Math.random() * keys.length)]]; return [b.door, [144, 130]]; },
    designer:   () => [[372, 128], [330, 126]],
    postmaster: () => [[458, 144], [492, ROAD], [419, 128]],
    merchant:   () => [[376, 206], [332, 186]],
    marketer:   () => [[400, 182], [452, 182]],
    social:     () => [[300, ROAD], [222, 172], [170, ROAD]],
  };

  const LOOKS = {
    manager:    { hair: '#3b2b22', skin: '#f0c8a0', shirt: '#7b2d8b', pants: '#2b2b44', hat: '#1d1d1d' },
    research:   { hair: '#a0a0a0', skin: '#e8b98f', shirt: '#3d5a80', pants: '#4a3a2a' },
    scout:      { hair: '#c2722e', skin: '#f2c9a1', shirt: '#4f7a34', pants: '#5a4630', hat: '#7a5a2a' },
    inspector:  { hair: '#1e1e1e', skin: '#c98e64', shirt: '#55606e', pants: '#2c2c2c' },
    designer:   { hair: '#d9a441', skin: '#f1c7a0', shirt: '#d1683a', pants: '#3b4a6b' },
    postmaster: { hair: '#5a3a20', skin: '#8d5a3b', shirt: '#2f6a8f', pants: '#1f3346', hat: '#2f6a8f' },
    merchant:   { hair: '#2a1a10', skin: '#e2a878', shirt: '#b8433a', pants: '#3a2a1a' },
    marketer:   { hair: '#e6d36a', skin: '#f3cfa8', shirt: '#e2b23a', pants: '#40304a' },
    social:     { hair: '#7a2f2f', skin: '#d79c6f', shirt: '#2e8a77', pants: '#2b2b2b', hat: '#2e8a77' },
  };

  let canvas, ctx, overlay, onSelect, last = 0;
  const people = {};
  const signs = {};
  const trees = [[100, 30], [150, 40], [170, 20], [20, 20], [460, 30], [430, 50], [470, 70], [110, 250], [190, 250], [250, 248], [280, 260], [470, 250], [12, 140], [372, 40], [180, 60], [100, 140], [470, 120]];
  const flowers = Array.from({ length: 60 }, (_, i) => [((i * 97) % W), 6 + ((i * 53) % (H - 12)), i % 3]);

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function makePerson(agent) {
    const b = B[Object.keys(B).find((k) => B[k].agent === agent.id)] || B.square;
    return {
      id: agent.id, x: b.door[0] + rnd(-6, 6), y: b.door[1] + 4 + rnd(0, 4),
      home: b, path: [], wait: rnd(0.5, 3), step: 0, face: 1,
      status: agent.status || 'idle', task: agent.current_task, bubbleUntil: 0,
    };
  }

  function planPath(p, target) {
    const pts = [];
    if (Math.abs(p.y - ROAD) > 3) pts.push([p.x, ROAD]);
    if (Math.abs(target[1] - ROAD) > 3) pts.push([target[0], ROAD]);
    pts.push(target);
    return pts;
  }

  function think(p) {
    if (p.status === 'paused' || p.status === 'error') { p.path = []; p.wait = 1; return; }
    if (p.status === 'working') {
      const stops = JOBS[p.id]();
      p.path = [];
      let cur = { x: p.x, y: p.y };
      for (const s of stops) { p.path.push(...planPath(cur, s)); cur = { x: s[0], y: s[1] }; }
      p.wait = rnd(0.6, 1.5);
    } else {
      const [dx, dy] = p.home.door;
      const off = p.home.doorTop ? -8 : 8;
      p.path = [[dx + rnd(-16, 16), dy + off + rnd(-3, 3)]];
      p.wait = rnd(2, 6);
    }
  }

  function update(dt) {
    for (const p of Object.values(people)) {
      if (p.wait > 0) { p.wait -= dt; p.moving = false; continue; }
      if (!p.path.length) { think(p); continue; }
      const [tx, ty] = p.path[0];
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      const speed = p.status === 'working' ? 34 : 14;
      if (d < 1) { p.path.shift(); if (!p.path.length) p.wait = p.status === 'working' ? rnd(1, 2.5) : rnd(2, 6); continue; }
      const s = Math.min(d, speed * dt);
      p.x += (dx / d) * s; p.y += (dy / d) * s;
      if (Math.abs(dx) > 0.3) p.face = dx > 0 ? 1 : -1;
      p.step += dt * 8; p.moving = true;
    }
  }

  // ---------- drawing ----------
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

  function drawGround() {
    px(0, 0, W, H, '#5d9c48');
    for (let i = 0; i < 400; i++) { const x = (i * 37) % W, y = (i * 71) % H; px(x, y, 2, 1, i % 2 ? '#6aab52' : '#528c40'); }
    for (const [x, y, c] of flowers) px(x, y, 1, 1, ['#f6e27a', '#f29db0', '#ffffff'][c]);
    // pond
    ctx.fillStyle = '#3f86b5'; ctx.beginPath(); ctx.ellipse(160, 226, 34, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6cb3dd'; ctx.beginPath(); ctx.ellipse(152, 222, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    // roads
    px(0, ROAD - 6, W, 13, '#c9ab7a');
    px(0, ROAD - 6, W, 1, '#a88a5c'); px(0, ROAD + 6, W, 1, '#a88a5c');
    px(234, 112, 13, ROAD - 112, '#c9ab7a');
    for (const b of [B.library, B.inspector, B.workshop, B.post_office]) px(b.door[0] - 3, b.door[1], 7, ROAD - b.door[1] - 5, '#c9ab7a');
    for (const b of [B.lodge, B.store]) px(b.door[0] - 3, ROAD + 6, 7, b.door[1] - ROAD - 6, '#c9ab7a');
    // plaza
    px(205, 133, 70, 46, '#b8a68a');
    for (let x = 205; x < 275; x += 7) for (let y = 133; y < 179; y += 7) px(x, y, 6, 6, (x + y) % 14 ? '#c6b597' : '#bba98c');
    // fountain
    ctx.fillStyle = '#8c8c8c'; ctx.beginPath(); ctx.ellipse(250, 158, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5aa3d2'; ctx.beginPath(); ctx.ellipse(250, 157, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    px(249, 146, 3, 10, '#9a9a9a');
    const t = performance.now() / 300;
    px(250 + Math.sin(t) * 3, 144 + Math.cos(t) * 1, 1, 2, '#d8f0ff');
    // bulletin board on plaza
    px(206, 134, 10, 7, '#6b4a2e'); px(207, 135, 8, 4, '#efe4cb'); px(208, 141, 1, 4, '#4a3020'); px(213, 141, 1, 4, '#4a3020');
    // mailbox + easel + stall
    px(456, 136, 6, 6, '#2f6a8f'); px(458, 142, 2, 6, '#333');
    px(370, 116, 8, 9, '#f5f0e0'); px(369, 125, 1, 5, '#6b4a2e'); px(378, 125, 1, 5, '#6b4a2e'); px(371, 118, 3, 2, '#d1683a'); px(374, 121, 3, 2, '#5fd39c');
    px(368, 198, 16, 6, '#8b5a2b'); px(368, 194, 16, 3, '#d64a3a'); px(372, 196, 3, 2, '#f3c64f'); px(377, 196, 3, 2, '#7cc6f2');
  }

  function drawTree(x, y) {
    px(x - 1, y + 4, 3, 6, '#5a3b22');
    ctx.fillStyle = '#2f6b33'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f8a42'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawBuilding(id, b, lit, busy) {
    if (b.kind === 'plaza') return;
    const { x, y, w, h } = b;
    if (b.kind === 'billboard') {
      px(x + 8, y + 18, 3, 14, '#5a3b22'); px(x + w - 11, y + 18, 3, 14, '#5a3b22');
      px(x, y, w, 20, '#3a2a20'); px(x + 2, y + 2, w - 4, 16, busy ? '#f3c64f' : '#efe4cb');
      px(x + 6, y + 6, 24, 3, '#a1442f'); px(x + 6, y + 11, 36, 2, '#6b5641'); px(x + 46, y + 5, 12, 10, '#5fd39c');
      return;
    }
    // shadow
    px(x + 3, y + h, w, 3, 'rgba(0,0,0,.18)');
    const roofH = b.kind === 'hall' ? 22 : 16;
    // walls
    px(x, y + roofH, w, h - roofH, b.wall);
    if (b.kind === 'cabin') for (let yy = y + roofH + 2; yy < y + h; yy += 4) px(x, yy, w, 1, '#5e3b22');
    if (b.kind === 'columns') for (let xx = x + 4; xx < x + w - 2; xx += 10) px(xx, y + roofH, 3, h - roofH, '#d8cdb8');
    if (b.kind === 'barn') { px(x, y + roofH, w, 2, '#7b5534'); }
    // roof
    ctx.fillStyle = b.roof;
    ctx.beginPath(); ctx.moveTo(x - 4, y + roofH); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w + 4, y + roofH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w + 4, y + roofH); ctx.lineTo(x + w / 2, y + roofH); ctx.closePath(); ctx.fill();
    if (b.kind === 'hall') {
      ctx.fillStyle = '#f5f0e0'; ctx.beginPath(); ctx.arc(x + w / 2, y + 13, 5, 0, Math.PI * 2); ctx.fill();
      const t = new Date(); const a = ((t.getHours() % 12) / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + w / 2, y + 13); ctx.lineTo(x + w / 2 + Math.cos(a) * 3, y + 13 + Math.sin(a) * 3); ctx.stroke();
      px(x + w / 2 - 1, y - 8, 1, 8, '#555'); px(x + w / 2, y - 8, 6, 4, '#f3c64f');
    }
    if (b.kind === 'store') { for (let xx = x; xx < x + w; xx += 8) px(xx, y + roofH, 4, 5, '#f5f0e0'); }
    // chimney + smoke
    if (b.chimney) {
      px(x + w - 16, y + 2, 6, 10, '#6b3f2a');
      if (busy) { const t = performance.now() / 600; for (let i = 0; i < 3; i++) { const k = (t + i / 3) % 1; ctx.fillStyle = `rgba(230,230,230,${0.6 * (1 - k)})`; ctx.beginPath(); ctx.arc(x + w - 13 + Math.sin(k * 6) * 2, y - k * 18, 2 + k * 3, 0, Math.PI * 2); ctx.fill(); } }
    }
    // windows
    const win = lit ? '#ffd970' : '#2b3a4a';
    const wy = y + roofH + 6;
    px(x + 6, wy, 8, 7, win); px(x + w - 14, wy, 8, 7, win);
    px(x + 6, wy + 3, 8, 1, '#3a2a20'); px(x + w - 14, wy + 3, 8, 1, '#3a2a20');
    if (lit) { ctx.fillStyle = 'rgba(255,217,112,.15)'; ctx.fillRect(x + 2, wy - 3, 16, 14); ctx.fillRect(x + w - 18, wy - 3, 16, 14); }
    // door
    if (b.doorTop) px(b.door[0] - 4, y + roofH + 2, 8, 9, '#4a2f1d');
    else px(b.door[0] - 4, y + h - 11, 8, 11, '#4a2f1d');
  }

  function drawPerson(p, now) {
    const L = LOOKS[p.id] || LOOKS.manager;
    const x = Math.round(p.x) - 3, y = Math.round(p.y) - 11;
    const leg = p.moving ? Math.floor(p.step) % 2 : 0;
    px(x, y + 11, 7, 1, 'rgba(0,0,0,.25)');
    // legs
    px(x + 1, y + 8, 2, 3 - leg, L.pants); px(x + 4, y + 8, 2, 2 + leg, L.pants);
    // body
    px(x, y + 5, 7, 4, L.shirt);
    px(x - 1, y + 5, 1, 3, L.skin); px(x + 7, y + 5, 1, 3, L.skin);
    // head
    px(x + 1, y + 1, 5, 4, L.skin);
    px(x + 1, y, 5, 2, L.hair);
    px(p.face > 0 ? x + 4 : x + 2, y + 2, 1, 1, '#1a1a1a');
    if (L.hat) { px(x, y - 1, 7, 1, L.hat); px(x + 1, y - 3, 5, 2, L.hat); }
    // status icon
    if (p.status === 'working') { const bob = Math.sin(now / 150) > 0 ? 0 : 1; px(x + 2, y - 8 + bob, 3, 3, '#5fd39c'); px(x + 3, y - 9 + bob, 1, 5, '#5fd39c'); px(x + 1, y - 7 + bob, 5, 1, '#5fd39c'); }
    if (p.status === 'error') { px(x + 3, y - 9, 1, 4, '#e2604b'); px(x + 3, y - 4, 1, 1, '#e2604b'); }
    if (p.status === 'waiting') { px(x + 2, y - 8, 3, 3, '#f3c64f'); }
    if (p.status === 'paused') { ctx.fillStyle = '#ddd'; ctx.font = '6px monospace'; ctx.fillText('z', x + 6, y - 2 - (Math.floor(now / 500) % 2)); }
  }

  function nightAlpha() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h >= 7 && h <= 18) return 0;
    if (h > 18 && h < 21) return ((h - 18) / 3) * 0.45;
    if (h >= 5 && h < 7) return ((7 - h) / 2) * 0.45;
    return 0.45;
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    update(dt);
    const night = nightAlpha();
    drawGround();
    for (const [x, y] of trees.filter(([, y]) => y < 120)) drawTree(x, y);
    const busyIn = {};
    for (const p of Object.values(people)) if (p.status === 'working') busyIn[p.home === B.square ? 'square' : Object.keys(B).find((k) => B[k] === p.home)] = true;
    // draw back-to-front by y so people walk behind/in front correctly
    const items = [
      ...Object.entries(B).map(([id, b]) => ({ y: b.y + b.h, draw: () => drawBuilding(id, b, night > 0.1 || busyIn[id], busyIn[id]) })),
      ...Object.values(people).map((p) => ({ y: p.y, draw: () => drawPerson(p, t) })),
      ...trees.filter(([, y]) => y >= 120).map(([x, y]) => ({ y: y + 10, draw: () => drawTree(x, y) })),
    ].sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    if (night) { ctx.fillStyle = `rgba(18,24,70,${night})`; ctx.fillRect(0, 0, W, H); }
    // glowing windows on top of the night tint
    if (night > 0.1) for (const b of Object.values(B)) if (b.wall) { ctx.fillStyle = 'rgba(255,217,112,.55)'; const wy = b.y + (b.kind === 'hall' ? 22 : 16) + 6; ctx.fillRect(b.x + 6, wy, 8, 7); ctx.fillRect(b.x + b.w - 14, wy, 8, 7); }
    placeOverlay(t);
    requestAnimationFrame(frame);
  }

  // ---------- DOM overlay (signs + speech bubbles, crisp text) ----------
  function pct(x, y) { return `left:${(x / W) * 100}%;top:${(y / H) * 100}%`; }

  function buildSigns() {
    for (const [id, b] of Object.entries(B)) {
      const s = document.createElement('div');
      s.className = 'sign'; s.textContent = b.label;
      let sx = b.x + b.w / 2, sy;
      if (b.kind === 'plaza') { sx = b.x + 50; sy = b.y + b.h + 2; }
      else if (b.kind === 'billboard') sy = b.y + 33;
      else if (b.doorTop) sy = b.y + b.h + 3;
      else sy = b.y - 14;
      s.style.cssText = pct(sx, sy);
      overlay.appendChild(s); signs[id] = s;
    }
  }

  function placeOverlay(now) {
    for (const p of Object.values(people)) {
      if (!p.el) continue;
      const show = now < p.bubbleUntil;
      p.el.style.opacity = show ? 1 : 0;
      if (show) p.el.style.cssText = `left:clamp(64px, ${(p.x / W) * 100}%, calc(100% - 64px));top:${((p.y - 15) / H) * 100}%;opacity:1`;
    }
  }

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    for (const p of Object.values(people)) if (Math.abs(p.x - x) < 6 && y > p.y - 14 && y < p.y + 2) return { agent: p.id };
    for (const [id, b] of Object.entries(B)) if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return { building: id };
    return null;
  }

  window.Town = {
    BUILDINGS: B,
    buildingOf(agentId) { return Object.keys(B).find((k) => B[k].agent === agentId); },
    mount(canvasEl, overlayEl, select) {
      canvas = canvasEl; overlay = overlayEl; onSelect = select;
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      buildSigns();
      canvas.addEventListener('click', (e) => { const h = hit(e); if (h) onSelect(h); });
      canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = hit(e) ? 'pointer' : 'default'; });
      requestAnimationFrame(frame);
    },
    setAgents(list) {
      for (const a of list) {
        let p = people[a.id];
        if (!p) {
          p = people[a.id] = makePerson(a);
          p.el = document.createElement('div'); p.el.className = 'bubble'; p.el.style.opacity = 0;
          overlay.appendChild(p.el);
        }
        if (p.status !== a.status) { p.status = a.status; p.path = []; p.wait = 0.2; }
        p.task = a.current_task;
      }
    },
    speak(agentId, text, level = 'info', seconds = 7) {
      const p = people[agentId]; if (!p) return;
      p.el.textContent = text.length > 90 ? text.slice(0, 88) + '…' : text;
      p.el.className = `bubble ${level}`;
      p.bubbleUntil = performance.now() + seconds * 1000;
    },
    avatar(agentId) {
      const c = document.createElement('canvas'); c.width = 10; c.height = 16;
      const saveCtx = ctx; ctx = c.getContext('2d');
      drawPerson({ id: agentId, x: 5, y: 15, face: 1, status: 'idle', moving: false, step: 0 }, 0);
      ctx = saveCtx;
      return c.toDataURL();
    },
  };
})();
