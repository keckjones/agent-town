// The 3D trading floor: desk clusters per department, seated agents, five display walls, and the elevated
// glass Executive Office for the Big Boss (the Executive Orchestrator). Purely a view: everything it shows comes
// from floor-model.js (derived from database rows); every control lives in the HTML panels.
// Quality: full | low (1x pixels, 30 fps, no idle motion, fewer lights). Reduced motion: no animation, instant camera.
import * as THREE from 'three';
import { DEPTS, STATUS } from './floor-model.js';
import { buildSkyline } from './skyline.js';

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
  const k = W / 256;
  bg(g, W, H, st.color);
  g.textBaseline = 'top';
  g.fillStyle = '#eef3fa'; g.font = `600 ${30 * k}px ${FONT_D}`; g.fillText(fit(g, d.name, W - 20 * k), 10 * k, 12 * k);
  g.fillStyle = st.color; g.font = `600 ${22 * k}px ${FONT_M}`; g.fillText(fit(g, `${st.icon} ${st.label}`, W - 20 * k), 10 * k, 50 * k);
  g.fillStyle = '#b3bdcc'; g.font = `500 ${19 * k}px ${FONT_M}`;
  const words = String(d.task || d.why?.[0] || '').split(' '); let line = '', y = 84 * k;
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > W - 20 * k) { g.fillText(line, 10 * k, y); y += 22 * k; line = w; if (y > H - 24 * k) { line = ''; break; } } else line = t; }
  if (line && y <= H - 24 * k) g.fillText(fit(g, line, W - 20 * k), 10 * k, y);
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
// Departments on a 5 × 2 grid in front of the Executive Office, with the glass War Room in the middle.
// Businesses in the back row, support teams in front.
const GRID = { agency: [-26, -4], sports: [-13, -4], etsy: [13, -4], dropship: [26, -4], realestate: [0, -4],
  media: [-26, 12.5], ventures: [-13, 12.5], customers: [0, 12.5], finance: [13, 12.5], hq: [26, 12.5] };
const WAR = { x: 0, z: 4.3, w: 13, d: 6.4 };
// Walking lanes: an aisle behind the War Room, one in front of it, and side lanes past its doors.
const A_BACK = 0.2, A_FRONT = 8.4, LANE_X = 8.5;
const EXEC = { x: 0, z: -17, top: 1.6, w: 20, d: 10 };
const DESK_W = 1.6;
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const SKIN = ['#f1c7a5', '#d9a47c', '#b07a52', '#8a5a3b', '#5e3d29', '#e8b896'];
const HAIR = ['#1b1410', '#3b2a1e', '#6b4a2b', '#a0743f', '#d8c08a', '#2b2b2b', '#7a2e1d'];

