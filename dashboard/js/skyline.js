// The view out of the windows: a Manhattan-style skyline seen from a high floor.
// Purely decorative scenery. It never shows data. Sky and window lights follow your local time of day.
//  * far layer: a panoramic painted skyline (sky gradient, distant towers, lit windows, a river haze) on a cylinder;
//  * near layer: real 3D towers outside the glass (most below our floor, a few taller), so the view shifts as you orbit;
//  * aviation lights blink on the tallest roofs.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function skyPhase(h = new Date().getHours() + new Date().getMinutes() / 60) {
  if (h >= 7.5 && h < 17) return 'day';
  if ((h >= 5.5 && h < 7.5) || (h >= 17 && h < 19.5)) return 'dusk';
  return 'night';
}
const SKY = {
  day:   { top: '#5f86b8', mid: '#9db8d6', low: '#cdd8e2', haze: '#aab6c2', tower: ['#5d6b7c', '#6f7c8c', '#4f5b69', '#7c8794'], lit: 0.08, win: '#e8e2c6', dark: '#3a4552' },
  dusk:  { top: '#1c2240', mid: '#7a4a6e', low: '#f08a4b', haze: '#c9785a', tower: ['#2a2a3c', '#33304a', '#24243a', '#3b3550'], lit: 0.45, win: '#ffd28a', dark: '#1b1b2a' },
  night: { top: '#03060d', mid: '#0b1630', low: '#1d2b4d', haze: '#2a3350', tower: ['#0d121c', '#111827', '#0a0f18', '#151c2a'], lit: 0.38, win: '#ffd99a', dark: '#070a10' },
};

/** Windows texture for the near towers (tiles every TILE world units). */
const TILE = 12;
function windowCanvas(sky, variant, seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'), r = rng(seed);
  const base = sky.tower[variant % sky.tower.length];
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const cols = [8, 6, 10, 5][variant % 4], rows = 14;
  const cw = 256 / cols, rh = 256 / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (x === 0 && y === rows - 1) continue;           // keep a dark corner for the roofs
    const lit = r() < sky.lit * (variant === 2 ? 1.4 : 1);
    g.fillStyle = lit ? sky.win : sky.dark;
    g.globalAlpha = lit ? 0.75 + r() * 0.25 : 0.85;
    g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.58);
  }
  g.globalAlpha = 1;
  // mullion lines
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < cols; x++) g.fillRect(x * cw, 0, 2, 256);
  return c;
}

/** The far painted panorama (wraps 360°). */
function panoramaCanvas(sky, seed) {
  const W = 4096, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rng(seed);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, sky.top); grd.addColorStop(0.42, sky.mid); grd.addColorStop(0.6, sky.low); grd.addColorStop(0.75, sky.haze); grd.addColorStop(1, sky.dark);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (sky === SKY.night) { for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; g.fillRect(r() * W, r() * H * 0.35, 1.5, 1.5); } }
  const horizon = H * 0.66;
  // Three layers of towers, farthest first (lighter, hazier).
  for (const [layer, alpha, maxH, wMin, wMax] of [[0, 0.55, 150, 18, 46], [1, 0.8, 230, 22, 60], [2, 1, 300, 26, 80]]) {
    let x = 0;
    while (x < W) {
      const w = wMin + r() * (wMax - wMin);
      let h = 30 + Math.pow(r(), 2.2) * maxH;
      // a couple of landmark-style spires per layer (generic shapes, not any specific building)
      const spire = layer === 2 && r() < 0.05;
      if (spire) h = maxH * 1.25;
      const col = new THREE.Color(sky.tower[(layer + Math.floor(r() * 4)) % 4]).lerp(new THREE.Color(sky.haze), (2 - layer) * 0.28);
      g.globalAlpha = alpha; g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(x, horizon - h, w, h + H);
      if (spire) {
        g.beginPath(); g.moveTo(x + w * 0.2, horizon - h); g.lineTo(x + w * 0.5, horizon - h - 70); g.lineTo(x + w * 0.8, horizon - h); g.fill();
        g.fillRect(x + w * 0.48, horizon - h - 120, 2, 52);
        g.fillStyle = '#ff3b30'; g.globalAlpha = 1; g.fillRect(x + w * 0.46, horizon - h - 122, 4, 4);
      } else if (r() < 0.35) {
        g.fillRect(x + w * 0.15, horizon - h - 10, w * 0.7, 10);   // setback
      }
      // windows
      const lit = sky.lit * (layer === 2 ? 1 : 0.8);
      for (let wy = horizon - h + 6; wy < horizon + 40; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        if (r() < lit) { g.globalAlpha = (0.35 + r() * 0.6) * alpha; g.fillStyle = sky.win; g.fillRect(wx, wy, 2, 3); }
      }
      x += w + (r() < 0.2 ? r() * 14 : 1);
    }
  }
  g.globalAlpha = 1;
  // river / street haze at the bottom
  const haze = g.createLinearGradient(0, horizon, 0, H);
  haze.addColorStop(0, 'rgba(0,0,0,0)'); haze.addColorStop(1, sky.dark);
  g.fillStyle = haze; g.fillRect(0, horizon, W, H - horizon);
  return c;
}

