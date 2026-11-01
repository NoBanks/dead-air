// All named constants from the design

export const FREQ_MIN = 520;        // kHz
export const FREQ_MAX = 1740;       // kHz
export const STATION_FREQ = 1714;   // kHz, always trusted
export const LOCK_THRESHOLD = 10;   // kHz, snap radius
export const DRAG_FACTOR = 0.3;     // kHz per pixel
export const LOCK_FADE_S = 1.2;     // seconds, static fade on lock
export const DUCK_DB = -10;         // dB, music reduction under voice
export const DUCK_ATTACK_S = 0.25;  // seconds
export const DUCK_RELEASE_S = 0.60; // seconds
export const PRELOAD_AHEAD_S = 20;  // seconds before segment end
export const RESYNC_INTERVAL_S = 60; // seconds between clock resyncs
export const DRIFT_THRESHOLD_MS = 250; // smooth vs. jump
