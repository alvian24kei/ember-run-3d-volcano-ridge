// Ember Run 3D: Volcano Ridge — software 3D renderer on Canvas 2D.
// Own projection code, no libraries, no network: terrain mesh, volcano,
// rings, beacons, a low-poly jet in chase view, dusk sky, HUD.
import { terrainHeight, terrainSlope, VOLCANO, RUNWAY } from './world.js';
import { noise2, mulberry32 } from './random.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- vector helpers (plain arrays [x, y, z]).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Terrain colour by height, slope and volcano proximity. Returns a hex string;
// the caller applies the final brightness shading once.
function terrainColor(x, z, h) {
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  const n = noise2(x / 170, z / 170, 41);
  if (h < 2) return shade('#175d7a', 0.85 + n * 0.3); // sea
  if (dv < 1300 && h > 420) {
    if (dv < 380 && n > 0.55) return shade('#ff6a1a', 0.9 + n * 0.25); // lava near crater
    return shade('#3b2f2a', 0.8 + n * 0.35); // basalt
  }
  if (h < 26) return shade('#c9a86a', 0.9 + n * 0.2); // sand
  if (h < 320) return shade('#5d8a4a', 0.85 + n * 0.3); // grass
  if (h < 620) return shade('#8a7a5c', 0.85 + n * 0.3); // rock
  return shade('#9a9a9e', 0.9 + n * 0.2); // high rock
}

// Fixed clouds and embers, seeded once.
const clouds = [];
{
  const rng = mulberry32(99);
  for (let i = 0; i < 12; i += 1) {
    clouds.push({
      x: (rng() - 0.5) * 7000,
      y: 480 + rng() * 260,
      z: rng() * 12000,
      r: 260 + rng() * 320,
    });
  }
}
const embers = [];
{
  const rng = mulberry32(5);
  for (let i = 0; i < 90; i += 1) {
    embers.push({ x: (rng() - 0.5) * 3600, y: 40 + rng() * 480, z: rng() * 12000, s: 1 + rng() * 2 });
  }
}

