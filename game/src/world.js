// Ember Run 3D: Volcano Ridge — the world: terrain, course, physics, scoring.
// Pure logic, no DOM: the same file runs in the browser and in Node for the
// autopilot verification flight.
import {
  STEP, COURSE_LENGTH, TIME_LIMIT, RING_RADIUS, MAX_FUEL, MAX_DAMAGE,
  MIN_SPEED_KT, MAX_SPEED_KT, TURN_RATE, CLIMB_RATE, FUEL_BURN,
  TERRAIN_HIT_DAMAGE, KT_TO_MS, CRUISE_THROTTLE,
} from './config.js';
import { noise2, mulberry32 } from './random.js';

export const EVENT_RING = 1;
export const EVENT_RESCUE = 2;
export const EVENT_FUEL = 4;
export const EVENT_HIT = 8;
export const EVENT_LANDED = 16;
export const EVENT_OVER = 32;

export const VOLCANO = { x: 300, z: 6500, height: 980, radius: 1900 };
export const RUNWAY = { x: 0, z: 11400, length: 900, width: 90 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// A few islands in the sea at the start of the course.
const ISLANDS = [
  { x: -1400, z: 1200, r: 700, h: 150 },
  { x: 1500, z: 2200, r: 850, h: 190 },
  { x: -1900, z: 3800, r: 600, h: 120 },
  { x: 2100, z: 4800, r: 750, h: 170 },
  { x: -1200, z: 9200, r: 650, h: 140 },
  { x: 1700, z: 10100, r: 700, h: 160 },
];

function gauss(x, z, cx, cz, r) {
  const dx = (x - cx) / r;
  const dz = (z - cz) / r;
  return Math.exp(-(dx * dx + dz * dz));
}

/** Terrain height in metres at (x, z). Deterministic, seed 1. */
export function terrainHeight(x, z) {
  // Rolling hills, two octaves of value noise.
  let h = 200 * noise2(x / 950, z / 950, 11) + 95 * noise2(x / 320, z / 320, 23);
  // The sea at the start of the course: mostly water, islands poking out.
  const sea = 1 - smoothstep(1800, 4200, z); // 1 near start, 0 inland
  h -= 150 * sea;
  for (const isl of ISLANDS) h += isl.h * gauss(x, z, isl.x, isl.z, isl.r);
  // The volcano: a big cone with a crater dip.
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  const cone = Math.max(0, 1 - dv / VOLCANO.radius);
  h += VOLCANO.height * cone * cone;
  h -= 130 * gauss(x, z, VOLCANO.x, VOLCANO.z, 260); // crater
  // Foothills rise toward the volcano and the far ridge.
  h += 120 * gauss(x, z, 0, 8500, 2600);
  h += 90 * gauss(x, z, -800, 10500, 1800);
  // Flat runway strip.
  const dr = Math.hypot(x - RUNWAY.x, z - RUNWAY.z);
  if (dr < 700) h = lerp(h, 34, 1 - smoothstep(350, 700, dr));
  return h;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Slope (rise over run) at a point, for shading and colour. */
export function terrainSlope(x, z) {
  const e = 30;
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

// --- Course: 10 rings winding past the volcano, 4 rescue beacons, 3 fuel cans.
function buildCourse() {
  const rng = mulberry32(7);
  const rings = [];
  const path = [
    [-500, 1400], [700, 2600], [-800, 3800], [500, 5000],
    [300, 6200], [-600, 7400], [800, 8600], [-400, 9600],
    [500, 10600], [0, 11200],
  ];
  // Ring height: well clear of the terrain below it (the volcano ring flies
  // over the crater, not through the mountain).
  for (const [x, z] of path) {
    const y = Math.max(150, terrainHeight(x, z) + 130);
    rings.push({ x, y, z, r: RING_RADIUS, done: false });
  }
  const beacons = [
    { x: -1400, z: 1200, done: false },
    { x: 1500, z: 2200, done: false },
    { x: -1200, z: 9200, done: false },
    { x: 1700, z: 10100, done: false },
  ];
  for (const b of beacons) b.y = terrainHeight(b.x, b.z) + 6;
  const cans = [];
  for (let i = 0; i < 3; i++) {
    const r = rings[2 + i * 3];
    cans.push({ x: r.x + 140, y: r.y + 30, z: r.z + 60, taken: false });
  }
  void rng;
  return { rings, beacons, cans };
}

export class World {
  constructor() {
    this.reset();
  }

  reset() {
    const c = buildCourse();
    this.rings = c.rings;
    this.beacons = c.beacons;
    this.cans = c.cans;
    // Objectives in course order (rings and beacons interleaved by position),
    // so the plane never has to fly back for a beacon it passed.
    this.objectives = [
      ...this.rings.map((r) => ({ kind: 'ring', obj: r })),
      ...this.beacons.map((b) => ({ kind: 'beacon', obj: b })),
    ].sort((a, b) => a.obj.z - b.obj.z);
    this.state = {
      x: 0, y: 150, z: -600, // start over the sea, heading north (+z)
      heading: 0, pitch: 0, bank: 0,
      speedKt: 150, throttle: CRUISE_THROTTLE,
      fuel: MAX_FUEL, damage: 0, score: 0,
      rings: 0, rescues: 0, combo: 0, comboTimer: 0, bestCombo: 0,
      time: 0, landed: false, over: false, crashed: false, hitCooldown: 0,
      message: '', messageTimer: 0,
    };
    this.events = 0;
  }

  nextObjective() {
    for (const o of this.objectives) {
      if (!o.obj.done) return { kind: o.kind, ...o.obj };
    }
    return { kind: 'runway', x: RUNWAY.x, y: 60, z: RUNWAY.z };
  }

  objectivesLeft() {
    return this.objectives.filter((o) => !o.obj.done).length;
  }

  step(dt, input) {
    const s = this.state;
    if (s.over || s.landed) return 0;
    let events = 0;
    s.time += dt;

    // --- controls: bank steers, pitch climbs/dives, throttle sets speed.
    const targetBank = clamp((input.bank ?? 0), -1, 1) * 0.9;
    s.bank += (targetBank - s.bank) * Math.min(1, dt * 6);
    s.heading += s.bank * TURN_RATE * dt;
    const targetPitch = clamp((input.pitch ?? 0), -1, 1) * 0.55;
    s.pitch += (targetPitch - s.pitch) * Math.min(1, dt * 4);
    s.throttle = clamp(input.throttle ?? s.throttle, 0, 1);
    const targetKt = MIN_SPEED_KT + (MAX_SPEED_KT - MIN_SPEED_KT) * s.throttle;
    s.speedKt += (targetKt - s.speedKt) * Math.min(1, dt * 0.5);
    const v = s.speedKt * KT_TO_MS;
    const fx = Math.sin(s.heading) * Math.cos(s.pitch);
    const fy = Math.sin(s.pitch);
    const fz = Math.cos(s.heading) * Math.cos(s.pitch);
    s.x += fx * v * dt;
    s.y += fy * v * dt;
    s.z += fz * v * dt;
    s.x = clamp(s.x, -4200, 4200);
    s.z = clamp(s.z, -900, COURSE_LENGTH + 800);

    // --- fuel, combo decay, messages.
    s.fuel = Math.max(0, s.fuel - FUEL_BURN * s.throttle * dt);
    if (s.comboTimer > 0) {
      s.comboTimer -= dt;
      if (s.comboTimer <= 0) s.combo = 0;
    }
    if (s.messageTimer > 0) s.messageTimer -= dt;

    // --- rings: crossing the ring plane inside the radius scores.
    // A ring flown past (150 m behind, still far away) is missed, not chased:
    // turning back for it would soft-lock the flight.
    for (const r of this.rings) {
      if (r.done) continue;
      if (r.z - s.z < -150 && Math.hypot(s.x - r.x, s.y - r.y, s.z - r.z) > 120) {
        r.done = true;
        s.message = 'RING MISSED';
        s.messageTimer = 1.5;
        continue;
      }
      const dx = s.x - r.x, dy = s.y - r.y, dz = s.z - r.z;
      if (Math.hypot(dx, dy, dz) < r.r) {
        r.done = true;
        s.rings += 1;
        this.chain(1000, 'RING +1000');
        events |= EVENT_RING;
      }
    }
    // --- beacons: fly low and close to pick up a survivor.
    for (const b of this.beacons) {
      if (b.done) continue;
      if (b.z - s.z < -150 && Math.hypot(s.x - b.x, s.z - b.z) > 120) {
        b.done = true;
        s.message = 'SURVIVOR MISSED';
        s.messageTimer = 1.5;
        continue;
      }
      const dx = s.x - b.x, dz = s.z - b.z;
      if (Math.hypot(dx, dz) < 70 && s.y < b.y + 120) {
        b.done = true;
        s.rescues += 1;
        this.chain(2500, 'SURVIVOR RESCUED +2500');
        events |= EVENT_RESCUE;
      }
    }
    // --- fuel cans.
    for (const can of this.cans) {
      if (can.taken) continue;
      if (Math.hypot(s.x - can.x, s.y - can.y, s.z - can.z) < 45) {
        can.taken = true;
        s.fuel = Math.min(MAX_FUEL, s.fuel + 45);
        s.message = 'FUEL +45%';
        s.messageTimer = 2;
        events |= EVENT_FUEL;
      }
    }

    // --- terrain: a hard hit damages the plane and bounces it up.
    // A 2 s grace period after a hit stops one scrape from killing the plane.
    const ground = terrainHeight(s.x, s.z);
    if (s.hitCooldown > 0) s.hitCooldown -= dt;
    if (s.y < ground + 12) {
      s.y = ground + 30;
      s.pitch = Math.max(s.pitch, 0.4);
      if (s.hitCooldown <= 0) {
        s.damage += TERRAIN_HIT_DAMAGE;
        s.hitCooldown = 2;
        s.combo = 0;
        s.message = 'TERRAIN HIT!';
        s.messageTimer = 1.5;
        events |= EVENT_HIT;
        if (s.damage >= MAX_DAMAGE) {
          s.over = true; s.crashed = true;
          events |= EVENT_OVER;
          return events;
        }
      }
    }
    // --- landing: on the runway, slow and low, once the course is done.
    const onStrip = Math.abs(s.x - RUNWAY.x) < RUNWAY.width / 2 && Math.abs(s.z - RUNWAY.z) < RUNWAY.length / 2;
    if (onStrip && s.y < 62 && s.speedKt < 150 && this.objectivesLeft() === 0) {
      s.landed = true;
      const fuelBonus = Math.round(s.fuel * 20);
      const timeBonus = Math.max(0, Math.round((TIME_LIMIT - s.time) * 10));
      s.score += 3000 + fuelBonus + timeBonus;
      events |= EVENT_LANDED;
      return events;
    }
    // --- out of fuel: glide, then the flight ends when the ground arrives.
    if (s.fuel <= 0) {
      s.throttle = 0;
      if (s.y <= ground + 13) {
        s.over = true; s.crashed = true;
        events |= EVENT_OVER;
        return events;
      }
    }
    if (s.time >= TIME_LIMIT) {
      s.over = true;
      events |= EVENT_OVER;
    }
    return events;
  }

  chain(points, message) {
    const s = this.state;
    s.combo = Math.min(5, s.combo + 1);
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    s.comboTimer = 8;
    const mult = s.combo;
    s.score += points * mult;
    s.message = mult > 1 ? `${message}  x${mult}` : message;
    s.messageTimer = 2;
  }

  altitudeFt() {
    return (this.state.y - terrainHeight(this.state.x, this.state.z)) * 3.28084;
  }
}

// --- Autopilot: aims at the next objective, stays clear of terrain.
export function autopilot(world) {
  const s = world.state;
  const obj = world.nextObjective();
  if (obj.kind === 'runway') {
    const dz = obj.z - s.z;
    // Glide down to the strip: 200 m out high, 52 m over the threshold.
    const wantAlt = dz > 3000 ? 220 : 52 + (dz / 3000) * 168;
    const dx = obj.x - s.x;
    const wantHeading = Math.atan2(dx, Math.max(50, dz));
    let dh = wantHeading - s.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return {
      pitch: clamp((wantAlt - s.y) / 120, -1, 1),
      bank: clamp(dh * 2.2, -1, 1),
      throttle: 0.3,
    };
  }
  const dx = obj.x - s.x;
  const dz = obj.z - s.z;
  const wantHeading = Math.atan2(dx, Math.max(1, dz));
  let dh = wantHeading - s.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  // Highest terrain between plane and target, plus margin.
  let top = 0;
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8;
    top = Math.max(top, terrainHeight(s.x + dx * t, s.z + dz * t));
  }
  // Close in, the terrain ahead is already behind us: fly the objective.
  const dist = Math.hypot(dx, dz);
  const wantAlt = dist < 600 ? obj.y + 20 : Math.max(obj.y + 20, top + 140);
  // Lateral offset of the target from the current heading, for tracking.
  const lateral = dx * Math.cos(s.heading) - dz * Math.sin(s.heading);
  return {
    pitch: clamp((wantAlt - s.y) / 150, -1, 1),
    bank: clamp(dh * 2.5 + lateral / 250, -1, 1),
    throttle: 0.8,
  };
}
