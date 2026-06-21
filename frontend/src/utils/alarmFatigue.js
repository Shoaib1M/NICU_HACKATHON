/**
 * src/utils/alarmFatigue.js — NICU Guardian (Feature 5)
 *
 * Client-side alarm fatigue detector.
 * Mirrors the logic in backend/services/alarm_fatigue.py.
 *
 * Rule: same alarm type fires > THRESHOLD times within WINDOW_MS
 *       without the stress index dropping back below 40 → fatigue detected.
 */

const THRESHOLD  = 3;
const WINDOW_MS  = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, number[]>} bay:alarmType → timestamps */
const _history = new Map();

/**
 * Record a new alarm event and check for fatigue.
 *
 * @param {string} bay
 * @param {string} alarmType   e.g. 'SpO2' | 'cry' | 'equipment'
 * @param {number} stressIndex Current stress index (0–100)
 * @returns {boolean}          true if alarm fatigue is detected
 */
export function recordAlarm(bay, alarmType, stressIndex) {
  const key = `${bay}:${alarmType}`;
  const now  = Date.now();

  // Prune events outside the window
  const times = (_history.get(key) || []).filter(t => now - t < WINDOW_MS);
  times.push(now);
  _history.set(key, times);

  // Fatigue: fired above threshold AND stress hasn't recovered (<40)
  return times.length >= THRESHOLD && stressIndex >= 40;
}

/**
 * Clear the history for a bay when stress normalises below 40.
 * Call this from the audio pipeline when stressIndex drops below 40.
 *
 * @param {string} bay
 */
export function clearBayHistory(bay) {
  for (const key of _history.keys()) {
    if (key.startsWith(`${bay}:`)) _history.delete(key);
  }
}

/**
 * Return how many times an alarm has fired in the current window.
 * @param {string} bay
 * @param {string} alarmType
 * @returns {number}
 */
export function alarmCount(bay, alarmType) {
  const key  = `${bay}:${alarmType}`;
  const now  = Date.now();
  const times = (_history.get(key) || []).filter(t => now - t < WINDOW_MS);
  return times.length;
}
