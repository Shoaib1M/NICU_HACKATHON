/**
 * src/models/nicu_classifier.js — NICU Guardian
 *
 * Custom lightweight classifier head trained on top of YAMNet's 1024-dim embeddings.
 * Fine-tuned on labelled NICU audio (cry / alarm / speech / ambient_silence).
 *
 * Architecture:
 *   Dense(1024 → 128, relu) → Dropout(0.3) → Dense(128 → 4, softmax)
 *
 * Weights: /public/models/nicu_classifier.json  (train with ml/train_classifier.py)
 *
 * Fallback:
 *   If the model file is not present, loadNICUClassifier() returns null and
 *   useAudioPipeline falls back to raw YAMNet class extraction.
 */

import * as tf from '@tensorflow/tfjs';

const MODEL_PATH  = '/models/nicu_classifier.json';
const CLASS_NAMES = ['cry', 'alarm', 'speech', 'ambient'];

let _model = null;

/**
 * Load the custom NICU classifier head (cached after first call).
 * Returns null if the weights file is not found — triggers YAMNet-only mode.
 * @returns {Promise<tf.LayersModel | null>}
 */
export async function loadNICUClassifier() {
  if (_model !== undefined) return _model;  // null = intentional fallback

  try {
    console.log('⏳ Loading NICU classifier head…');
    _model = await tf.loadLayersModel(MODEL_PATH);
    console.log('✅ NICU classifier loaded');
    return _model;
  } catch (err) {
    console.warn(
      '⚠️  NICU classifier not found — running in YAMNet-only mode.\n' +
      '    To train: run python ml/train_classifier.py\n' +
      `    Error: ${err.message}`
    );
    _model = null;
    return null;
  }
}

/**
 * Run the classifier on a 1024-dim YAMNet embedding vector.
 *
 * @param {number[]}       embeddings  1024-dim array from yamnet_loader.runYAMNet()
 * @param {tf.LayersModel} model       Loaded NICU classifier head
 * @returns {Promise<{ cry: number, alarm: number, speech: number, ambient: number } | null>}
 */
export async function classifyEmbeddings(embeddings, model) {
  if (!model) return null;

  const probsT = tf.tidy(() => {
    const input = tf.tensor2d([embeddings], [1, 1024]);
    return model.predict(input).squeeze();
  });

  const probs = Array.from(await probsT.data());
  probsT.dispose();

  return Object.fromEntries(
    CLASS_NAMES.map((name, i) => [name, +probs[i].toFixed(4)])
  );
}

/**
 * Build the classifier architecture in the browser (for export / fine-tuning demos).
 * Not used during normal inference — weights must be pre-trained via ml/train_classifier.py.
 *
 * @returns {tf.Sequential}
 */
export function buildClassifierModel() {
  const model = tf.sequential({
    name: 'nicu_classifier',
    layers: [
      tf.layers.dense({ name: 'fc1',      units: 128, activation: 'relu', inputShape: [1024] }),
      tf.layers.dropout({ name: 'drop1',  rate: 0.3 }),
      tf.layers.dense({ name: 'output',   units: CLASS_NAMES.length, activation: 'softmax' }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(1e-4),
    loss:      'categoricalCrossentropy',
    metrics:   ['accuracy'],
  });

  return model;
}