// Low-poly jet, local coords: nose +z, wingspan 15 m, scaled up 1.7x at draw.
// The fuselage is a tapered diamond cross-section, so it reads from behind.
const JET_TRIS = [
  { v: [[0, 0.3, 7], [0, 1.3, -6], [-1.6, 0.1, -6]], c: '#f2f2f5' }, // fuselage top-left
  { v: [[0, 0.3, 7], [-1.6, 0.1, -6], [0, -0.9, -6]], c: '#c9c9cf' }, // fuselage left-bottom
  { v: [[0, 0.3, 7], [0, -0.9, -6], [1.6, 0.1, -6]], c: '#a9a9b0' }, // fuselage bottom-right
  { v: [[0, 0.3, 7], [1.6, 0.1, -6], [0, 1.3, -6]], c: '#e9e9ec' }, // fuselage right-top
  { v: [[0, 0.3, 7], [0, 1.1, 2.5], [0, 1.3, -6]], c: '#2b4a6b' }, // cockpit spine
  { v: [[-7.5, -0.3, -3.0], [0, -0.2, -0.5], [0, -0.2, -4.5]], c: '#d23c2e' }, // left wing, low, swept back
  { v: [[7.5, -0.3, -3.0], [0, -0.2, -4.5], [0, -0.2, -0.5]], c: '#d23c2e' }, // right wing, low, swept back
  { v: [[-2.6, 0.4, -6], [0, 0.6, -5.2], [0, 0.6, -6.2]], c: '#b03024' }, // tailplane left
  { v: [[2.6, 0.4, -6], [0, 0.6, -6.2], [0, 0.6, -5.2]], c: '#b03024' }, // tailplane right
  { v: [[0, 3.2, -5.5], [0, 0.8, -4.2], [0, 0.8, -6.2]], c: '#d23c2e' }, // tail fin
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 1280;
    this.H = 720;
  }

  resize(w, h) {
    this.W = w;
    this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  render(world, screen, time) {
    const { ctx, W, H } = this;
    const s = world.state;
    const fLen = (H / 2) / Math.tan((35 * Math.PI) / 180);

    // --- plane basis: forward / right / up (bank rolls right & up).
    const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
    const fwd = [sh * cp, sp, ch * cp];
    let right = [ch, 0, -sh];
    let up = cross(fwd, right);
    const cb = Math.cos(s.bank), sb = Math.sin(s.bank);
    // Right bank (bank > 0): right wing dips down.
    right = add(scale(right, cb), scale(up, -sb));
    up = cross(fwd, right);
    const pos = [s.x, s.y, s.z];

    // --- chase camera: behind and above the jet, looking ahead.
    const camPos = add(add(pos, scale(fwd, -34)), scale(up, 11));
    const look = add(add(pos, scale(fwd, 60)), scale(up, 2));
    const cf = norm(sub(look, camPos));
    let cr = norm(cross(cf, [0, 1, 0]));
    let cu = cross(cr, cf);
    const rb = s.bank * 0.55;
    const crb = Math.cos(rb), srb = Math.sin(rb);
    // Camera rolls with the plane: up gains a right component on a right bank.
    const cr2 = add(scale(cr, crb), scale(cu, -srb));
    const cu2 = add(scale(cr, srb), scale(cu, crb));
    cr = cr2;
    cu = cu2;

    const project = (p) => {
      const d = sub(p, camPos);
      const cx = dot(d, cr);
      const cy = dot(d, cu);
      const cz = dot(d, cf);
      if (cz < 15) return null; // near plane: keeps close quads from exploding
      return { x: W / 2 + (fLen * cx) / cz, y: H / 2 - (fLen * cy) / cz, d: cz };
    };

    // --- sky: dusk gradient, sun, horizon glow.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b1038');
    sky.addColorStop(0.42, '#5b2a63');
    sky.addColorStop(0.62, '#c65a3c');
    sky.addColorStop(0.72, '#f08a3c');
    sky.addColorStop(1, '#2a1a2e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Stars in the upper sky.
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i += 1) {
      const sx = (i * 317) % W;
      const sy = ((i * 191) % 200) + 8;
      ctx.fillRect(sx, sy, 2, 2);
    }
    // Low ember sun, west.
    const sunX = W * 0.8, sunY = H * 0.52;
    const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 190);
    glow.addColorStop(0, 'rgba(255,190,90,0.95)');
    glow.addColorStop(0.25, 'rgba(255,140,60,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34, 0, TAU);
    ctx.fill();

    // --- clouds (far, translucent).
    for (const c of clouds) {
      const p = project([c.x, c.y, c.z]);
      if (!p || p.d > 9000) continue;
      const r = (c.r * 0.7 * fLen) / p.d;
      ctx.fillStyle = 'rgba(255,200,180,0.10)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, TAU);
      ctx.fill();
    }

    // --- terrain mesh: quads around the camera, painter-sorted.
    const CELL = 300;
    const x0 = Math.max(-4200, Math.floor((camPos[0] - 3600) / CELL) * CELL);
    const x1 = Math.min(4200, camPos[0] + 3600);
    const z0 = Math.max(-900, Math.floor((camPos[2] - 1500) / CELL) * CELL);
    const z1 = Math.min(12800, camPos[2] + 6000);
    const quads = [];
    for (let gx = x0; gx < x1; gx += CELL) {
      for (let gz = z0; gz < z1; gz += CELL) {
        const corners = [
          [gx, terrainHeight(gx, gz), gz],
          [gx + CELL, terrainHeight(gx + CELL, gz), gz],
          [gx + CELL, terrainHeight(gx + CELL, gz + CELL), gz + CELL],
          [gx, terrainHeight(gx, gz + CELL), gz + CELL],
        ];
        const pts = corners.map(project);
        if (pts.some((p) => p === null)) continue;
        const depth = pts.reduce((a, p) => a + p.d, 0) / 4;
        const midH = (corners[0][1] + corners[2][1]) / 2;
        const slope = terrainSlope(gx + CELL / 2, gz + CELL / 2);
        const bright = clamp(1.05 - slope * 0.55, 0.55, 1.1);
        quads.push({ pts, depth, color: shade(terrainColor(gx + CELL / 2, gz + CELL / 2, midH), bright) });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);
    for (const q of quads) {
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.moveTo(q.pts[0].x, q.pts[0].y);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(q.pts[i].x, q.pts[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // --- volcano crater glow + lava streams.
    const crater = project([VOLCANO.x, terrainHeight(VOLCANO.x, VOLCANO.z) + 12, VOLCANO.z]);
    if (crater && crater.d < 9000 && crater.x > -300 && crater.x < W + 300 && crater.y > -300 && crater.y < H + 300) {
      const r = Math.min(240, (300 * fLen) / crater.d); // clamped: no half-screen glow
      const g = ctx.createRadialGradient(crater.x, crater.y, 2, crater.x, crater.y, r);
      g.addColorStop(0, 'rgba(255,110,20,0.9)');
      g.addColorStop(0.5, 'rgba(255,80,10,0.35)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(crater.x, crater.y, r, 0, TAU);
      ctx.fill();
    }
    // Lava streams down the cone (bright polylines, hugging the slope).
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * TAU + 0.6;
      const pts = [];
      for (let t = 0; t <= 1; t += 0.125) {
        const rr = 250 + t * 1500;
        const px = VOLCANO.x + Math.cos(a) * rr;
        const pz = VOLCANO.z + Math.sin(a) * rr;
        const p = project([px, terrainHeight(px, pz) + 6, pz]);
        if (p) pts.push(p);
      }
      if (pts.length > 1) {
        ctx.strokeStyle = 'rgba(255,110,20,0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }

    // --- runway strip.
    {
      const hw = RUNWAY.width / 2, hl = RUNWAY.length / 2;
      const corners = [
        [RUNWAY.x - hw, 36, RUNWAY.z - hl], [RUNWAY.x + hw, 36, RUNWAY.z - hl],
        [RUNWAY.x + hw, 36, RUNWAY.z + hl], [RUNWAY.x - hw, 36, RUNWAY.z + hl],
      ].map(project);
      if (corners.every((p) => p)) {
        ctx.fillStyle = '#3a3f45';
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#f5f5f5';
        ctx.lineWidth = 2;
        const c1 = project([RUNWAY.x, 37, RUNWAY.z - hl + 60]);
        const c2 = project([RUNWAY.x, 37, RUNWAY.z + hl - 60]);
        if (c1 && c2) {
          ctx.beginPath();
          ctx.moveTo(c1.x, c1.y);
          ctx.lineTo(c2.x, c2.y);
          ctx.stroke();
        }
      }
    }

    // --- rings: glowing circles facing along the course.
    for (const r of world.rings) {
      if (r.done) continue;
      const pts = [];
      for (let i = 0; i <= 20; i += 1) {
        const a = (i / 20) * TAU;
        // Ring plane faces the course direction (roughly +z with a tilt).
        const px = r.x + Math.cos(a) * r.r;
        const py = r.y + Math.sin(a) * r.r;
        const p = project([px, py, r.z + Math.sin(a) * 8]);
        if (p) pts.push(p);
      }
      if (pts.length < 4) continue;
      const pulse = 0.75 + 0.25 * Math.sin(time * 3 + r.z);
      ctx.strokeStyle = `rgba(255,170,0,${0.35 * pulse})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.strokeStyle = '#ffd23c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // --- rescue beacons: glowing columns + ground rings.
    for (const b of world.beacons) {
      if (b.done) continue;
      const base = project([b.x, b.y, b.z]);
      const top = project([b.x, b.y + 130, b.z]);
      if (!base || !top) continue;
      const grad = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
      grad.addColorStop(0, 'rgba(255,120,30,0.7)');
      grad.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(base.x, base.y, 7, 0, TAU);
      ctx.fill();
    }

    // --- fuel cans: small green cubes.
    for (const can of world.cans) {
      if (can.taken) continue;
      const p = project([can.x, can.y, can.z]);
      if (!p) continue;
      const r = clamp((26 * fLen) / p.d, 3, 26);
      ctx.fillStyle = '#37c978';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-r / 2, -r / 2, r, r);
      ctx.restore();
      ctx.fillStyle = '#0b3d22';
      ctx.font = `bold ${Math.max(10, r * 0.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('F', p.x, p.y);
    }

    // --- the jet, projected from its 3D model (scaled 1.3x so it reads).
    {
      const toWorld = (v) => add(add(add(pos, scale(right, v[0] * 1.3)), scale(up, v[1] * 1.3)), scale(fwd, v[2] * 1.3));
      const tris = JET_TRIS.map((t) => {
        const pts = t.v.map((v) => project(toWorld(v)));
        if (pts.some((p) => p === null)) return null;
        const depth = pts.reduce((a, p) => a + p.d, 0) / 3;
        return { pts, depth, c: t.c };
      }).filter(Boolean).sort((a, b) => b.depth - a.depth);
      for (const t of tris) {
        ctx.fillStyle = t.c;
        ctx.beginPath();
        ctx.moveTo(t.pts[0].x, t.pts[0].y);
        ctx.lineTo(t.pts[1].x, t.pts[1].y);
        ctx.lineTo(t.pts[2].x, t.pts[2].y);
        ctx.closePath();
        ctx.fill();
      }
      // Engine glow.
      const tail = project(toWorld([0, 0, -6]));
      if (tail) {
        ctx.fillStyle = 'rgba(255,170,60,0.9)';
        ctx.beginPath();
        ctx.arc(tail.x, tail.y, 3, 0, TAU);
        ctx.fill();
      }
    }

    // --- drifting embers.
    ctx.fillStyle = 'rgba(255,150,60,0.9)';
    for (const e of embers) {
      const ey = e.y + Math.sin(time * 0.7 + e.z) * 12;
      const p = project([e.x, ey, e.z]);
      if (!p || p.d > 1600) continue;
      const r = clamp((3 * fLen) / p.d, 0.8, 3.5);
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    }

    // --- HUD.
    this.drawHud(world, screen, time, project);
    if (screen === 'title') this.drawTitle(world);
    if (screen === 'debrief') this.drawDebrief(world);
    if (screen === 'pause') this.drawPause();
  }

  drawHud(world, screen, time, project) {
    const { ctx, W, H } = this;
    const s = world.state;
    ctx.textBaseline = 'alphabetic';
    // Top-left: speed / altitude.
    ctx.fillStyle = 'rgba(10,10,20,0.55)';
    ctx.fillRect(14, 14, 210, 86);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(s.speedKt)} KT`, 26, 48);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`${Math.round(world.altitudeFt())} FT`, 26, 80);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#ffd23c';
    ctx.fillText('AIRSPEED  •  ALTITUDE', 26, 96 - 4);
    // Top-right: score.
    ctx.fillStyle = 'rgba(10,10,20,0.55)';
    ctx.fillRect(W - 224, 14, 210, 86);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${s.score.toLocaleString()}`, W - 26, 48);
    ctx.font = '15px sans-serif';
    ctx.fillText(`RINGS ${s.rings}/10   RESCUED ${s.rescues}/4`, W - 26, 74);
    ctx.fillText(`TIME ${Math.max(0, 300 - Math.floor(s.time))}s`, W - 26, 94);
    // Bottom-left: fuel + damage bars.
    ctx.fillStyle = 'rgba(10,10,20,0.55)';
    ctx.fillRect(14, H - 78, 260, 64);
    ctx.fillStyle = '#8be28b';
    ctx.fillRect(26, H - 62, 150 * (s.fuel / 100), 12);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(26, H - 62, 150, 12);
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`FUEL ${Math.round(s.fuel)}%`, 184, H - 50);
    ctx.fillStyle = s.damage > 60 ? '#ff5a4a' : '#ffb347';
    ctx.fillRect(26, H - 38, 150 * (s.damage / 100), 12);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(26, H - 38, 150, 12);
    ctx.fillStyle = '#fff';
    ctx.fillText(`DMG ${Math.round(s.damage)}%`, 184, H - 26);
    // Combo.
    if (s.combo > 1) {
      ctx.fillStyle = '#ffd23c';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`COMBO x${s.combo}`, W / 2, 60);
    }
    // Centre message.
    if (s.messageTimer > 0) {
      ctx.fillStyle = '#ffd23c';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.message, W / 2, H * 0.3);
    }
    // Next-objective marker.
    const obj = world.nextObjective();
    if (obj && screen === 'fly') {
      const p = project([obj.x, obj.y, obj.z]);
      const label = obj.kind === 'ring' ? 'NEXT RING' : obj.kind === 'beacon' ? 'SURVIVOR' : 'RUNWAY — LAND!';
      const dist = Math.round(Math.hypot(obj.x - s.x, obj.y - s.y, obj.z - s.z));
      if (p && p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
        ctx.strokeStyle = '#ffd23c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 14);
        ctx.lineTo(p.x + 12, p.y);
        ctx.lineTo(p.x, p.y + 14);
        ctx.lineTo(p.x - 12, p.y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#ffd23c';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${label}  ${dist}m`, p.x, p.y - 22);
      } else {
        ctx.fillStyle = '#ffd23c';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`➤ ${label}  ${dist}m`, W / 2, H - 96);
      }
    }
    // Bottom hint.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Arrows / WASD fly  •  W/S throttle  •  P pause  •  M sound', W / 2, H - 12);
  }

  drawTitle() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(8,6,18,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('EMBER RUN 3D', W / 2, H * 0.32);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('VOLCANO RIDGE', W / 2, H * 0.32 + 44);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText('Fly the rescue jet through 10 golden rings, pick up 4 survivors,', W / 2, H * 0.52);
    ctx.fillText('grab fuel on the way — then land on the Meridian strip.', W / 2, H * 0.52 + 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Press ENTER to fly', W / 2, H * 0.68);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('Arrows / WASD steer  •  W/S throttle  •  P pause  •  M sound', W / 2, H * 0.68 + 30);
  }

  drawDebrief(world) {
    const { ctx, W, H } = this;
    const s = world.state;
    ctx.fillStyle = 'rgba(8,6,18,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold 44px sans-serif';
    const title = s.landed ? 'MISSION COMPLETE' : s.crashed ? 'PLANE DOWN' : 'TIME UP';
    ctx.fillText(title, W / 2, H * 0.26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(`SCORE  ${s.score.toLocaleString()}`, W / 2, H * 0.38);
    ctx.font = '19px sans-serif';
    ctx.fillStyle = '#ffd9a0';
    const lines = [
      `Rings flown  ${s.rings} / 10`,
      `Survivors rescued  ${s.rescues} / 4`,
      `Best combo  x${s.bestCombo}`,
      `Fuel left  ${Math.round(s.fuel)}%   •   Damage  ${Math.round(s.damage)}%`,
      `Flight time  ${Math.round(s.time)}s`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.48 + i * 30));
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Press ENTER to fly again', W / 2, H * 0.48 + lines.length * 30 + 26);
  }

  drawPause() {
    const { ctx, W, H } = this;
    ctx.fillStyle = 'rgba(8,6,18,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '18px sans-serif';
    ctx.fillText('Press P to continue', W / 2, H / 2 + 34);
  }
}
