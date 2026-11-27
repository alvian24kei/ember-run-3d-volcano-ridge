// Ember Run 3D: Volcano Ridge — tuning constants.
export const STEP = 1 / 60; // physics step, seconds
export const COURSE_LENGTH = 12000; // metres, runway at the far end
export const TIME_LIMIT = 300; // seconds per flight
export const SEA_LEVEL = 0;
export const RING_RADIUS = 55;
export const MAX_FUEL = 100;
export const MAX_DAMAGE = 100;

// Speeds in knots (1 kt = 0.51444 m/s); altitudes in feet (1 ft = 0.3048 m).
export const MIN_SPEED_KT = 95;
export const MAX_SPEED_KT = 265;
export const CRUISE_THROTTLE = 0.72;
export const TURN_RATE = 0.55; // rad/s at full bank
export const CLIMB_RATE = 0.5; // rad/s of pitch authority
export const FUEL_BURN = 0.32; // %/s at full throttle
export const TERRAIN_HIT_DAMAGE = 12;
export const KT_TO_MS = 0.51444;
export const M_TO_FT = 3.28084;
