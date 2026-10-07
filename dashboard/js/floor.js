// The 3D trading floor. Purely visual + navigation: every control lives in the HTML panels.
// Modes: full (default on capable desktops), low (lower resolution, 30 fps, no idle motion), off (2D grid).
import * as THREE from 'three';
import { STATIONS } from './stations.js';

const FLOOR_STATIONS = STATIONS.filter((s) => !s.offFloor && s.id !== 'overview' && s.id !== 'approvals');

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

function screenCanvas(w = 512, h = 288) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function drawScreen(canvas, { title, accent, lines = [], big = null, sub = null }) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#0b111b'); grd.addColorStop(1, '#05080d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120,160,220,0.07)'; g.lineWidth = 1;
  for (let y = 0; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = accent; g.fillRect(0, 0, W, 6);
  g.fillStyle = '#dbe3ee'; g.font = '600 34px "Barlow Condensed", Arial Narrow, sans-serif'; g.textBaseline = 'top';
  g.fillText(String(title).toUpperCase(), 22, 20);
  let y = 72;
  if (big != null) {
    g.fillStyle = accent; g.font = '600 92px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText(String(big), 22, y - 6); y += 96;
    if (sub) { g.fillStyle = '#8592a5'; g.font = '500 22px "IBM Plex Mono", monospace'; g.fillText(sub, 24, y); y += 34; }
  }
  g.font = '500 24px "IBM Plex Mono", monospace';
  for (const [label, value, color] of lines) {
    if (y > H - 30) break;
    g.fillStyle = '#8592a5'; g.fillText(label, 24, y);
    g.fillStyle = color || '#dbe3ee'; const t = String(value); g.fillText(t, W - 24 - g.measureText(t).width, y);
    y += 36;
  }
}