export function createFloor({ canvas, labelsEl, on = {}, quality = 'full', reducedMotion = false, fixed = false, ambient = true }) {
  const low = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070a10');
  scene.fog = new THREE.Fog('#070a10', 55, 110);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);

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
    keyboard: new THREE.BoxGeometry(0.46, 0.02, 0.15),
    mouse: new THREE.BoxGeometry(0.06, 0.025, 0.1),
    mug: new THREE.CylinderGeometry(0.045, 0.04, 0.1, 10),
    thigh: new THREE.BoxGeometry(0.13, 0.13, 0.44),
    shin: new THREE.BoxGeometry(0.11, 0.11, 0.44),
    shoe: new THREE.BoxGeometry(0.12, 0.07, 0.2),
    neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8),
  };
  const pantsMat = new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.85 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.6 });
  const statusMat = Object.fromEntries(Object.values(STATUS).map((s) => [s.key, new THREE.MeshBasicMaterial({ color: s.color })]));
  const textures = new Set();
  const screenMesh = (w, h, cw, ch) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; textures.add(tex);
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
  // A high floor of a Manhattan office tower: floor-to-ceiling windows on three sides with the city outside.
  // The display walls hang on solid core sections; everything else is glass.
  const sky = buildSkyline(scene, { low, maxAniso: Math.min(4, maxAniso) });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(85, 0.6, 65), mat.metal); slab.position.set(0, -0.31, -2); scene.add(slab);
  const facade = new THREE.Mesh(new THREE.BoxGeometry(85.4, 300, 65.4), new THREE.MeshBasicMaterial({ color: '#0b1018', fog: false })); facade.position.set(0, -150.7, -2); scene.add(facade);
  const H_ROOM = 16;
  const core = (w, x, z, ry) => { const c = new THREE.Mesh(new THREE.BoxGeometry(w, H_ROOM, 0.5), mat.wall); c.position.set(x, H_ROOM / 2, z); c.rotation.y = ry; scene.add(c); };
  core(70, 0, -27, 0);                                   // media wall behind the three back screens
  core(21, -42, -6, Math.PI / 2); core(21, 42, -6, Math.PI / 2);   // behind the side screens
  const winGlass = new THREE.MeshPhysicalMaterial({ color: '#9fc4ff', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const mullion = new THREE.BoxGeometry(0.16, H_ROOM, 0.22), transom = new THREE.BoxGeometry(1, 0.14, 0.24);
  // A window wall from a to b (x,z pairs) with a mullion every ~3.6 units, a sill and a head.
  const windowWall = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, H_ROOM), winGlass); pane.position.set(mx, H_ROOM / 2, mz); pane.rotation.y = ry; scene.add(pane);
    const n = Math.max(1, Math.round(len / 3.6));
    for (let i = 0; i <= n; i++) { const t = i / n; const m = new THREE.Mesh(mullion, mat.metal); m.position.set(ax + (bx - ax) * t, H_ROOM / 2, az + (bz - az) * t); m.rotation.y = ry; scene.add(m); }
    for (const y of [0.45, 3.4, H_ROOM - 0.07]) { const b = new THREE.Mesh(transom, mat.metal); b.scale.x = len; b.position.set(mx, y, mz); b.rotation.y = ry; scene.add(b); }
  };
  windowWall(-42, -27, -35, -27); windowWall(35, -27, 42, -27);          // back corners
  windowWall(-42, -27, -42, -16.5); windowWall(-42, 4.5, -42, 30);        // left side
  windowWall(42, -27, 42, -16.5); windowWall(42, 4.5, 42, 30);            // right side
  // Columns along the glass and a skirting light line.
  const pillarGeo = new THREE.BoxGeometry(0.8, 16, 0.8);
  for (const x of [-41.4, 41.4]) for (const z of [-22, -12, -2, 8, 18, 28]) { const p = new THREE.Mesh(pillarGeo, mat.metal); p.position.set(x, 8, z); scene.add(p); }
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(84, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: '#3aa0ff' })); skirt.position.set(0, 0.05, -26.7); scene.add(skirt);
  // Break areas: a coffee bar (left) and a water cooler (right). Idle agents sometimes walk here; it's labeled as a break.
  const plantPot = new THREE.CylinderGeometry(0.28, 0.22, 0.5, 12), plantLeaf = new THREE.IcosahedronGeometry(0.55, 1);
  const potMat = new THREE.MeshStandardMaterial({ color: '#30353d', roughness: 0.8 }), leafMat = new THREE.MeshStandardMaterial({ color: '#2f6b46', roughness: 0.9, flatShading: true });
  const plant = (x, z, s = 1) => { const g = new THREE.Group(); const pot = new THREE.Mesh(plantPot, potMat); pot.position.y = 0.25; g.add(pot); const l = new THREE.Mesh(plantLeaf, leafMat); l.position.y = 0.95; l.scale.set(1, 1.3, 1); g.add(l); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g); };
  const BREAK = { coffee: new THREE.Vector3(-36.5, 0, 4.3), water: new THREE.Vector3(36.5, 0, 4.3) };
  { const bar = new THREE.Group(); bar.position.set(-39, 0, 4);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.05, 5), mat.wood); counter.position.y = 0.52; bar.add(counter);
    const topS = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 5.1), mat.deskTop); topS.position.y = 1.07; bar.add(topS);
    const machine = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.5), mat.metal); machine.position.set(0, 1.45, -1); bar.add(machine);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: '#ffb35c' })); glow.position.set(0.31, 1.55, -1); bar.add(glow);
    for (let i = 0; i < 3; i++) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), mat.paper); cup.position.set(0, 1.16, 0.4 + i * 0.25); bar.add(cup); }
    scene.add(bar); }
  { const wc = new THREE.Group(); wc.position.set(39, 0, 4);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), new THREE.MeshStandardMaterial({ color: '#d7dde6', roughness: 0.6 })); body.position.y = 0.5; wc.add(body);
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 16), new THREE.MeshPhysicalMaterial({ color: '#7fc4ff', transparent: true, opacity: 0.55, roughness: 0.1 })); jug.position.y = 1.25; wc.add(jug);
    scene.add(wc); }
  for (const [x, z] of [[-38, 0], [-38, 8.5], [38, 0], [38, 8.5], [-11, -24.5], [11, -24.5], [-34, -24.5], [34, -24.5], [-34, 19.5], [34, 19.5], [-7.4, 1.4], [7.4, 1.4], [-7.4, 7.2], [7.4, 7.2]]) plant(x, z, 1.1);
  // LED ticker band across the top of the back wall: scrolls the same recorded events as the bottom ticker.
  const led = screenMesh(84, 1.1, 4096, 64); led.mesh.position.set(0, 15.2, -26.7); scene.add(led.mesh);
  led.tex.wrapS = THREE.RepeatWrapping; led.tex.repeat.set(1, 1);
  // Shared animated monitor content (only shown on desks with a verified running task).
  const loopTex = (draw, w = 256, h = 256) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 0.55); textures.add(t); return t; };
  const codeTex = loopTex((g, w, h) => { g.fillStyle = '#0b1522'; g.fillRect(0, 0, w, h); for (let y = 6; y < h; y += 10) { const ind = (y * 7) % 40; const len = 40 + ((y * 37) % 150); g.fillStyle = ['#3aa0ff', '#9aa6b8', '#2fd38a', '#c79bff'][(y / 10) % 4 | 0]; g.globalAlpha = 0.85; g.fillRect(10 + ind, y, len, 4); } g.globalAlpha = 1; });
  const docTex = loopTex((g, w, h) => { g.fillStyle = '#e9edf2'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a4352'; g.fillRect(16, 10, 120, 10); for (let y = 30; y < h; y += 12) { g.fillStyle = '#8a94a3'; g.fillRect(16, y, 160 + ((y * 13) % 60), 5); } g.strokeStyle = '#2fd38a'; g.lineWidth = 3; g.strokeRect(190, 60, 40, 40); });
  const vidTex = loopTex((g, w, h) => { g.fillStyle = '#1a0f22'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff8bd1'; g.fillRect(20, 20, 216, 120); g.fillStyle = '#2a1a35'; g.fillRect(0, 160, w, 96); for (let x = 4; x < w; x += 22) { g.fillStyle = ['#ff8bd1', '#5fd0e6', '#f2c14e'][(x / 22) % 3 | 0]; g.fillRect(x, 175 + ((x * 3) % 40), 18, 14); } g.fillStyle = '#fff'; g.fillRect(128, 160, 2, 96); }, 256, 256);
  const screenMat = { typing: new THREE.MeshBasicMaterial({ map: codeTex, toneMapped: false }), reviewing: new THREE.MeshBasicMaterial({ map: docTex, toneMapped: false }), editing_video: new THREE.MeshBasicMaterial({ map: vidTex, toneMapped: false }), call: new THREE.MeshBasicMaterial({ map: codeTex, toneMapped: false }), off: new THREE.MeshBasicMaterial({ color: '#08101a', toneMapped: false }) };

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
    const s = screenMesh(w.size[0], w.size[1], 2048, Math.round((2048 * w.size[1]) / w.size[0]));
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
  const sign = screenMesh(4.2, 0.62, 1680, 248); sign.mesh.position.set(0, EXEC.top + GH - 0.4, EXEC.d / 2 + 0.02); exec.add(sign.mesh);
  const drawExecSign = () => { const g = sign.canvas.getContext('2d'); g.fillStyle = '#0a0f17'; g.fillRect(0, 0, 1680, 248); g.fillStyle = '#f2c14e'; g.fillRect(0, 232, 1680, 16); g.font = `600 128px ${FONT_D}`; g.textBaseline = 'middle'; g.fillStyle = '#f5e6bf'; const t = 'EXECUTIVE OFFICE'; g.fillText(t, (1680 - g.measureText(t).width) / 2, 116); sign.tex.needsUpdate = true; };
  drawExecSign();
  // Three screens on the office's back wall.
  const execScreens = {};
  [['perf', -6], ['depts', 0], ['approvals', 6]].forEach(([id, x]) => {
    const s = screenMesh(5.2, 2.9, 1344, 750); s.mesh.position.set(x, EXEC.top + 2.6, -EXEC.d / 2 + 0.12); s.mesh.userData.pick = { type: 'exec', id }; exec.add(s.mesh); execScreens[id] = s;
  });
  // Meeting table + chairs (CEO agents sit here when promoted).
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.08, 40), mat.wood); table.position.set(-6, EXEC.top + 0.76, 1.2); exec.add(table);
  const tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.72, 12), mat.metal); tleg.position.set(-6, EXEC.top + 0.36, 1.2); exec.add(tleg);
  const execLight = new THREE.PointLight('#ffd98a', low ? 0.8 : 1.6, 16, 2); execLight.position.set(0, EXEC.top + 4, 0); exec.add(execLight);
  exec.traverse((o) => { if (o.isMesh && !o.userData.pick) o.userData.pick = { type: 'exec', id: 'office' }; });

  // ---------- War Room (glass meeting room in the middle of the floor) ----------
  // The department leads and the Big Boss meet here every morning. Who is in the room comes only from the
  // `meetings` record (in session, or a few minutes of wrap-up after it ends).
  const war = new THREE.Group(); war.position.set(WAR.x, 0, WAR.z); scene.add(war);
  const warCarpet = new THREE.Mesh(new THREE.PlaneGeometry(WAR.w, WAR.d), new THREE.MeshStandardMaterial({ color: '#232b3a', roughness: 0.95 })); warCarpet.rotation.x = -Math.PI / 2; warCarpet.position.y = 0.012; war.add(warCarpet);
  const warEdgeMat = new THREE.MeshBasicMaterial({ color: '#f2c14e' });
  const WH = 3.2, warGlass = new THREE.MeshPhysicalMaterial({ color: '#d8e6ff', roughness: 0.04, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const warPane = (w, x, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, WH), warGlass); p.position.set(x, WH / 2, z); p.rotation.y = ry; war.add(p);
    for (const y of [0.02, WH]) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.07), mat.metal); r.position.set(x, y, z); r.rotation.y = ry; war.add(r); } };
  const hw = WAR.w / 2, hd = WAR.d / 2, door = 0.9;
  warPane(WAR.w, 0, -hd, 0); warPane(WAR.w, 0, hd, 0);
  for (const sx of [-1, 1]) { warPane(hd - door, sx * hw, -(hd + door) / 2, Math.PI / 2); warPane(hd - door, sx * hw, (hd + door) / 2, Math.PI / 2); }
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [-hw, -door], [-hw, door], [hw, -door], [hw, door], [-hw / 3, -hd], [hw / 3, -hd], [-hw / 3, hd], [hw / 3, hd]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, WH, 0.1), mat.metal); m.position.set(x, WH / 2, z); war.add(m);
  }
  const warTop = new THREE.Mesh(new THREE.BoxGeometry(WAR.w + 0.1, 0.05, 0.05), warEdgeMat); warTop.position.set(0, WH + 0.05, hd); war.add(warTop);
  // Long table, chairs, and a screen on the back glass.
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.08, 1.8), mat.wood); tableTop.position.y = 0.76; war.add(tableTop);
  for (const x of [-3.2, 0, 3.2]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.9), mat.metal); l.position.set(x, 0.36, 0); war.add(l); }
  const tableGlow = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: '#3aa0ff' })); tableGlow.position.set(0, 0.81, 0); war.add(tableGlow);
  // Seats: six along the back side (facing the camera), six along the front, and the head of the table for the Big Boss.
  const SEATS = [];
  for (const row of [-1, 1]) for (let i = 0; i < 6; i++) SEATS.push({ x: -3.75 + i * 1.5, z: row * 1.35, yaw: row < 0 ? 0 : Math.PI, lane: row * 2.35 });
  const HEAD = { x: -5.3, z: 0, yaw: Math.PI / 2, lane: null };
  const warChair = (s) => { const c = new THREE.Group(); c.position.set(s.x, 0, s.z); c.rotation.y = s.yaw;
    const seat = new THREE.Mesh(geo.seat, mat.chair); seat.position.y = 0.46; c.add(seat);
    const backr = new THREE.Mesh(geo.back, mat.chair); backr.position.set(0, 0.8, -0.28); c.add(backr);
    const post = new THREE.Mesh(geo.post, mat.metal); post.position.y = 0.21; c.add(post); war.add(c); };
  [HEAD, ...SEATS].forEach(warChair);
  const warScreen = screenMesh(6, 1.9, 1600, 506); warScreen.mesh.position.set(0.6, 2.05, -hd + 0.06); warScreen.mesh.userData.pick = { type: 'war', id: 'screen' }; war.add(warScreen.mesh);
  const warBezel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.1, 0.06), mat.bezel); warBezel.position.set(0.6, 2.05, -hd + 0.02); war.add(warBezel);
  const warSign = screenMesh(3.4, 0.5, 1360, 200); warSign.mesh.position.set(0, WH - 0.32, hd + 0.03); war.add(warSign.mesh);
  let warSignLive = null;
  const drawWarSign = (live, force = false) => { if (live === warSignLive && !force) return; warSignLive = live; const g = warSign.canvas.getContext('2d'); g.fillStyle = '#0a0f17'; g.fillRect(0, 0, 1360, 200); g.fillStyle = live ? '#2fd38a' : '#f2c14e'; g.fillRect(0, 186, 1360, 14);
    g.font = `600 104px ${FONT_D}`; g.textBaseline = 'middle'; g.fillStyle = '#f5e6bf'; const t = live ? 'WAR ROOM · IN SESSION' : 'WAR ROOM'; g.fillText(t, (1360 - g.measureText(t).width) / 2, 92); warSign.tex.needsUpdate = true; };
  drawWarSign(false);
  const warLight = low ? null : new THREE.PointLight('#ffe2a8', 1.2, 10, 1.8); if (warLight) { warLight.position.set(0, 3, 0); war.add(warLight); }
  war.traverse((o) => { if (o.isMesh && !o.userData.pick) o.userData.pick = { type: 'war', id: 'room' }; });
  const toWorld = (p, y = 0) => new THREE.Vector3(WAR.x + p.x, y, WAR.z + p.z);
  function drawWarScreen(m) {
    const g = warScreen.canvas.getContext('2d'); const W = warScreen.canvas.width, H = warScreen.canvas.height;
    bg(g, W, H, m?.phase === 'in_session' ? '#2fd38a' : '#f2c14e');
    g.textBaseline = 'top';
    const head = !m ? 'MORNING MEETING' : m.phase === 'in_session' ? 'MORNING MEETING · IN SESSION' : m.phase === 'wrap_up' ? 'MORNING MEETING · WRAP-UP' : `LAST MEETING · ${m.held_on}`;
    g.fillStyle = '#e6edf6'; g.font = `600 ${H * 0.13}px ${FONT_D}`; g.fillText(head, W * 0.03, H * 0.06);
    if (!m) { g.font = `500 ${H * 0.07}px ${FONT_M}`; g.fillStyle = '#8f9bb0'; g.fillText('Daily at 8:05 AM. No meeting on record yet.', W * 0.03, H * 0.3); warScreen.tex.needsUpdate = true; return; }
    let y = H * 0.25;
    if (m.focus) { g.font = `600 ${H * 0.08}px ${FONT_M}`; g.fillStyle = '#f2c14e'; g.fillText(fit(g, `FOCUS: ${m.focus}`, W * 0.94), W * 0.03, y); y += H * 0.12; }
    const lines = m.phase === 'in_session' ? m.lines.slice(-4) : (m.decisions.length ? m.decisions.slice(0, 4).map((d) => ({ dept: '✓', said: d })) : m.lines.slice(-4));
    for (const l of lines) {
      const dept = DEPTS.find((d) => d.id === l.dept);
      g.font = `600 ${H * 0.065}px ${FONT_M}`; g.fillStyle = dept?.accent || '#2fd38a';
      const tag = dept ? `${dept.short.toUpperCase()} ` : '✓ ';
      g.fillText(tag, W * 0.03, y);
      const tw = g.measureText(tag).width;
      g.font = `500 ${H * 0.065}px ${FONT_M}`; g.fillStyle = '#cfd8e6'; g.fillText(fit(g, l.said, W * 0.94 - tw), W * 0.03 + tw, y);
      y += H * 0.105; if (y > H * 0.9) break;
    }
    g.font = `500 ${H * 0.045}px ${FONT_M}`; g.fillStyle = '#566275'; g.fillText(fit(g, `${m.attendees.length} in the room · summaries of your records, not new facts`, W * 0.94), W * 0.03, H * 0.92);
    warScreen.tex.needsUpdate = true;
  }
  drawWarScreen(null);

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
    const scr = screenMesh(0.58, 0.34, low ? 256 : 512, low ? 150 : 300);
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
    const kb = new THREE.Mesh(geo.keyboard, mat.bezel); kb.position.set(0, 0.78, -0.08); g.add(kb);
    const mouse = new THREE.Mesh(geo.mouse, mat.bezel); mouse.position.set(0.38, 0.78, -0.08); g.add(mouse);
    if (hash(agent.id) % 3 === 0) { const mug = new THREE.Mesh(geo.mug, new THREE.MeshStandardMaterial({ color: ['#c0392b', '#2fd38a', '#e9edf2', '#3aa0ff'][hash(agent.id) % 4] })); mug.position.set(-0.6, 0.82, -0.1); g.add(mug); }
    // chair
    const chair = new THREE.Group(); chair.position.set(0, 0, -0.78);
    const seat = new THREE.Mesh(geo.seat, mat.chair); seat.position.y = 0.46; chair.add(seat);
    const backrest = new THREE.Mesh(geo.back, mat.chair); backrest.position.set(0, 0.8, -0.24); chair.add(backrest);
    const post = new THREE.Mesh(geo.post, mat.metal); post.position.y = 0.21; chair.add(post);
    chair.userData.keep = true; g.add(chair);
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
    const neck = new THREE.Mesh(geo.neck, skin); neck.position.y = 1.12; person.add(neck);
    // Legs: hip pivot → thigh → knee pivot → shin + shoe. Seated: thighs forward, shins down.
    const legs = [-0.1, 0.1].map((x) => {
      const hip = new THREE.Group(); hip.position.set(x, 0.52, 0); person.add(hip);
      const thigh = new THREE.Mesh(geo.thigh, pantsMat); thigh.position.z = 0.22; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.z = 0.44; hip.add(knee);
      const shin = new THREE.Mesh(geo.shin, pantsMat); shin.position.z = 0.22; knee.add(shin);
      const shoe = new THREE.Mesh(geo.shoe, shoeMat); shoe.position.set(0, 0.06, 0.45); knee.add(shoe);
      hip.rotation.x = 0; knee.rotation.x = Math.PI / 2;
      return { hip, knee };
    });
    const paper = new THREE.Mesh(geo.paper, mat.paper); paper.position.set(0, 1.02, 0.36); paper.rotation.x = -1.0; paper.visible = false; person.add(paper);
    const headset = new THREE.Group(); headset.visible = false; headG.add(headset);
    const band = new THREE.Mesh(geo.headset, mat.bezel); band.rotation.z = 0; band.position.y = 0.02; headset.add(band);
    const mic = new THREE.Mesh(geo.mic, mat.bezel); mic.position.set(0.15, -0.08, 0.08); mic.rotation.y = -0.6; headset.add(mic);
    person.userData.keep = true; g.add(person);
    g.traverse((o) => { if (o.isMesh) o.userData.pick = { type: 'agent', id: agent.id }; });
    return { id: agent.id, group: g, screen: scr, scr2, strip, beacon, person, torso, headG, armL, armR, legs, paper, headset, shirt, state: null, phase: (h % 1000) / 160, anchor: new THREE.Vector3(), home: new THREE.Vector3(), walk: null };
  }

  function layout(agents) {
    // Rebuild only when the set of agents (or their department) changes.
    for (const d of Object.values(desks)) if (d.walk) scene.remove(d.person);
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
      d.group.children.forEach((m) => { if (!m.userData.keep) m.visible = false; }); // no desk at the meeting table, just the person + chair
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
      const signS = screenMesh(4, 1, 1024, 256); signS.mesh.position.set(0, 4.2, 0); signS.mesh.userData.pick = { type: 'dept', id: dept.id }; group.add(signS.mesh);
      const signBack = signS.mesh.clone(); signBack.rotation.y = Math.PI; group.add(signBack);
      for (const x of [-1.6, 1.6]) { const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 4), mat.metal); wire.position.set(x, 6.7, 0); group.add(wire); }
      const light = low ? null : new THREE.PointLight('#dfe8ff', 1.4, 12, 1.6); if (light) { light.position.set(0, 3, 0); group.add(light); }

      carpet.userData.pick = { type: 'dept', id: dept.id };
      clusters[dept.id] = { group, sign: signS, carpet, light, dept, anchor: new THREE.Vector3(cx, 5.1, cz), width };
    }
    for (const d of Object.values(desks)) { d.group.updateWorldMatrix(true, true); d.anchor.setFromMatrixPosition(d.group.matrixWorld).add(new THREE.Vector3(0, 1.75 * d.group.scale.y, 0)); d.home.copy(d.anchor); }
    buildLabels();
  }

  // ---------- HTML labels: department tags, desk tags (LOD), handoff tags ----------
  const labelEls = { depts: {}, desks: {}, exec: null, war: null };
  const WAR_ANCHOR = new THREE.Vector3(WAR.x, WH + 1.1, WAR.z);
  const speechOf = (id) => { const l = [...(meeting?.lines || [])].reverse().find((x) => x.agent === id); return l ? String(l.said).replace(/[<>&]/g, '').slice(0, 90) + (l.said.length > 90 ? '…' : '') : ''; };
  function warLabel() {
    const el = labelEls.war; if (!el) return;
    const live = meetingLive();
    const html = live ? `<i class="s-working">${meeting.phase === 'in_session' ? '● In session' : 'Wrap-up'} · ${meeting.attendees.length} in the room</i>` : `<i class="s-idle">Morning meeting 8:05 AM</i>`;
    const n = el.querySelector('.n'); if (n.innerHTML !== html) { n.innerHTML = html; el._size = null; }
    el.classList.toggle('hot', live);
  }
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
    { const el = document.createElement('button'); el.type = 'button'; el.className = 'label3d dept warroom'; el.style.borderTopColor = '#f2c14e';
      el.innerHTML = '<span class="t">War Room</span><span class="n"></span>'; el.addEventListener('click', () => on.war?.('label'));
      labelsEl.appendChild(el); labelEls.war = el; warLabel(); }
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

  // ---------- walking ----------
  // Two kinds of walks, both tied to what the records say:
  //  * handoff delivery: when a real handoff row arrives, the agent who handed off carries the folder to the next desk;
  //  * breaks: an agent whose status is Idle may get up for coffee or water. Its tag says "Idle · on a break".
  //  * the morning meeting: while the meeting record is in session, the attendees walk to the War Room and sit down.
  // Nobody walks in reduced-motion or simplified mode, and a working agent never leaves its desk
  // (the one exception: the Big Boss, whose running task IS the meeting).
  const SPEED = 2.4;
  let ambientOn = ambient;
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  function deskFront(d, side = 0.7) {
    // A standing spot beside the desk's chair, in world space.
    d.group.updateWorldMatrix(true, false);
    return new THREE.Vector3(side, 0, -1.25).applyMatrix4(d.group.matrixWorld).setY(0);
  }
  function seatPose(d) { d.person.position.set(0, 0, -0.74); d.person.rotation.set(0, 0, 0); for (const l of d.legs) { l.hip.rotation.x = 0; l.knee.rotation.x = Math.PI / 2; } d.armL.position.set(-0.2, 0.92, 0.2); d.armR.position.set(0.2, 0.92, 0.2); d.armL.rotation.x = d.armR.rotation.x = 0.55; }
  function standPose(d) { d.armL.position.set(-0.24, 0.84, 0); d.armR.position.set(0.24, 0.84, 0); d.armL.rotation.x = d.armR.rotation.x = Math.PI / 2; for (const l of d.legs) { l.hip.rotation.x = Math.PI / 2; l.knee.rotation.x = 0; } }
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const aisleOf = (p) => (p.z < WAR.z ? A_BACK : A_FRONT);
  // Floor height under a point: the Executive Office platform and its stairs are raised.
  const STAIR0 = EXEC.z + EXEC.d / 2, STAIR1 = STAIR0 + 2.4;
  function groundY(x, z) {
    if (Math.abs(x - EXEC.x) <= EXEC.w / 2 && z >= EXEC.z - EXEC.d / 2 && z <= STAIR0) return EXEC.top;
    if (Math.abs(x - EXEC.x) <= 2 && z > STAIR0 && z < STAIR1) return EXEC.top * (1 - (z - STAIR0) / (STAIR1 - STAIR0));
    return 0;
  }
  // From the boss's desk down the stairs to the floor (the path in reverse brings him back).
  function execExit(from) { return [from.clone(), V(EXEC.x - 0.5, from.z), V(EXEC.x - 0.5, STAIR0 - 0.4), V(EXEC.x - 0.5, STAIR1 + 0.3)]; }
  function routeTo(from, to) {
    const pts = [from.clone()];
    if (Math.abs(from.z - to.z) > 1.5 || Math.abs(from.x - to.x) > 3) {
      const a1 = aisleOf(from), a2 = aisleOf(to);
      pts.push(V(from.x, a1));
      // Crossing between the back and front aisles goes around the War Room, never through it.
      if (a1 !== a2) { const cx = Math.abs(from.x) >= LANE_X ? from.x : Math.abs(to.x) >= LANE_X ? to.x : (from.x + to.x >= 0 ? LANE_X : -LANE_X); pts.push(V(cx, a1), V(cx, a2)); }
      pts.push(V(to.x, a2));
    }
    pts.push(to.clone());
    return pts;
  }
  // Desk → War Room seat: aisle, side lane, door, the lane behind the chairs, then the seat.
  function routeToSeat(d, seat) {
    const s = toWorld(seat);
    let pts, from;
    if (d.state?.dept === 'exec') { pts = execExit(deskFront(d, 0).setY(0)); from = pts[pts.length - 1]; pts.pop(); }
    else { from = deskFront(d, 0); pts = []; }
    const side = seat === HEAD ? -1 : from.x < -0.01 ? -1 : from.x > 0.01 ? 1 : (s.x < 0 ? -1 : 1);
    const a1 = aisleOf(from);
    if (d.state?.dept === 'exec') pts.push(from.clone(), V(side * LANE_X, from.z));   // past the back row, never through a cluster
    else pts.push(from.clone(), V(from.x, a1), V(side * LANE_X, a1));
    pts.push(V(side * LANE_X, WAR.z), V(WAR.x + side * (WAR.w / 2 + 0.6), WAR.z), V(WAR.x + side * (WAR.w / 2 - 0.6), WAR.z));
    if (seat.lane != null) pts.push(V(WAR.x + side * (WAR.w / 2 - 0.6), WAR.z + seat.lane), V(s.x, WAR.z + seat.lane));
    pts.push(s);
    return pts;
  }
  function startWalk(id, target, kind, label, path = null) {
    const d = desks[id];
    if (!d || d.walk || reducedMotion || low || !d.state) return false;
    if (kind !== 'meeting' && (d.state.status === 'working' || d.state.dept === 'exec')) return false;
    const start = deskFront(d, 0);
    d.person.updateWorldMatrix(true, false);
    scene.attach(d.person);
    d.person.position.copy(start); standPose(d);
    d.person.position.y = groundY(start.x, start.z) + 0.39;
    d.paper.visible = kind === 'handoff';
    d.paper.position.set(0.18, 1.12, 0.22); d.paper.rotation.set(-0.3, 0, 0);
    d.walk = { kind, label, path: path || routeTo(start.setY(0), target), i: 0, back: false, wait: kind === 'handoff' ? 2.2 : 4 + Math.random() * 3, waited: 0, start };
    return true;
  }
  // Head back the way we came.
  function turnBack(d) {
    const w = d.walk; if (w.back) return;
    w.back = true; w.seated = false; standPose(d);
    w.path = [d.person.position.clone().setY(0), ...w.path.slice(0, w.i + 1).reverse()]; w.i = 0;
  }
  function meetPose(d) { for (const l of d.legs) { l.hip.rotation.x = 0; l.knee.rotation.x = Math.PI / 2; } d.armL.position.set(-0.2, 0.92, 0.2); d.armR.position.set(0.2, 0.92, 0.2); d.armL.rotation.x = d.armR.rotation.x = 0.55; d.person.position.y = 0; }
  function endWalk(d) {
    d.group.attach(d.person); seatPose(d); d.paper.visible = false;
    d.paper.position.set(0, 1.02, 0.36); d.paper.rotation.set(-1.0, 0, 0);
    d.walk = null;
  }
  function stepWalk(d, dt, time) {
    const w = d.walk;
    const inMeeting = w.kind === 'meeting' && meetingLive() && meeting.id === w.meetingId && meeting.attendees.includes(d.id);
    if (w.kind === 'meeting' && !inMeeting) turnBack(d);
    if (d.state?.status === 'working' && !w.back && !(w.kind === 'meeting' && d.id === 'manager')) turnBack(d);
    const target = w.path[w.i + 1];
    if (!target) {
      if (!w.back && w.kind === 'meeting') {
        if (!w.seated) { w.seated = true; const s = w.seat; d.person.position.set(WAR.x + s.x, 0, WAR.z + s.z); d.person.rotation.set(0, s.yaw, 0); meetPose(d); }
        // Seated at the table. The current speaker (last line on the record) turns to the room and gestures.
        const talking = meeting?.speaking === d.id;
        d.headG.rotation.y = talking ? Math.sin(time * 1.3 + d.phase) * 0.35 : Math.sin(time * 0.3 + d.phase) * 0.12;
        d.headG.rotation.x = talking ? 0.02 : 0.1;
        d.armR.rotation.x = talking ? 0.9 + Math.sin(time * 3.2) * 0.35 : 0.55;
        return;
      }
      if (!w.back) { w.waited += dt; d.paper.visible = w.kind === 'handoff' && w.waited < w.wait * 0.5; if (w.waited < w.wait) { for (const l of d.legs) { l.hip.rotation.x = Math.PI / 2; l.knee.rotation.x = 0; } return; }
        turnBack(d); return; }
      endWalk(d); return;
    }
    tmpV.copy(target).sub(d.person.position).setY(0);
    const dist = tmpV.length();
    if (dist < 0.05) { w.i++; return; }
    const stepLen = Math.min(dist, SPEED * dt);
    d.person.position.addScaledVector(tmpV.normalize(), stepLen);
    d.person.position.y = groundY(d.person.position.x, d.person.position.z) + 0.39 + Math.abs(Math.sin(time * 9)) * 0.03;
    const yaw = Math.atan2(tmpV.x, tmpV.z);
    d.person.rotation.set(0, yaw, 0);
    const sw = Math.sin(time * 9 + d.phase);
    d.legs[0].hip.rotation.x = Math.PI / 2 + sw * 0.45; d.legs[1].hip.rotation.x = Math.PI / 2 - sw * 0.45;
    d.legs[0].knee.rotation.x = Math.max(0, -sw) * 0.6; d.legs[1].knee.rotation.x = Math.max(0, sw) * 0.6;
    d.armL.rotation.x = Math.PI / 2 - sw * 0.35; d.armR.rotation.x = Math.PI / 2 + sw * 0.35;
  }
  let nextBreak = 6;
  function maybeBreak(time) {
    if (!ambientOn || reducedMotion || low || time < nextBreak) return;
    nextBreak = time + 5 + Math.random() * 6;
    const walking = Object.values(desks).filter((d) => d.walk?.kind === 'break').length;
    if (walking >= 3) return;
    const busy = meetingLive() ? new Set(meeting.attendees) : null;
    const idle = Object.values(desks).filter((d) => !d.walk && d.state?.status === 'idle' && d.state.dept !== 'exec' && !busy?.has(d.id));
    if (!idle.length) return;
    const d = idle[Math.floor(Math.random() * idle.length)];
    const spot = d.home.x < 0 ? BREAK.coffee : BREAK.water;
    startWalk(d.id, spot.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 3)), 'break', d.home.x < 0 ? 'coffee' : 'water');
  }

  // ---------- the morning meeting ----------
  let meeting = null, meetingKey = '';
  const meetingLive = () => !!(meeting && meeting.inRoom && Date.now() < meeting.until);
  // Seat everyone in the record: Big Boss at the head, leads around the table in the order they speak.
  function syncMeeting() {
    const live = meetingLive();
    drawWarSign(live && meeting.phase === 'in_session'); warLabel();
    if (!live) return;
    let i = 0;
    for (const id of meeting.attendees) {
      const d = desks[id]; if (!d) continue;
      const seat = id === 'manager' ? HEAD : SEATS[i++ % SEATS.length];
      if (d.walk?.kind === 'meeting') continue;
      if (d.walk) continue;                                          // finishing a handoff or a break first
      if (id !== 'manager' && d.state?.status === 'working') continue; // working: joins from the desk
      if (startWalk(id, null, 'meeting', 'morning meeting', routeToSeat(d, seat))) { d.walk.seat = seat; d.walk.meetingId = meeting.id; }
    }
  }

  // ---------- camera ----------
  const OVERVIEW = { pos: new THREE.Vector3(0, 37, 49), look: new THREE.Vector3(0, 0, -4) };
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
  api.focusWar = () => setTarget(new THREE.Vector3(WAR.x + 7, 7.2, WAR.z + 9), new THREE.Vector3(WAR.x - 0.5, 0.9, WAR.z - 0.3), 'war');
  api.setSky = (p) => sky.setPhase(p);   // day | dusk | night (follows your clock by default)
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
    else if (p.type === 'war') on.war?.(p.id);
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
      desk.scr2.material = d.status === 'working' ? (screenMat[d.activity] || screenMat.typing) : screenMat.off;
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
      const html = `<span class="nm">${d.name}</span><span class="st" style="--c:${st.color}">${st.icon} ${st.label}</span>${d.task ? `<span class="tk">${String(d.task).replace(/[<>&]/g, '').slice(0, 70)}</span>` : ''}${d.since && d.status === 'working' ? `<span class="tm" data-since="${d.since}"></span>` : ''}${d.needsYou ? `<span class="ny">Needs you</span>` : ''}<span class="wk"></span>`;
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
    for (const h of data.newHandoffs || []) {
      addArc(h);
      const to = desks[h.to];
      if (to && h.from !== h.to) startWalk(h.from, deskFront(to, 0.75), 'handoff', h.label);
    }
    if (data.tickerText && data.tickerText !== led.key) {
      led.key = data.tickerText;
      const g = led.canvas.getContext('2d'); const W = led.canvas.width, H = led.canvas.height;
      g.fillStyle = '#05080d'; g.fillRect(0, 0, W, H);
      g.font = `600 ${H * 0.62}px ${FONT_M}`; g.textBaseline = 'middle';
      let x = 20; for (const [txt, col] of data.tickerText.split('\u241e').map((t) => t.split('\u241f'))) { g.fillStyle = col || '#9fe3b5'; g.fillText(txt, x, H / 2); x += g.measureText(txt).width + 60; if (x > W) break; }
      led.tex.needsUpdate = true;
    }
    if (data.meeting !== undefined) {
      meeting = data.meeting;
      const mk = JSON.stringify(meeting ? [meeting.id, meeting.phase, meeting.lines.length, meeting.focus, meeting.decisions.length] : null);
      if (mk !== meetingKey) { meetingKey = mk; drawWarScreen(meeting); }
      syncMeeting();
    }
    lastData = data;
    if (current.mode === 'workflow') { for (const h of (data.recentHandoffs || []).slice(0, 12)) addArc(h, { persistent: true }); }
  };
  api.setMode = (mode, highlight = null) => {
    current.mode = mode; current.highlight = highlight;
    if (mode !== 'workflow') clearArcs((a) => a.persistent);
  };
  api.select = (id) => { current.selected = id; };
  api.setAmbient = (v) => { ambientOn = !!v; };
  // For tests on slow software rendering: advance walking by `sec` seconds.
  api.fastForward = (sec = 10) => { for (let t = 0; t < sec; t += 0.05) { if (meeting) syncMeeting(); for (const d of Object.values(desks)) if (d.walk) stepWalk(d, 0.05, t); } };
  // For tests: who is walking where, and the meeting as the floor sees it.
  api.debugWalks = () => ({ meeting: meeting && { phase: meeting.phase, live: meetingLive(), attendees: meeting.attendees, speaking: meeting.speaking }, walks: Object.values(desks).filter((d) => d.walk).map((d) => ({ id: d.id, kind: d.walk.kind, step: d.walk.i, of: d.walk.path.length, seated: !!d.walk.seated, back: d.walk.back, at: d.person.position.toArray().map((v) => +v.toFixed(1)) })) });
  // Redraw every canvas once the web fonts have loaded, so text isn't stuck in a fallback font.
  let lastData = null;
  document.fonts?.ready?.then(() => {
    for (const d of Object.values(desks)) d.screen.key = '';
    for (const c of Object.values(clusters)) if (c.sign) c.sign.key = '';
    for (const w of Object.values(walls)) w.key = '';
    for (const e of Object.values(execScreens)) e.key = '';
    led.key = ''; drawExecSign(); meetingKey = ''; drawWarScreen(meeting); drawWarSign(meetingLive() && meeting?.phase === 'in_session', true);
    if (lastData) api.update({ ...lastData, newHandoffs: [] });
  });

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
  let last = 0, running = true, t0 = performance.now(), lastSync = 0;
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
      if (desk.walk) { stepWalk(desk, dt, time); desk.person.getWorldPosition(desk.anchor); desk.anchor.y += 1.95; continue; }
      if (!desk.anchor.equals(desk.home)) desk.anchor.copy(desk.home);
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
    maybeBreak(time);
    if (time - lastSync > 0.5) { lastSync = time; if (meeting) syncMeeting(); }
    sky.update(time);
    if (!reducedMotion) { codeTex.offset.y = (time * 0.08) % 1; docTex.offset.y = (time * 0.02) % 1; vidTex.offset.x = (time * 0.05) % 1; led.tex.offset.x = (time * 0.012) % 1; }
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
    // Labels never pile on top of each other: each one is placed only where it doesn't overlap one already placed
    // (selected and urgent desks go first; then nearest). A crowded tag shrinks to name + status, or waits its turn.
    const placed = [];
    const overlaps = (x, y, w, h) => placed.some((b) => x < b.x + b.w + 4 && x + w + 4 > b.x && y < b.y + b.h + 3 && y + h + 3 > b.y);
    const size = (el) => { let s = el._size; if (!s || s.html !== el.dataset.h || s.mini !== el.classList.contains('mini')) { s = el._size = { w: el.offsetWidth, h: el.offsetHeight, html: el.dataset.h, mini: el.classList.contains('mini') }; } return s; };
    for (const [id, el] of Object.entries(labelEls.depts)) {
      const c = clusters[id]; const p = project(c.anchor, r);
      el.style.display = p.vis ? '' : 'none';
      if (p.vis) { el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`; const sz = size(el); placed.push({ x: p.x - sz.w / 2, y: p.y - sz.h, w: sz.w, h: sz.h }); }
    }
    if (labelEls.war) {
      const p = project(WAR_ANCHOR, r); const el = labelEls.war;
      el.style.display = p.vis ? '' : 'none';
      if (p.vis) { el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`; const sz = size(el); placed.push({ x: p.x - sz.w / 2, y: p.y - sz.h, w: sz.w, h: sz.h }); }
    }
    // Desk tags: close-up only (LOD), plus anything needing you or blocked when the room is small.
    let shown = 0;
    const prio = (id, d) => (current.selected === id ? -1e6 : 0) + (meeting?.speaking === id && d?.walk?.seated ? -1e5 : 0) + (d?.state?.needsYou || d?.state?.status === 'blocked' ? -1e4 : 0) + (d?.walk ? -1e3 : 0);
    const entries = Object.entries(labelEls.desks).map(([id, el]) => [id, el, desks[id], camPos.distanceTo(desks[id]?.anchor || camPos)]).sort((a, b) => (prio(a[0], a[2]) + a[3]) - (prio(b[0], b[2]) + b[3]));
    for (const [id, el, desk, dist] of entries) {
      const d = desk?.state; if (!d) { el.style.display = 'none'; continue; }
      const near = dist < 17 || (focusKey === 'exec' && d.dept === 'exec') || (focusKey === 'war' && desk.walk?.kind === 'meeting');
      const urgent = d.needsYou || d.status === 'blocked';
      const show = (near || (urgent && dist < 60) || (desk.walk?.kind === 'handoff' && dist < 60) || (meeting?.speaking === id && desk.walk?.seated && dist < 60) || current.selected === id || (focusKey === 'exec' && d.dept === 'exec')) && relevant(d) && shown < 40;
      const p = show ? project(desk.anchor, r) : null;
      if (!p || !p.vis) { el.style.display = 'none'; continue; }
      shown++;
      el.style.display = '';
      const inMtg = meetingLive() && meeting.attendees.includes(id);
      const wk = desk.walk ? (desk.walk.kind === 'break' ? `☕ Idle · on a ${desk.walk.label === 'coffee' ? 'coffee' : 'water'} break`
        : desk.walk.kind === 'meeting' ? (desk.walk.back ? '↩ Back to desk after the morning meeting' : !desk.walk.seated ? '→ Walking to the morning meeting' : meeting?.speaking === id ? `🗣 Speaking: ${speechOf(id)}` : meeting?.phase === 'wrap_up' ? 'Morning meeting · wrap-up' : 'In the morning meeting')
        : `📁 Handing off: ${desk.walk.label}`) : inMtg ? '🗣 In the morning meeting (from desk)' : '';
      const wkEl = el.querySelector('.wk'); if (wkEl && wkEl.textContent !== wk) wkEl.textContent = wk;
      el.classList.toggle('mini', !near && current.selected !== id);
      el.classList.toggle('sel', current.selected === id);
      let sz = size(el);
      if (overlaps(p.x - sz.w / 2, p.y - sz.h, sz.w, sz.h) && current.selected !== id) {
        el.classList.add('mini'); sz = size(el);
        if (overlaps(p.x - sz.w / 2, p.y - sz.h, sz.w, sz.h)) { el.style.display = 'none'; shown--; continue; }
      }
      placed.push({ x: p.x - sz.w / 2, y: p.y - sz.h, w: sz.w, h: sz.h });
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
