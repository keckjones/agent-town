// The 3D trading floor: desk clusters per department, seated agents, five display walls, and the elevated
// glass Executive Office for the Big Boss (the Executive Orchestrator). Purely a view: everything it shows comes
// from floor-model.js (derived from database rows); every control lives in the HTML panels.
// Quality: full | low (1x pixels, 30 fps, no idle motion, fewer lights). Reduced motion: no animation, instant camera.
import * as THREE from 'three';
import { DEPTS, STATUS } from './floor-model.js';

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

// ---------------------------------------------------------------- canvas drawing helpers
const FONT_D = '"Barlow Condensed", "Arial Narrow", sans-serif';
const FONT_M = '"IBM Plex Mono", ui-monospace, monospace';
function fit(g, text, maxW) { let t = String(text ?? ''); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function bg(g, W, H, accent) {
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#0c121c'); grd.addColorStop(1, '#05080d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120,160,220,0.06)'; g.lineWidth = 1;
  for (let y = 0; y < H; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = accent; g.fillRect(0, 0, W, Math.max(4, H * 0.025));
}
/** Big display wall: title, then label/value rows with a basis tag (ACTUAL / EST. / PIPELINE / N/A). */
export function drawWall(canvas, { title, accent, rows = [], foot = '' }) {
  const g = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  bg(g, W, H, accent);
  g.textBaseline = 'top';
  g.fillStyle = '#e6edf6'; g.font = `600 ${H * 0.11}px ${FONT_D}`; g.fillText(String(title).toUpperCase(), W * 0.03, H * 0.06);
  const rowH = Math.min(H * 0.125, (H * 0.74) / Math.max(1, rows.length));
  let y = H * 0.22;
  for (const [label, value, color, basis] of rows) {
    g.font = `500 ${rowH * 0.5}px ${FONT_M}`; g.fillStyle = '#8f9bb0'; g.fillText(fit(g, label, W * 0.55), W * 0.03, y + rowH * 0.18);
    if (basis) { g.font = `600 ${rowH * 0.32}px ${FONT_M}`; g.fillStyle = { ACTUAL: '#2fd38a', 'EST.': '#9b8cff', PIPELINE: '#9b8cff', 'N/A': '#566275' }[basis] || '#566275'; g.fillText(basis, W * 0.6, y + rowH * 0.3); }
    g.font = `600 ${rowH * 0.78}px ${FONT_D}`; g.fillStyle = color || '#e6edf6';
    const t = String(value); g.fillText(t, W * 0.97 - g.measureText(t).width, y);
    y += rowH;
  }
  if (foot) { g.font = `500 ${H * 0.04}px ${FONT_M}`; g.fillStyle = '#566275'; g.fillText(fit(g, foot, W * 0.94), W * 0.03, H * 0.93); }
}
function drawDeskScreen(canvas, d) {
  const g = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  const st = STATUS[d.status];
  bg(g, W, H, st.color);
  g.textBaseline = 'top';
  g.fillStyle = '#e6edf6'; g.font = `600 30px ${FONT_D}`; g.fillText(fit(g, d.name, W - 20), 10, 12);
  g.fillStyle = st.color; g.font = `600 22px ${FONT_M}`; g.fillText(fit(g, `${st.icon} ${st.label}`, W - 20), 10, 50);
  g.fillStyle = '#9aa6b8'; g.font = `500 19px ${FONT_M}`;
  const words = String(d.task || d.why?.[0] || '').split(' '); let line = '', y = 84;
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > W - 20) { g.fillText(line, 10, y); y += 22; line = w; if (y > H - 24) { line = ''; break; } } else line = t; }
  if (line && y <= H - 24) g.fillText(fit(g, line, W - 20), 10, y);
  if (d.status === 'paused') { g.fillStyle = 'rgba(5,8,13,0.55)'; g.fillRect(0, 0, W, H); }
}
function drawSign(canvas, dept, w) {
  const g = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  g.fillStyle = '#0a0f17'; g.fillRect(0, 0, W, H);
  g.fillStyle = dept.accent; g.fillRect(0, H - 8, W, 8);
  g.textBaseline = 'middle'; g.fillStyle = '#e6edf6'; g.font = `600 ${H * 0.42}px ${FONT_D}`;
  const t = dept.short.toUpperCase(); g.fillText(t, 18, H * 0.38);
  if (w) {
    g.font = `500 ${H * 0.2}px ${FONT_M}`;
    const parts = [[`▶${w.working}`, STATUS.working.color], [`!${w.needs}`, w.needs ? STATUS.needs_approval.color : '#566275'], [`✕${w.blocked}`, w.blocked ? STATUS.blocked.color : '#566275'], [`${w.paused ? 'PAUSED' : ''}`, STATUS.paused.color]];
    let x = 18;
    for (const [s, c] of parts) { if (!s) continue; g.fillStyle = c; g.fillText(s, x, H * 0.76); x += g.measureText(s).width + 18; }
  }
}

// ---------------------------------------------------------------- layout
// Departments on a 5 × 2 grid in front of the Executive Office. Businesses in the back row, support teams in front.
const GRID = { agency: [-26, -3], sports: [-13, -3], etsy: [13, -3], dropship: [26, -3], realestate: [0, -2],
  media: [-26, 11], ventures: [-13, 11], customers: [0, 11], finance: [13, 11], hq: [26, 11] };