/** Box geometry with UVs scaled to world size, so windows keep their proportions on any tower. Roofs map to a dark corner. */
function towerGeometry(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
    const i = face * 4 + k;
    if (face === 2 || face === 3) { uv.setXY(i, 0.02, 0.02); continue; }
    const span = face < 2 ? d : w;
    uv.setXY(i, uv.getX(i) * span / TILE, uv.getY(i) * h / TILE);
  }
  return geo.toNonIndexed();
}
function merge(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/**
 * @param scene THREE scene
 * @param opts.low simplified mode (no near towers)
 * @param opts.keepOut {x0,x1,z0,z1} the office footprint (no towers inside it, plus a margin)
 */
export function buildSkyline(scene, { low = false, keepOut = { x0: -45, x1: 45, z0: -30, z1: 33 }, maxAniso = 4 } = {}) {
  const group = new THREE.Group(); group.name = 'skyline'; scene.add(group);
  const textures = [];
  let phase = skyPhase();
  const tex = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; textures.push(t); return t; };

  // Far panorama on a big open cylinder around everything.
  const pano = tex(panoramaCanvas(SKY[phase], 7)); pano.wrapS = THREE.RepeatWrapping;
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(420, 420, 560, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: pano, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false }));
  cyl.position.y = 10; cyl.renderOrder = -2; group.add(cyl);
  const capMat = new THREE.MeshBasicMaterial({ color: SKY[phase].top, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
  const cap = new THREE.Mesh(new THREE.CircleGeometry(420, 48), capMat); cap.rotation.x = Math.PI / 2; cap.position.y = 289; cap.renderOrder = -2; group.add(cap);
  const groundMat = new THREE.MeshBasicMaterial({ color: SKY[phase].dark, fog: false, toneMapped: false });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 48), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -260; group.add(ground);

  // Near towers: three materials, each one merged mesh. Bases far below our floor (we're high up).
  const near = [];
  const lights = [];
  if (!low) {
    const r = rng(42);
    const buckets = [[], [], []];
    const tops = [];
    const place = (x, z, w, d, top) => {
      if (x + w / 2 > keepOut.x0 && x - w / 2 < keepOut.x1 && z + d / 2 > keepOut.z0 && z - d / 2 < keepOut.z1) return;
      const h = top + 240;
      const g = towerGeometry(w, h, d); g.translate(x, top - h / 2, z);
      buckets[Math.floor(r() * 3)].push(g);
      if (top > 18) tops.push(new THREE.Vector3(x, top + 0.6, z));
    };
    // Blocks along a street grid on three sides of the office (left, right, behind). Towers in front of the camera
    // are kept low so they never hide the floor.
    for (let gx = -230; gx <= 230; gx += 26) for (let gz = -260; gz <= 90; gz += 24) {
      if (r() < 0.18) continue;                                   // avenues / open lots
      const x = gx + (r() - 0.5) * 6, z = gz + (r() - 0.5) * 6;
      const w = 9 + r() * 12, d = 9 + r() * 12;
      const dist = Math.hypot(x, z + 20);
      let top = -70 + Math.pow(r(), 1.6) * 95;                  // mostly below our floor (y=0)
      if (r() < 0.12) top = 20 + r() * 70;                        // a few taller neighbors
      if (z > 20) top = Math.min(top, -25);                        // nothing tall in front
      if (dist < 70) top = Math.min(top, 10 + r() * 25);
      place(x, z, w, d, top);
    }
    buckets.forEach((list, i) => {
      if (!list.length) return;
      const t = tex(windowCanvas(SKY[phase], i, 100 + i)); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const m = new THREE.Mesh(merge(list), new THREE.MeshBasicMaterial({ map: t, fog: false, toneMapped: false }));
      m.userData.variant = i; group.add(m); near.push(m);
    });
    // Red aviation lights on the tallest roofs.
    const redMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', fog: false, toneMapped: false, transparent: true });
    const dot = new THREE.SphereGeometry(0.55, 8, 6);
    for (const p of tops.sort((a, b) => b.y - a.y).slice(0, 14)) { const l = new THREE.Mesh(dot, redMat); l.position.copy(p); group.add(l); lights.push(l); }
    lights.mat = redMat;
  }

  function repaint() {
    const s = SKY[phase];
    pano.image = panoramaCanvas(s, 7); pano.needsUpdate = true;
    capMat.color.set(s.top); groundMat.color.set(s.dark);
    for (const m of near) { m.material.map.image = windowCanvas(s, m.userData.variant, 100 + m.userData.variant); m.material.map.needsUpdate = true; }
  }
  let lastCheck = 0;
  return {
    group,
    phase: () => phase,
    /** Call every frame with seconds since start. Blinks the roof lights; repaints when day turns to dusk or night. */
    update(time) {
      if (lights.mat) lights.mat.opacity = Math.sin(time * 2.2) > 0.2 ? 1 : 0.15;
      if (time - lastCheck > 60) { lastCheck = time; const p = skyPhase(); if (p !== phase) { phase = p; repaint(); } }
    },
    setPhase(p) { if (SKY[p] && p !== phase) { phase = p; repaint(); } },
    dispose() { textures.forEach((t) => t.dispose()); group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); scene.remove(group); },
  };
}
