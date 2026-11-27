// Screenshot scenes behind ?shot=start|play|rescue|end. Each one plays the
// real rules forward from a fresh world for a fixed time, steered by the
// autopilot, so the frame is what a short game really looks like and the
// same seed always gives the same frame.
import { STEP } from './config.js';
import { EVENT_OVER, EVENT_LANDED } from './world.js';
import { autopilot } from './world.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 62;
const RESCUE_SECONDS = 30;
const END_LIMIT_SECONDS = 900;

/**
 * Set `world` to the named scene (start, play, rescue or end; any other name
 * is start) and return the screen to draw over it.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'rescue' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, autopilot(world));
    return { screen: 'title' };
  }
  let limit = PLAY_SECONDS;
  if (name === 'rescue') limit = RESCUE_SECONDS;
  if (name === 'end') limit = END_LIMIT_SECONDS;
  for (let i = 0; i < limit / STEP; i += 1) {
    const events = world.step(STEP, autopilot(world));
    if (events & EVENT_OVER) break;
    if (events & EVENT_LANDED) break;
    if (name === 'rescue' && world.state.rescues >= 1) break;
  }
  if (name === 'end') return { screen: 'debrief' };
  return { screen: 'fly' };
}