const EXEC = { x: 0, z: -17, top: 1.6, w: 20, d: 10 };
const DESK_W = 1.6;
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const SKIN = ['#f1c7a5', '#d9a47c', '#b07a52', '#8a5a3b', '#5e3d29', '#e8b896'];
const HAIR = ['#1b1410', '#3b2a1e', '#6b4a2b', '#a0743f', '#d8c08a', '#2b2b2b', '#7a2e1d'];

export function createFloor({ canvas, labelsEl, on = {}, quality = 'full', reducedMotion = false, fixed = false }) {
  const low = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070a10');
  scene.fog = new THREE.Fog('#070a10', 55, 110);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);

  // ---------- shared materials / geometry ----------
  const mat = {
    floor: new THREE.MeshStandardMaterial({ color: '#141a24', metalness: 0.35, roughness: 0.5 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#1d2533', metalness: 0.05, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ color: '#0d121a', metalness: 0.3, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: '#2a3340', metalness: 0.85, roughness: 0.3 }),
    deskTop: new THREE.MeshStandardMaterial({ color: '#3a4352', metalness: 0.3, roughness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: '#3a2a1f', metalness: 0.15, roughness: 0.55 }),
    chair: new THREE.MeshStandardMaterial({ color: '#15191f', metalness: 0.2, roughness: 0.7 }),
    bezel: new THREE.MeshStandardMaterial({ color: '#090b0f', metalness: 0.6, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#cfe2ff', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    divider: new THREE.MeshStandardMaterial({ color: '#28303b', metalness: 0.2, roughness: 0.8, transparent: true, opacity: 0.85 }),
    paper: new THREE.MeshStandardMaterial({ color: '#e9edf2', roughness: 0.9, side: THREE.DoubleSide }),
    lightStrip: new THREE.MeshBasicMaterial({ color: '#cfe0ff' }),
  };
  const geo = {
    deskTop: new THREE.BoxGeometry(DESK_W - 0.08, 0.06, 0.8),
    leg: new THREE.BoxGeometry(0.05, 0.72, 0.7),
    monitor: new THREE.BoxGeometry(0.62, 0.38, 0.03),
    screen: new THREE.PlaneGeometry(0.58, 0.34),
    stand: new THREE.BoxGeometry(0.05, 0.2, 0.05),
    seat: new THREE.BoxGeometry(0.5, 0.08, 0.5),
    back: new THREE.BoxGeometry(0.5, 0.55, 0.06),
    post: new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8),
    torso: new THREE.CylinderGeometry(0.17, 0.22, 0.58, 12),
    head: new THREE.SphereGeometry(0.15, 16, 12),
    hair: new THREE.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    arm: new THREE.BoxGeometry(0.08, 0.08, 0.42),
    beacon: new THREE.SphereGeometry(0.07, 12, 8),
    strip: new THREE.BoxGeometry(DESK_W - 0.1, 0.03, 0.03),
    paper: new THREE.PlaneGeometry(0.26, 0.34),
    headset: new THREE.TorusGeometry(0.17, 0.018, 6, 20, Math.PI),
    mic: new THREE.BoxGeometry(0.02, 0.02, 0.16),
  };
  const statusMat = Object.fromEntries(Object.values(STATUS).map((s) => [s.key, new THREE.MeshBasicMaterial({ color: s.color })]));
  const textures = new Set();
  const screenMesh = (w, h, cw, ch) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; textures.add(tex);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    return { mesh: m, canvas: c, tex, key: '' };
  };

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight('#c4d2ff', '#1a1f2a', 0.9));
  scene.add(new THREE.AmbientLight('#9fb0d0', 0.35));
  const key = new THREE.DirectionalLight('#dfe8ff', 1.3); key.position.set(-15, 30, 20); scene.add(key);
  const fill = new THREE.DirectionalLight('#8fb0ff', 0.25); fill.position.set(20, 15, -10); scene.add(fill);

  // ---------- room ----------
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(84, 64), mat.floor); floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.z = -2; scene.add(floorMesh);
  const grid = new THREE.GridHelper(84, 42, '#152238', '#0f1826'); grid.position.set(0, 0.005, -2); grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  const back = new THREE.Mesh(new THREE.BoxGeometry(84, 16, 0.5), mat.wall); back.position.set(0, 8, -27); scene.add(back);
  for (const x of [-42, 42]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 16, 50), mat.wall); s.position.set(x, 8, -4); scene.add(s); }
  // Ceiling light strips (no ceiling mesh, so the elevated camera always sees in).

  // ---------- display walls ----------
  const walls = {};
  const wallDefs = [
    { id: 'performance', pos: [0, 10.6, -26.7], rot: 0, size: [22, 7.4] },
    { id: 'sales', pos: [-26, 7.5, -26.7], rot: 0, size: [17, 7.4] },
    { id: 'commerce', pos: [26, 7.5, -26.7], rot: 0, size: [17, 7.4] },
    { id: 'content', pos: [-41.7, 6.5, -6], rot: Math.PI / 2, size: [18, 7.4] },
    { id: 'attention', pos: [41.7, 6.5, -6], rot: -Math.PI / 2, size: [18, 7.4] },
  ];
  for (const w of wallDefs) {
    const s = screenMesh(w.size[0], w.size[1], 1280, Math.round((1280 * w.size[1]) / w.size[0]));
    s.mesh.position.set(...w.pos); s.mesh.rotation.y = w.rot; s.mesh.userData.pick = { type: 'wall', id: w.id }; scene.add(s.mesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w.size[0] + 0.5, w.size[1] + 0.5, 0.2), mat.bezel);
    frame.position.set(...w.pos); frame.rotation.y = w.rot; frame.translateZ(-0.12); scene.add(frame);
    walls[w.id] = { ...s, def: w };
  }

  // ---------- Executive Office (elevated glass) ----------
  const exec = new THREE.Group(); exec.position.set(EXEC.x, 0, EXEC.z); scene.add(exec);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(EXEC.w, EXEC.top, EXEC.d), mat.metal); plat.position.y = EXEC.top / 2; exec.add(plat);
  const platEdge = new THREE.Mesh(new THREE.BoxGeometry(EXEC.w + 0.1, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#f2c14e' })); platEdge.position.set(0, EXEC.top, EXEC.d / 2); exec.add(platEdge);
  for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(4, EXEC.top * (1 - i / 4), 0.6), mat.metal); st.position.set(0, (EXEC.top * (1 - i / 4)) / 2, EXEC.d / 2 + 0.3 + i * 0.6); exec.add(st); }
  const GH = 4.6;
  const pane = (w, x, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, GH), mat.glass); p.position.set(x, EXEC.top + GH / 2, z); p.rotation.y = ry; exec.add(p);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), mat.metal); rail.position.set(x, EXEC.top + GH, z); rail.rotation.y = ry; exec.add(rail); };
  pane(EXEC.w / 2 - 2.2, -(EXEC.w / 4 + 1.1), EXEC.d / 2, 0); pane(EXEC.w / 2 - 2.2, EXEC.w / 4 + 1.1, EXEC.d / 2, 0);
  pane(EXEC.d, -EXEC.w / 2, 0, Math.PI / 2); pane(EXEC.d, EXEC.w / 2, 0, Math.PI / 2);
  for (const [x, z] of [[-EXEC.w / 2, EXEC.d / 2], [EXEC.w / 2, EXEC.d / 2], [-EXEC.w / 2, -EXEC.d / 2], [EXEC.w / 2, -EXEC.d / 2], [-2.2, EXEC.d / 2], [2.2, EXEC.d / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, GH, 0.12), mat.metal); m.position.set(x, EXEC.top + GH / 2, z); exec.add(m);
  }
  const execBack = new THREE.Mesh(new THREE.BoxGeometry(EXEC.w, GH, 0.2), mat.wall); execBack.position.set(0, EXEC.top + GH / 2, -EXEC.d / 2); exec.add(execBack);
  const sign = screenMesh(4.2, 0.62, 840, 124); sign.mesh.position.set(0, EXEC.top + GH - 0.4, EXEC.d / 2 + 0.02); exec.add(sign.mesh);
  { const g = sign.canvas.getContext('2d'); g.fillStyle = '#0a0f17'; g.fillRect(0, 0, 840, 124); g.fillStyle = '#f2c14e'; g.fillRect(0, 116, 840, 8); g.font = `600 64px ${FONT_D}`; g.textBaseline = 'middle'; g.fillStyle = '#f5e6bf'; const t = 'EXECUTIVE OFFICE'; g.fillText(t, (840 - g.measureText(t).width) / 2, 58); }
  // Three screens on the office's back wall.
  const execScreens = {};
  [['perf', -6], ['depts', 0], ['approvals', 6]].forEach(([id, x]) => {
    const s = screenMesh(5.2, 2.9, 896, 500); s.mesh.position.set(x, EXEC.top + 2.6, -EXEC.d / 2 + 0.12); s.mesh.userData.pick = { type: 'exec', id }; exec.add(s.mesh); execScreens[id] = s;
  });
  // Meeting table + chairs (CEO agents sit here when promoted).
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.08, 40), mat.wood); table.position.set(-6, EXEC.top + 0.76, 1.2); exec.add(table);
  const tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.72, 12), mat.metal); tleg.position.set(-6, EXEC.top + 0.36, 1.2); exec.add(tleg);
  const execLight = new THREE.PointLight('#ffd98a', low ? 0.8 : 1.6, 16, 2); execLight.position.set(0, EXEC.top + 4, 0); exec.add(execLight);
  exec.traverse((o) => { if (o.isMesh && !o.userData.pick) o.userData.pick = { type: 'exec', id: 'office' }; });

  // ---------- desks ----------
  const desks = {};          // agentId -> desk object
  const clusters = {};       // deptId -> { group, sign, carpet, light, anchor }
  const deskRoot = new THREE.Group(); scene.add(deskRoot);

  function makeDesk(agent, deptAccent) {
    const g = new THREE.Group();
    // desk
    const top = new THREE.Mesh(geo.deskTop, mat.deskTop); top.position.set(0, 0.74, 0); g.add(top);
    for (const x of [-(DESK_W / 2 - 0.1), DESK_W / 2 - 0.1]) { const l = new THREE.Mesh(geo.leg, mat.metal); l.position.set(x, 0.36, 0); g.add(l); }
    const strip = new THREE.Mesh(geo.strip, statusMat.idle); strip.position.set(0, 0.73, -0.41); g.add(strip);
    // monitors (left one carries the status screen)
    const scr = screenMesh(0.58, 0.34, 256, 150);
    const mon = new THREE.Group(); mon.position.set(-0.32, 1.06, 0.25);
    const bez = new THREE.Mesh(geo.monitor, mat.bezel); mon.add(bez);
    scr.mesh.geometry.dispose(); scr.mesh.geometry = geo.screen; scr.mesh.position.z = -0.017; scr.mesh.rotation.y = Math.PI; mon.add(scr.mesh);
    const stand = new THREE.Mesh(geo.stand, mat.metal); stand.position.set(0, -0.26, 0.02); mon.add(stand);
    mon.rotation.y = 0.12; g.add(mon);
    const mon2 = new THREE.Group(); mon2.position.set(0.34, 1.06, 0.25);
    const bez2 = new THREE.Mesh(geo.monitor, mat.bezel); mon2.add(bez2);
    const scr2 = new THREE.Mesh(geo.screen, new THREE.MeshBasicMaterial({ color: '#0b1522', toneMapped: false })); scr2.position.z = -0.017; scr2.rotation.y = Math.PI; mon2.add(scr2);
    const stand2 = new THREE.Mesh(geo.stand, mat.metal); stand2.position.set(0, -0.26, 0.02); mon2.add(stand2);
    mon2.rotation.y = -0.12; g.add(mon2);
    const beacon = new THREE.Mesh(geo.beacon, statusMat.idle); beacon.position.set(0, 1.42, 0.25); g.add(beacon);
    // chair
    const chair = new THREE.Group(); chair.position.set(0, 0, -0.78);
    const seat = new THREE.Mesh(geo.seat, mat.chair); seat.position.y = 0.46; chair.add(seat);
    const backrest = new THREE.Mesh(geo.back, mat.chair); backrest.position.set(0, 0.8, -0.24); chair.add(backrest);
    const post = new THREE.Mesh(geo.post, mat.metal); post.position.y = 0.21; chair.add(post);
    g.add(chair);
    // person
    const h = hash(agent.id);
    const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(deptAccent).multiplyScalar(0.55).lerp(new THREE.Color('#2a3140'), 0.35), roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[h % SKIN.length], roughness: 0.7 });
    const hairM = new THREE.MeshStandardMaterial({ color: HAIR[(h >> 3) % HAIR.length], roughness: 0.9 });
    const person = new THREE.Group(); person.position.set(0, 0, -0.74);
    const torso = new THREE.Mesh(geo.torso, shirt); torso.position.y = 0.8; person.add(torso);
    const headG = new THREE.Group(); headG.position.y = 1.24; person.add(headG);
    const head = new THREE.Mesh(geo.head, skin); headG.add(head);
    const hair = new THREE.Mesh(geo.hair, hairM); hair.position.y = 0.012; hair.rotation.x = -0.25; headG.add(hair);
    const armL = new THREE.Mesh(geo.arm, shirt); armL.position.set(-0.2, 0.92, 0.2); armL.rotation.x = 0.55; person.add(armL);
    const armR = new THREE.Mesh(geo.arm, shirt); armR.position.set(0.2, 0.92, 0.2); armR.rotation.x = 0.55; person.add(armR);
    const paper = new THREE.Mesh(geo.paper, mat.paper); paper.position.set(0, 1.02, 0.36); paper.rotation.x = -1.0; paper.visible = false; person.add(paper);
    const headset = new THREE.Group(); headset.visible = false; headG.add(headset);
    const band = new THREE.Mesh(geo.headset, mat.bezel); band.rotation.z = 0; band.position.y = 0.02; headset.add(band);
    const mic = new THREE.Mesh(geo.mic, mat.bezel); mic.position.set(0.15, -0.08, 0.08); mic.rotation.y = -0.6; headset.add(mic);
    g.add(person);
    g.traverse((o) => { if (o.isMesh) o.userData.pick = { type: 'agent', id: agent.id }; });
    return { group: g, screen: scr, scr2, strip, beacon, person, torso, headG, armL, armR, paper, headset, shirt, state: null, phase: (h % 1000) / 160, anchor: new THREE.Vector3() };
  }

  function layout(agents) {
    // Rebuild only when the set of agents (or their department) changes.
    for (const c of Object.values(clusters)) { deskRoot.remove(c.group); }
    for (const k of Object.keys(clusters)) delete clusters[k];
    for (const k of Object.keys(desks)) delete desks[k];
    const byDept = {};
    for (const a of agents) (byDept[a.dept] ||= []).push(a);
    // Executive Office seats: Big Boss at the head desk facing the floor; CEO agents at the meeting table.
    const boss = (byDept.exec || []).find((a) => a.isBoss);
    const ceos = (byDept.exec || []).filter((a) => !a.isBoss);
    const execGroup = new THREE.Group(); deskRoot.add(execGroup);
    clusters.exec = { group: execGroup, anchor: new THREE.Vector3(EXEC.x, EXEC.top + 4.2, EXEC.z), dept: DEPTS[0] };
    if (boss) {
      const d = makeDesk(boss, '#f2c14e');
      d.group.position.set(EXEC.x + 1.5, EXEC.top, EXEC.z + 1.2); d.group.rotation.y = 0; d.group.scale.setScalar(1.15);
      execGroup.add(d.group); desks[boss.id] = d;
    }
    ceos.slice(0, 6).forEach((a, i) => {
      const ang = (i / 6) * Math.PI * 2;
      const d = makeDesk(a, '#f2c14e');
      d.group.position.set(EXEC.x - 6 + Math.sin(ang) * 2.4, EXEC.top, EXEC.z + 1.2 + Math.cos(ang) * 2.4); d.group.rotation.y = ang + Math.PI;
      d.group.children.slice(0, 6).forEach((m) => { m.visible = false; }); // no desk at the meeting table, just the person + chair
      execGroup.add(d.group); desks[a.id] = d;
    });
    // Department clusters.
    for (const dept of DEPTS) {
      if (dept.id === 'exec') continue;
      const list = byDept[dept.id] || [];
      const [cx, cz] = GRID[dept.id] || [0, 20];
      const group = new THREE.Group(); group.position.set(cx, 0, cz); deskRoot.add(group);
      const pods = Math.max(1, Math.ceil(list.length / 6));
      const podW = 3 * DESK_W + 0.6, width = pods * podW + (pods - 1) * 0.8;
      const carpet = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(width + 2, 7), 6.4), mat.carpet); carpet.rotation.x = -Math.PI / 2; carpet.position.y = 0.01; group.add(carpet);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(width + 2, 7), 0.08), new THREE.MeshBasicMaterial({ color: dept.accent })); edge.rotation.x = -Math.PI / 2; edge.position.set(0, 0.015, 3.2); group.add(edge);
      list.forEach((a, i) => {
        const pod = Math.floor(i / 6), k = i % 6, row = k < 3 ? 0 : 1, col = k % 3;
        const podX = -width / 2 + podW / 2 + pod * (podW + 0.8);
        const d = makeDesk(a, dept.accent);
        // Row 0 faces the camera (+z) over its monitors; row 1 sits opposite, screens toward the camera.
        d.group.position.set(podX + (col - 1) * DESK_W, 0, row === 0 ? -0.48 : 0.48);
        d.group.rotation.y = row === 0 ? 0 : Math.PI;
        group.add(d.group); desks[a.id] = d;
      });
      for (let p = 0; p < pods; p++) { const div = new THREE.Mesh(new THREE.BoxGeometry(podW - 0.5, 0.42, 0.04), mat.divider); div.position.set(-width / 2 + podW / 2 + p * (podW + 0.8), 0.98, 0); group.add(div); }
      const signS = screenMesh(4, 1, 640, 160); signS.mesh.position.set(0, 4.2, 0); signS.mesh.userData.pick = { type: 'dept', id: dept.id }; group.add(signS.mesh);
      const signBack = signS.mesh.clone(); signBack.rotation.y = Math.PI; group.add(signBack);
      for (const x of [-1.6, 1.6]) { const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 4), mat.metal); wire.position.set(x, 6.7, 0); group.add(wire); }
      const light = low ? null : new THREE.PointLight('#dfe8ff', 1.4, 12, 1.6); if (light) { light.position.set(0, 3, 0); group.add(light); }
      carpet.userData.pick = { type: 'dept', id: dept.id };
      clusters[dept.id] = { group, sign: signS, carpet, light, dept, anchor: new THREE.Vector3(cx, 5.1, cz), width };
    }
    for (const d of Object.values(desks)) { d.group.updateWorldMatrix(true, true); d.anchor.setFromMatrixPosition(d.group.matrixWorld).add(new THREE.Vector3(0, 1.75 * d.group.scale.y, 0)); }
    buildLabels();
  }

  // ---------- HTML labels: department tags, desk tags (LOD), handoff tags ----------
  const labelEls = { depts: {}, desks: {}, exec: null };
  function buildLabels() {
    labelsEl.innerHTML = '';
    labelEls.depts = {}; labelEls.desks = {};
    for (const [id, c] of Object.entries(clusters)) {
      const el = document.createElement('button'); el.type = 'button'; el.className = `label3d dept ${id === 'exec' ? 'exec' : ''}`;
      el.style.borderTopColor = id === 'exec' ? '#f2c14e' : c.dept.accent;
      el.innerHTML = `<span class="t">${id === 'exec' ? 'Executive Office' : c.dept.short}</span><span class="n"></span>`;
      el.addEventListener('click', () => (id === 'exec' ? on.exec?.() : on.dept?.(id)));
      labelsEl.appendChild(el); labelEls.depts[id] = el;
    }
    for (const id of Object.keys(desks)) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'label3d desk';
      el.addEventListener('click', () => on.agent?.(id));
      labelsEl.appendChild(el); labelEls.desks[id] = el;
    }
  }

  // ---------- handoff arcs (temporary; only from real handoff rows) ----------
  const arcs = [];
  const arcMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95 });
  function addArc(h, { persistent = false } = {}) {
    const A = desks[h.from], B = desks[h.to];
    if (!A || !B || arcs.some((x) => x.h.id === h.id)) return;
    const p0 = A.anchor.clone(), p2 = B.anchor.clone();
    const mid = p0.clone().lerp(p2, 0.5); mid.y += 2.5 + p0.distanceTo(p2) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), arcMat('#b7a8ff'));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    scene.add(line); scene.add(dot);
    const el = document.createElement('button'); el.type = 'button'; el.className = 'label3d handoff';
    el.innerHTML = `<span class="t">${h.label.replace(/[<>&]/g, '')}</span>`; el.title = `${h.from} → ${h.to}: ${h.objective || ''}`;
    el.addEventListener('click', () => on.ref?.(h.ref));
    labelsEl.appendChild(el);
    arcs.push({ h, line, dot, curve, el, born: performance.now(), persistent, mid });
  }
  function clearArcs(filter = () => true) {
    for (let i = arcs.length - 1; i >= 0; i--) if (filter(arcs[i])) { const a = arcs[i]; scene.remove(a.line); scene.remove(a.dot); a.line.geometry.dispose(); a.el.remove(); arcs.splice(i, 1); }
  }

  // ---------- camera ----------
  const OVERVIEW = { pos: new THREE.Vector3(0, 36, 47), look: new THREE.Vector3(0, 0, -5) };
  const cam = { pos: OVERVIEW.pos.clone(), look: OVERVIEW.look.clone() };
  let target = { pos: OVERVIEW.pos.clone(), look: OVERVIEW.look.clone() };
  let orbit = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panZ: 0 };
  let isFixed = fixed;
  let focusKey = 'overview';
  function setTarget(pos, look, key) { target = { pos, look }; orbit = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panZ: 0 }; focusKey = key; if (reducedMotion) { cam.pos.copy(pos); cam.look.copy(look); } }
  const api = {};
  api.overview = () => setTarget(OVERVIEW.pos.clone(), OVERVIEW.look.clone(), 'overview');
  api.focusDept = (id) => {
    if (id === 'exec') return api.focusExec();
    const c = clusters[id]; if (!c) return api.overview();
    const p = c.group.position;
    setTarget(new THREE.Vector3(p.x, 9.5, p.z + 12.5), new THREE.Vector3(p.x, 0.8, p.z), `dept:${id}`);
  };
  api.focusAgent = (id) => {
    const d = desks[id]; if (!d) return;
    const p = d.anchor.clone();
    // Look at the person from the screen side so the face and the monitor are both visible.
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(d.group.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    // Over-the-shoulder: behind and above the agent, looking at them and their status screen.
    setTarget(p.clone().add(dir.clone().multiplyScalar(-3.4)).add(new THREE.Vector3(0, 2.0, 0)), p.clone().add(dir.clone().multiplyScalar(0.4)).add(new THREE.Vector3(0, -0.7, 0)), `agent:${id}`);
  };
  api.focusExec = () => setTarget(new THREE.Vector3(EXEC.x, EXEC.top + 9, EXEC.z + 17), new THREE.Vector3(EXEC.x, EXEC.top + 1.2, EXEC.z - 0.5), 'exec');
  api.focusWall = (id) => {
    const w = walls[id]; if (!w) return;
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), w.def.rot);
    const look = new THREE.Vector3(...w.def.pos);
    setTarget(look.clone().add(n.multiplyScalar(w.def.size[0] * 1.15)).add(new THREE.Vector3(0, -1, 0)), look, `wall:${id}`);
  };
  api.getCamera = () => ({ pos: cam.pos.toArray(), look: cam.look.toArray(), orbit: { ...orbit }, key: focusKey });
  api.setCamera = (c) => { if (!c?.pos) return; setTarget(new THREE.Vector3(...c.pos), new THREE.Vector3(...c.look), c.key || 'saved'); if (c.orbit) orbit = { ...orbit, ...c.orbit }; };
  api.setFixed = (v) => { isFixed = !!v; if (isFixed) orbit = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panZ: 0 }; };
  api.focusKey = () => focusKey;
  if (!reducedMotion) { cam.pos.set(0, 60, 90); cam.look.set(0, 0, -10); }

  // ---------- interaction ----------
  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  let drag = null;
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    for (const h of ray.intersectObjects(scene.children, true)) { let o = h.object; while (o && !o.userData.pick) o = o.parent; if (o?.userData.pick && o.visible !== false) return o.userData.pick; }
    return null;
  };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, o: { ...orbit }, moved: false, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { const p = pick(e); canvas.style.cursor = p ? 'pointer' : 'grab'; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved || isFixed) return;
    if (drag.pan) { orbit.panX = drag.o.panX - dx * 0.04 * orbit.zoom; orbit.panZ = drag.o.panZ - dy * 0.04 * orbit.zoom; }
    else { orbit.yaw = Math.max(-0.9, Math.min(0.9, drag.o.yaw - dx * 0.004)); orbit.pitch = Math.max(-0.35, Math.min(0.3, drag.o.pitch + dy * 0.003)); }
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag; drag = null; if (!d || d.moved) return;
    const p = pick(e); if (!p) return;
    if (p.type === 'agent') on.agent?.(p.id);
    else if (p.type === 'dept') on.dept?.(p.id);
    else if (p.type === 'wall') on.wall?.(p.id);
    else if (p.type === 'exec') on.exec?.(p.id);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (isFixed) return; orbit.zoom = Math.max(0.35, Math.min(1.7, orbit.zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });

  // ---------- data → scene ----------
  let lastAgentsKey = '';
  let current = { desks: {}, mode: 'floor', highlight: null, selected: null };
  const deskVisible = {};
  api.update = (data) => {
    const list = Object.values(data.desks);
    const k = list.map((d) => `${d.id}:${d.dept}`).sort().join('|');
    if (k !== lastAgentsKey) { lastAgentsKey = k; clearArcs(); layout(list); }
    current.desks = data.desks;
    for (const d of list) {
      const desk = desks[d.id]; if (!desk) continue;
      desk.state = d;
      desk.strip.material = statusMat[d.status]; desk.beacon.material = statusMat[d.status];
      const sk = `${d.status}|${d.name}|${d.task}|${d.why?.[0]}`;
      if (sk !== desk.screen.key) { desk.screen.key = sk; drawDeskScreen(desk.screen.canvas, d); desk.screen.tex.needsUpdate = true; }
      // Verified activity only: paper while reviewing, headset only on a connected AI call, video timeline while editing.
      desk.paper.visible = d.status === 'working' && d.activity === 'reviewing';
      desk.headset.visible = d.activity === 'call';
      desk.scr2.material.color.set(d.status === 'working' ? (d.activity === 'editing_video' ? '#3a1d3a' : '#0f2236') : '#06090e');
      desk.person.visible = true;
      const dim = d.status === 'paused';
      desk.torso.material.opacity = dim ? 0.45 : 1; desk.torso.material.transparent = dim;
    }
    for (const [id, c] of Object.entries(clusters)) {
      if (!c.sign) continue;
      const w = data.workload?.[id];
      const sk = JSON.stringify(w || {});
      if (sk !== c.sign.key) { c.sign.key = sk; drawSign(c.sign.canvas, c.dept, w); c.sign.tex.needsUpdate = true; }
    }
    for (const [id, el] of Object.entries(labelEls.depts)) {
      const w = data.workload?.[id] || {};
      if (id === 'exec') { const b = data.desks.manager; el.querySelector('.n').innerHTML = b ? `<i style="color:${b.color}">Big Boss: ${b.icon} ${b.statusLabel}</i>` : ''; el.classList.toggle('hot', !!(b && (b.needsYou || b.status === 'blocked'))); continue; }
      el.querySelector('.n').innerHTML = `${w.working ? `<i class="s-working">▶${w.working}</i>` : ''}${w.needs ? `<i class="s-needs">!${w.needs}</i>` : ''}${w.blocked ? `<i class="s-blocked">✕${w.blocked}</i>` : ''}${w.paused ? '<i class="s-paused">Ⅱ</i>' : ''}${!w.working && !w.needs && !w.blocked && !w.paused ? `<i class="s-idle">${w.total || 0} desks</i>` : ''}`;
      el.classList.toggle('hot', !!(w.needs || w.blocked));
    }
    for (const [id, el] of Object.entries(labelEls.desks)) {
      const d = data.desks[id]; if (!d) continue;
      const st = STATUS[d.status];
      const html = `<span class="nm">${d.name}</span><span class="st" style="--c:${st.color}">${st.icon} ${st.label}</span>${d.task ? `<span class="tk">${String(d.task).replace(/[<>&]/g, '').slice(0, 70)}</span>` : ''}${d.since && d.status === 'working' ? `<span class="tm" data-since="${d.since}"></span>` : ''}${d.needsYou ? `<span class="ny">Needs you</span>` : ''}`;
      if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
      el.dataset.status = d.status;
      el.classList.toggle('needs', !!d.needsYou);
    }
    for (const [id, s] of Object.entries(data.walls || {})) if (walls[id]) {
      const sk = JSON.stringify(s); if (sk !== walls[id].key) { walls[id].key = sk; drawWall(walls[id].canvas, s); walls[id].tex.needsUpdate = true; }
    }
    for (const [id, s] of Object.entries(data.exec || {})) if (execScreens[id]) {
      const sk = JSON.stringify(s); if (sk !== execScreens[id].key) { execScreens[id].key = sk; drawWall(execScreens[id].canvas, s); execScreens[id].tex.needsUpdate = true; }
    }
    // Handoffs: live arcs for new ones; in Workflow View, the recent ones stay up.
    for (const h of data.newHandoffs || []) addArc(h);
    if (current.mode === 'workflow') { for (const h of (data.recentHandoffs || []).slice(0, 12)) addArc(h, { persistent: true }); }
  };
  api.setMode = (mode, highlight = null) => {
    current.mode = mode; current.highlight = highlight;
    if (mode !== 'workflow') clearArcs((a) => a.persistent);
  };
  api.select = (id) => { current.selected = id; };

  // ---------- resize / render loop ----------
  // When a side panel covers part of the canvas, shift the projection so the focused thing sits in the visible area.
  let inset = 0;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    if (inset > 0 && inset < r.width * 0.8) camera.setViewOffset(r.width, r.height, inset / 2, 0, r.width, r.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  // Screen position of a desk (used by tests and by 'Watch Work' to confirm the desk is on screen).
  api.project = (id) => { const d = desks[id]; if (!d) return null; const r = canvas.getBoundingClientRect(); const p = project(d.anchor, r); return { x: p.x + r.left, y: p.y + r.top, vis: p.vis, cam: camera.position.toArray(), anchor: d.anchor.toArray() }; };
  api.setInset = (px) => { inset = px || 0; resize(); };
  const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement); resize();

  const v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let last = 0, running = true, t0 = performance.now();
  const relevant = (d) => {
    const m = current.mode;
    if (m === 'approvals') return d.status === 'needs_approval' || !!d.needsYou;
    if (m === 'health') return d.status === 'blocked' || d.status === 'paused';
    if (m === 'content') return d.dept === 'media';
    if (m === 'customer') return ['customers', 'agency', 'dropship', 'etsy', 'realestate'].includes(d.dept) && (d.status !== 'idle');
    if (m === 'money') return ['finance', 'exec'].includes(d.dept) || d.dept === 'hq';
    if (m === 'workflow') return d.status !== 'idle' && d.status !== 'paused';
    return true;
  };
  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (low && t - last < 33) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    const k = reducedMotion ? 1 : 1 - Math.pow(0.002, dt);
    cam.pos.lerp(target.pos, k); cam.look.lerp(target.look, k);
    const look = cam.look.clone().add(new THREE.Vector3(orbit.panX, 0, orbit.panZ));
    const off = cam.pos.clone().sub(cam.look).applyAxisAngle(up, orbit.yaw);
    const right = new THREE.Vector3().crossVectors(off, up).normalize();
    off.applyAxisAngle(right, orbit.pitch).multiplyScalar(orbit.zoom);
    if (!reducedMotion && !low && !isFixed && focusKey === 'overview') off.applyAxisAngle(up, Math.sin(t / 12000) * 0.02);
    camera.position.copy(look).add(off); camera.lookAt(look);

    const time = (t - t0) / 1000;
    for (const desk of Object.values(desks)) {
      const d = desk.state; if (!d) continue;
      const hi = relevant(d);
      desk.beacon.scale.setScalar(hi ? 1 : 0.6);
      if (reducedMotion || low) continue;
      const ph = desk.phase + time;
      if (d.status === 'working') {
        if (d.activity === 'reviewing') { desk.headG.rotation.x = 0.35 + Math.sin(ph * 0.8) * 0.05; desk.armL.rotation.x = desk.armR.rotation.x = 0.9; }
        else if (d.activity === 'call') { desk.headG.rotation.x = 0.05 + Math.sin(ph * 2.2) * 0.06; desk.armL.rotation.x = 0.55; desk.armR.rotation.x = 1.6; }
        else { desk.armL.rotation.x = 0.55 + Math.sin(ph * 14) * 0.08; desk.armR.rotation.x = 0.55 + Math.sin(ph * 14 + 1.7) * 0.08; desk.headG.rotation.x = 0.12 + Math.sin(ph * 0.6) * 0.03; }
        desk.headG.rotation.y = Math.sin(ph * 0.4) * (d.activity === 'editing_video' ? 0.18 : 0.06);
      } else {
        desk.armL.rotation.x = desk.armR.rotation.x = 0.25; desk.headG.rotation.x = d.status === 'blocked' ? 0.4 : 0; desk.headG.rotation.y = 0;
      }
      if (d.status === 'blocked' || d.status === 'needs_approval') desk.beacon.scale.setScalar((hi ? 1 : 0.6) * (1 + Math.max(0, Math.sin(time * 3)) * 0.5));
    }
    // arcs: travel + fade
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i]; const age = (performance.now() - a.born) / 1000;
      const life = a.persistent ? Infinity : 9;
      if (age > life) { clearArcs((x) => x === a); continue; }
      const op = a.persistent ? 0.55 : Math.max(0, 1 - Math.max(0, age - 6) / 3);
      a.line.material.opacity = op; a.dot.visible = !reducedMotion;
      a.dot.position.copy(a.curve.getPoint(reducedMotion ? 1 : (age % 2.2) / 2.2));
    }
    renderer.render(scene, camera);
    placeLabels();
  }
  function project(p, r) { v.copy(p).project(camera); return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, vis: v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 }; }
  function placeLabels() {
    const r = canvas.getBoundingClientRect();
    const camPos = camera.position;
    for (const [id, el] of Object.entries(labelEls.depts)) {
      const c = clusters[id]; const p = project(c.anchor, r);
      el.style.display = p.vis ? '' : 'none';
      if (p.vis) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    // Desk tags: close-up only (LOD), plus anything needing you or blocked when the room is small.
    let shown = 0;
    const entries = Object.entries(labelEls.desks).map(([id, el]) => [id, el, desks[id], camPos.distanceTo(desks[id]?.anchor || camPos)]).sort((a, b) => a[3] - b[3]);
    for (const [id, el, desk, dist] of entries) {
      const d = desk?.state; if (!d) { el.style.display = 'none'; continue; }
      const near = dist < 17 || (focusKey === 'exec' && d.dept === 'exec');
      const urgent = d.needsYou || d.status === 'blocked';
      const show = (near || (urgent && dist < 60) || current.selected === id || (focusKey === 'exec' && d.dept === 'exec')) && relevant(d) && shown < 40;
      const p = show ? project(desk.anchor, r) : null;
      if (!p || !p.vis) { el.style.display = 'none'; continue; }
      shown++;
      el.style.display = '';
      el.classList.toggle('mini', !near && current.selected !== id);
      el.classList.toggle('sel', current.selected === id);
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const recentPersistent = new Set(arcs.filter((a) => a.persistent).slice(-4));
    for (const a of arcs) {
      if (a.persistent && !recentPersistent.has(a)) { a.el.style.display = 'none'; continue; }
      const p = project(a.mid, r);
      const age = (performance.now() - a.born) / 1000;
      a.el.style.display = p.vis && (a.persistent || age < 9) ? '' : 'none';
      a.el.style.opacity = a.persistent ? 0.85 : Math.max(0, 1 - Math.max(0, age - 6) / 3);
      if (p.vis) a.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  }
  requestAnimationFrame(frame);
  const onVis = () => { const was = running; running = !document.hidden; if (running && !was) requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', onVis);
  api.destroy = () => { running = false; ro.disconnect(); document.removeEventListener('visibilitychange', onVis); textures.forEach((t) => t.dispose()); renderer.dispose(); labelsEl.innerHTML = ''; };
  return api;
}
