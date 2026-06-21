/**
 * src/models/yamnet_loader.js — NICU Guardian
 *
 * Loads YAMNet from TensorFlow.js and exposes helpers for NICU audio classification.
 *
 * YAMNet outputs:
 *   scores     — Float32Array[521]  AudioSet class probabilities (averaged across frames)
 *   embeddings — Float32Array[1024] per-frame embeddings (averaged across frames)
 *
 * We use scores directly to extract NICU-relevant classes,
 * and embeddings as input to the custom NICU classifier head.
 *
 * Model source:
 *   https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1
 *   (loaded via the TF Hub proxy path below)
 */

import * as tf from '@tensorflow/tfjs';

const YAMNET_URL =
  'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';

// ── AudioSet class indices that matter for NICU ────────────────────────────
//
// Full list: https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
// Indices verified against the 521-class AudioSet ontology.

const NICU_CLASS_MAP = {
  cry: [
    18,   // Baby cry, infant cry
    19,   // Crying, sobbing
    20,   // Whimper
    21,   // Wail, moan
  ],
  alarm: [
    377,  // Alarm
    378,  // Beep, bleep
    399,  // Smoke detector, smoke alarm
    400,  // Fire alarm
    392,  // Siren
    393,  // Civil defense siren
    394,  // Buzzer
  ],
  speech: [
    0,    // Speech
    1,    // Male speech, man speaking
    2,    // Female speech, woman speaking
    3,    // Child speech, kid speaking
  ],
};

let _yamnet = null;

/**
 * Load YAMNet (cached after first call).
 * @returns {Promise<tf.GraphModel>}
 */
export async function loadYAMNet() {
  if (_yamnet) return _yamnet;

  console.log('⏳ Loading YAMNet from TF Hub…');
  _yamnet = await tf.loadGraphModel(YAMNET_URL, { fromTFHub: true });
  console.log('✅ YAMNet loaded:', _yamnet.inputs[0]);
  return _yamnet;
}

/**
 * Run YAMNet inference on a 16kHz mono Float32Array waveform.
 *
 * @param {Float32Array} waveform  16kHz mono PCM samples
 * @param {tf.GraphModel} model    Loaded YAMNet model
 * @returns {Promise<{ scores: number[], embeddings: number[] }>}
 */
export async function runYAMNet(waveform, model) {
  const { scores: scoresT, embeddings: embT } = await tf.tidy(() => {
    const input    = tf.tensor1d(waveform);
    const output   = model.predict(input);

    // YAMNet returns [scores[frames, 521], embeddings[frames, 1024], spectrogram]
    const scoresArr = Array.isArray(output) ? output[0] : output;
    const embArr    = Array.isArray(output) ? output[1] : null;

    return {
      scores:     scoresArr.mean(0),   // average across frames → [521]
      embeddings: embArr ? embArr.mean(0) : tf.zeros([1024]),  // [1024]
    };
  });

  const scores     = Array.from(await scoresT.data());
  const embeddings = Array.from(await embT.data());

  scoresT.dispose();
  embT.dispose();

  return { scores, embeddings };
}

/**
 * Extract NICU-relevant class probabilities from raw 521-dim YAMNet scores.
 *
 * @param {number[]} scores  521-dim probability vector
 * @returns {{ cry: number, alarm: number, ambient: number }}
 */
export function extractNICUClasses(scores) {
  const pick = (indices) => Math.max(0, ...indices.map(i => scores[i] ?? 0));

  const cry    = pick(NICU_CLASS_MAP.cry);
  const alarm  = pick(NICU_CLASS_MAP.alarm);
  const speech = pick(NICU_CLASS_MAP.speech);

  // Ambient = residual energy not captured by key classes
  const dominated = Math.max(cry, alarm, speech);
  const ambient   = Math.max(0, 1 - dominated);

  // Normalise to sum = 1
  const total = (cry + alarm + ambient) || 1;

  return {
    cry:     +((cry    / total).toFixed(4)),
    alarm:   +((alarm  / total).toFixed(4)),
    ambient: +((ambient / total).toFixed(4)),
  };
}

/**
 * Compute RMS energy from a PCM buffer (used for dB estimation).
 * @param {Float32Array} samples
 * @returns {number}  RMS in [0, 1]
 */
export function computeRMS(samples) {
  if (!samples.length) return 0;
  const sumSq = samples.reduce((acc, s) => acc + s * s, 0);
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Convert RMS to approximate dB SPL.
 * @param {number} rms  [0, 1]
 * @returns {number}  dB, roughly in the range 30–90
 */
export function rmsToDB(rms) {
  if (rms <= 0) return 30;
  const db = 20 * Math.log10(Math.max(rms, 1e-9)) + 90;
  return Math.round(Math.max(30, Math.min(90, db)));
}
