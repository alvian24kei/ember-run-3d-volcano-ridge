// Ember Run 3D: Volcano Ridge — game loop, screens, live play.
// A real 3D flight game: chase view behind a low-poly jet over a 3D volcano
// archipelago. Fly 10 rings, rescue 4 survivors, grab fuel, land on the
// Meridian strip. Static files only, no network.
import { World, EVENT_RING, EVENT_RESCUE, EVENT_FUEL, EVENT_HIT, EVENT_LANDED, EVENT_OVER, autopilot } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { stageShot } from './shots.js';
import { STEP, CRUISE_THROTTLE } from './config.js';

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = new Renderer(canvas);
const world = new World();
const input = new Input();
const audio = new Audio();

let screen = 'title'; // title | fly | pause | debrief
let throttle = CRUISE_THROTTLE;
let last = performance.now();
let acc = 0;
let best = 0;

function fit() {
  const w = Math.min(window.innerWidth, 1280);
  const h = Math.min(window.innerHeight, 720);
  renderer.resize(w, h);
}
window.addEventListener('resize', fit);
fit();

function setStatus(text) {
  if (status) status.textContent = text;
}

function startFlight() {
  world.reset();
  throttle = CRUISE_THROTTLE;
  screen = 'fly';
  audio.ensure();
  setStatus('Flying. Fly through the golden rings and rescue the survivors.');
}

input.onEnter = () => {
  if (screen === 'title' || screen === 'debrief') startFlight();
};
input.onPause = () => {
  if (screen === 'fly') screen = 'pause';
  else if (screen === 'pause') screen = 'fly';
};
input.onMute = () => audio.toggleMute();

// --- Screenshot mode: ?shot=start|play|rescue|end renders one fixed frame.
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  const staged = stageShot(shot, world);
  screen = staged.screen;
  renderer.render(world, screen, world.state.time);
  setStatus(`Screenshot scene: ${shot}.`);
} else {
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (screen === 'fly') {
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        const ctl = input.read(throttle);
        throttle = ctl.throttle;
        const events = world.step(STEP, ctl);
        if (events & EVENT_RING) audio.ring();
        if (events & EVENT_RESCUE) audio.rescue();
        if (events & EVENT_HIT) audio.hit();
        if (events & EVENT_FUEL) audio.blip(660, 0.12);
        if (events & EVENT_LANDED) {
          audio.land();
          best = Math.max(best, world.state.score);
          screen = 'debrief';
          setStatus(`Landed. Score ${world.state.score}.`);
        } else if (events & EVENT_OVER) {
          best = Math.max(best, world.state.score);
          screen = 'debrief';
          setStatus(`Flight over. Score ${world.state.score}.`);
        }
      }
      audio.setThrottle(throttle);
    }
    renderer.render(world, screen, world.state.time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
