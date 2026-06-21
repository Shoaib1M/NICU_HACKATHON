/**
 * src/utils/stressIndex.js — NICU Guardian
 *
 * Mirror of backend/services/stress_index.py
 * Used by the audio pipeline to compute stress locally before sending to the backend.
 *
 * Formula:
 *   StressIndex = (0.4 × NormDB) + (0.35 × CryProb) + (0.15 × AlarmProb) + (0.1 × AmbientPenalty)
 *
 * Visual fusion (Feature 8):
 *   high motion + high cry  → ×1.15   confirmed distress
 *   low  motion + high cry  → ×0.85   likely false positive
 */

const DB_MIN = 30;
const DB_MAX = 90;

const W = { db: 0.40, cry: 0.35, alarm: 0.15, ambient: 0.10 };

/**
 * Normalise a raw dB level to [0, 1].
 * @param {number} db
 * @returns {number}
 */
export function normalizeDB(db) {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return (clamped - DB_MIN) / (DB_MAX - DB_MIN);
}

/**
 * Compute live stress index.
 *
 * @param {{
 *   dbLevel:        number,
 *   cryProb:        number,
 *   alarmProb:      number,
 *   ambientPenalty: number,
 *   motionScore?:   number,
 * }} params
 * @returns {number}  0–100 integer
 */
export function computeStressIndex({ dbLevel, cryProb, alarmProb, ambientPenalty, motionScore = 0 }) {
  const normDB = normalizeDB(dbLevel);
  let index = (W.db * normDB + W.cry * cryProb + W.alarm * alarmProb + W.ambient * ambientPenalty) * 100;

  // Feature 8 — visual fusion modifier
  if (motionScore >= 0.5 && cryProb >= 0.5) {
    index *= 1.15;   // confirmed distress
  } else if (motionScore < 0.2 && cryProb >= 0.6) {
    index *= 0.85;   // likely false positive
  }

  return Math.round(Math.min(100, Math.max(0, index)));
}

/**
 * Human-readable label for a stress index value.
 * @param {number} index
 * @returns {'Calm' | 'Elevated' | 'Critical'}
 */
export function stressLabel(index) {
  if (index < 40) return 'Calm';
  if (index < 70) return 'Elevated';
  return 'Critical';
}

/**
 * Semantic colour for a stress index value.
 * @param {number} index
 * @returns {string}
 */
export function stressColor(index) {
  if (index < 40) return '#16a34a';
  if (index < 70) return '#d97706';
  return '#dc2626';
}

/**
 * Simple moving-average smoother over a rolling buffer.
 * Mutates the buffer in place (push + shift).
 *
 * @param {number[]} buffer   Mutable array acting as circular buffer
 * @param {number}   value    New reading to push
 * @param {number}   [window=5]
 * @returns {number}          Smoothed value
 */
export function pushSmooth(buffer, value, window = 5) {
  buffer.push(value);
  if (buffer.length > window) buffer.shift();
  const sum = buffer.reduce((a, b) => a + b, 0);
  return Math.round(sum / buffer.length);
}

/**
 * Derive trend from a stress buffer.
 * @param {number[]} buffer
 * @returns {'rising' | 'falling' | 'stable'}
 */
export function stressTrend(buffer) {
  if (buffer.length < 3) return 'stable';
  const delta = buffer.at(-1) - buffer[0];
  if (delta >  5) return 'rising';
  if (delta < -5) return 'falling';
  return 'stable';
}