export function createFloor({ canvas, labelsEl, onSelect, mode = 'full', reducedMotion = false, introDone = true }) {
  const low = mode === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070b');
  scene.fog = new THREE.Fog('#05070b', 30, 75);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight('#9fb8ff', '#05070b', 0.35));
  const key = new THREE.DirectionalLight('#cfe0ff', 0.8); key.position.set(-8, 20, 12); scene.add(key);

  // ---------- floor: polished dark stone + faint grid ----------
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#0a0d13', metalness: 0.75, roughness: 0.32 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const grid = new THREE.GridHelper(80, 80, '#13304f', '#0d1826'); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 5.7, 96), new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);

  const metal = new THREE.MeshStandardMaterial({ color: '#1b222d', metalness: 0.9, roughness: 0.28 });
  const glass = new THREE.MeshStandardMaterial({ color: '#7fa6d6', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.08 });
  const textures = [];
  const screen = (w, h, cw, ch) => {
    const c = screenCanvas(cw, ch); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    textures.push(tex); return { mesh: m, canvas: c, tex };
  };

  // ---------- display wall ----------
  const wall = screen(30, 7.5, 2048, 512);
  wall.mesh.position.set(0, 7.2, -22); scene.add(wall.mesh);
  const wallFrame = new THREE.Mesh(new THREE.BoxGeometry(30.8, 8.2, 0.4), metal); wallFrame.position.set(0, 7.2, -22.25); scene.add(wallFrame);
  for (const x of [-26, 26]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 30), new THREE.MeshStandardMaterial({ color: '#0b0f16', metalness: 0.6, roughness: 0.5 }));
    side.position.set(x, 7, -6); scene.add(side);
  }

  // ---------- executive console + "Needs your approval" ----------
  const exec = new THREE.Group();
  const desk = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 1.05, 48, 1, true, 0.6, Math.PI * 2 - 1.2), metal); desk.position.y = 0.55; exec.add(desk);
  const top = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.12, 8, 64, Math.PI * 2 - 1.2), new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#f2c14e', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }));
  top.rotation.x = Math.PI / 2; top.rotation.z = 0.6 + Math.PI; top.position.y = 1.1; exec.add(top);
  const needs = screen(6.4, 3.6, 1024, 576); needs.mesh.position.set(0, 4.4, 0); exec.add(needs.mesh);
  const needsBack = needs.mesh.clone(); needsBack.rotation.y = Math.PI; exec.add(needsBack);
  const halo = new THREE.PointLight('#f2c14e', 1.2, 12, 2); halo.position.set(0, 3, 0); exec.add(halo);
  exec.userData.station = 'approvals';
  scene.add(exec);

  // ---------- division stations on an arc ----------
  const stationObjs = {};
  const R = 13.5;
  FLOOR_STATIONS.forEach((s, i) => {
    const a = Math.PI * (0.12 + (0.76 * i) / (FLOOR_STATIONS.length - 1)) + Math.PI;  // arc behind/around the console
    const x = Math.cos(a) * R, z = Math.sin(a) * R * 0.85 - 2;
    const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, 0);
    const col = new THREE.Color(s.accent);
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 1.6), metal); base.position.y = 0.45; g.add(base);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: col })); strip.position.set(0, 0.92, 0.8); g.add(strip);
    const scr = screen(4.4, 2.5, 768, 432); scr.mesh.position.set(0, 2.6, -0.4); g.add(scr.mesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.7, 0.12), metal); frame.position.set(0, 2.6, -0.48); g.add(frame);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.2), glass); pane.position.set(0, 2.1, -1.1); g.add(pane);
    const light = new THREE.PointLight(col, low ? 0.6 : 1.0, 7, 2); light.position.set(0, 2.4, 1.6); g.add(light);
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: col })); pulse.position.set(1.9, 1.3, 0.5); g.add(pulse);
    g.userData.station = s.id;
    scene.add(g);
    stationObjs[s.id] = { group: g, screen: scr, pulse, light, accent: s.accent, anchor: new THREE.Vector3(x, 4.4, z) };
  });
  stationObjs.approvals = { group: exec, screen: needs, anchor: new THREE.Vector3(0, 6.6, 0), accent: '#f2c14e' };

  // ---------- labels (crisp HTML) ----------
  const labels = {};
  for (const [id, o] of Object.entries(stationObjs)) {
    const s = STATIONS.find((x) => x.id === id);
    const el = document.createElement('button'); el.className = 'label3d'; el.type = 'button';
    el.innerHTML = `${s.short}<span class="n"></span>`; el.style.borderTopColor = s.accent;
    el.addEventListener('click', () => onSelect(id));
    labelsEl.appendChild(el); labels[id] = el;
  }

  // ---------- camera ----------
  const OVERVIEW = { pos: new THREE.Vector3(0, 15, 25), look: new THREE.Vector3(0, 2.5, -4) };
  let cam = { pos: OVERVIEW.pos.clone(), look: OVERVIEW.look.clone() };
  let target = { pos: OVERVIEW.pos.clone(), look: OVERVIEW.look.clone() };
  let yaw = 0, zoom = 1;
  if (!introDone && !reducedMotion) { cam.pos.set(0, 40, 60); cam.look.set(0, 0, -20); }

  function focus(id) {
    const o = stationObjs[id];
    if (!o || id === 'overview' || id === 'setup') { target = { pos: OVERVIEW.pos.clone(), look: OVERVIEW.look.clone() }; }
    else if (id === 'approvals') {
      target = { pos: new THREE.Vector3(0, 6.2, 11), look: new THREE.Vector3(0, 4, 0) };
    } else {
      // Stand between the station and the console, facing the station's screen.
      const p = o.group.position.clone();
      const toCenter = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      target = { pos: p.clone().add(toCenter.multiplyScalar(8)).setY(4.6), look: new THREE.Vector3(p.x, 2.3, p.z) };
    }
    yaw = 0; zoom = 1;
    if (reducedMotion) { cam.pos.copy(target.pos); cam.look.copy(target.look); }
  }

  // ---------- interaction ----------
  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw, moved: false }; });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (moved) return;
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => { let o = h.object; while (o && !o.userData.station) o = o.parent; return o; });
    if (hit) { let o = hit.object; while (o && !o.userData.station) o = o.parent; onSelect(o.userData.station); }
  });
  canvas.addEventListener('pointermove', (e) => { if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; yaw = Math.max(-0.6, Math.min(0.6, drag.yaw + dx * 0.004)); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(1.5, zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });

  // ---------- resize / render loop ----------
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement); resize();

  let last = 0, running = true, agentsState = {};
  const v = new THREE.Vector3();
  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (low && t - last < 33) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    const k = reducedMotion ? 1 : 1 - Math.pow(0.0015, dt);
    cam.pos.lerp(target.pos, k); cam.look.lerp(target.look, k);
    const off = cam.pos.clone().sub(cam.look);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(zoom);
    if (!reducedMotion && !low) off.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(t / 9000) * 0.015);
    camera.position.copy(cam.look).add(off); camera.lookAt(cam.look);
    if (!reducedMotion) {
      halo.intensity = 1.0 + Math.sin(t / 700) * 0.25;
      for (const [id, o] of Object.entries(stationObjs)) if (o.pulse) {
        const st = agentsState[id];
        o.pulse.material.color.set(st === 'error' ? '#ff5d5d' : st === 'working' ? o.accent : '#2a3546');
        o.pulse.scale.setScalar(st === 'working' ? 1 + Math.sin(t / 220) * 0.25 : 1);
      }
    }
    renderer.render(scene, camera);
    const r = canvas.getBoundingClientRect();
    for (const [id, o] of Object.entries(stationObjs)) {
      v.copy(o.anchor).project(camera);
      const el = labels[id];
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = vis ? '' : 'none';
      if (vis) el.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) translate(-50%, -100%)`;
    }
  }
  for (const el of Object.values(labels)) { el.style.left = '0'; el.style.top = '0'; }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { const was = running; running = !document.hidden; if (running && !was) requestAnimationFrame(frame); });

  return {
    focus,
    camera: () => ({ yaw, zoom }),
    setCamera(p) { if (p) { yaw = p.yaw || 0; zoom = p.zoom || 1; } },
    update(data) {
      drawScreen(wall.canvas, { title: 'KJ Agentic: live operations', accent: '#3aa0ff', lines: data.wall });
      drawScreen(needs.canvas, { title: 'Needs your approval', accent: '#f2c14e', big: data.approvals, sub: data.approvalsSub });
      for (const s of FLOOR_STATIONS) if (stationObjs[s.id]) drawScreen(stationObjs[s.id].screen.canvas, { title: s.short, accent: s.accent, lines: data.stations[s.id] || [] });
      textures.forEach((t) => { t.needsUpdate = true; });
      agentsState = data.agentState || {};
      for (const [id, el] of Object.entries(labels)) {
        el.querySelector('.n').textContent = data.labels[id] || '';
        el.classList.toggle('hot', id === 'approvals' && data.approvals > 0);
      }
    },
    destroy() { running = false; ro.disconnect(); renderer.dispose(); labelsEl.innerHTML = ''; },
  };
}
