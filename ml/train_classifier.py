"""
ml/train_classifier.py — NICU Guardian
Train the custom NICU classifier head on top of frozen YAMNet embeddings.

Architecture:
  Dense(1024 → 128, relu) → Dropout(0.3) → Dense(128 → 4, softmax)

Classes: cry | alarm | speech | ambient

Usage:
  # 1. Put labelled audio files in ml/data/raw/{class_name}/*.wav
  # 2. Run this script to extract embeddings and train the head
  python ml/train_classifier.py

Output:
  ml/models/nicu_classifier/  ← TF.js-compatible SavedModel
  Copy to:  frontend/public/models/nicu_classifier.json
"""

import os, json, argparse
import numpy as np
import tensorflow as tf
from pathlib import Path

# ── config ────────────────────────────────────────────────────────────────────

SAMPLE_RATE  = 16000
CLASSES      = ['cry', 'alarm', 'speech', 'ambient']
DATA_DIR     = Path(__file__).parent / 'data' / 'raw'
EMB_DIR      = Path(__file__).parent / 'data' / 'processed'
MODEL_DIR    = Path(__file__).parent / 'models' / 'nicu_classifier'

EPOCHS       = 30
BATCH_SIZE   = 32
LR           = 1e-4
VAL_SPLIT    = 0.2

# ── YAMNet embedding extraction ───────────────────────────────────────────────

def load_yamnet():
    import tensorflow_hub as hub
    print("Loading YAMNet from TF Hub…")
    return hub.load('https://tfhub.dev/google/yamnet/1')

def audio_to_embedding(yamnet, wav_path: Path) -> np.ndarray:
    """Load a WAV file and return its mean YAMNet embedding (1024-dim)."""
    import soundfile as sf
    audio, sr = sf.read(str(wav_path))
    if sr != SAMPLE_RATE:
        raise ValueError(f"{wav_path.name}: expected {SAMPLE_RATE} Hz, got {sr} Hz")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)   # stereo → mono
    audio = audio.astype(np.float32)
    _, embeddings, _ = yamnet(audio)
    return embeddings.numpy().mean(axis=0)   # [1024]

def extract_all_embeddings(yamnet):
    """Extract embeddings from all raw audio files. Cache results."""
    EMB_DIR.mkdir(parents=True, exist_ok=True)
    X, y = [], []

    for cls_idx, cls_name in enumerate(CLASSES):
        cls_dir = DATA_DIR / cls_name
        if not cls_dir.exists():
            print(f"  ⚠️  No data found for class '{cls_name}' — skipping")
            continue
        wavs = list(cls_dir.glob('*.wav'))
        print(f"  {cls_name}: {len(wavs)} files")
        for wav in wavs:
            try:
                emb = audio_to_embedding(yamnet, wav)
                X.append(emb)
                y.append(cls_idx)
            except Exception as exc:
                print(f"    ✗ {wav.name}: {exc}")

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)

# ── model ─────────────────────────────────────────────────────────────────────

def build_model(num_classes: int = 4) -> tf.keras.Model:
    inputs = tf.keras.Input(shape=(1024,), name='embeddings')
    x = tf.keras.layers.Dense(128, activation='relu', name='fc1')(inputs)
    x = tf.keras.layers.Dropout(0.3, name='drop1')(x)
    outputs = tf.keras.layers.Dense(num_classes, activation='softmax', name='output')(x)
    model = tf.keras.Model(inputs, outputs, name='nicu_classifier')
    model.compile(
        optimizer=tf.keras.optimizers.Adam(LR),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )
    return model

# ── training ──────────────────────────────────────────────────────────────────

def train():
    # 1. Extract embeddings
    print("\n── Extracting YAMNet embeddings ──────────────────────")
    yamnet = load_yamnet()
    X, y   = extract_all_embeddings(yamnet)

    if len(X) == 0:
        print("\n❌  No training data found.")
        print("    Add labelled WAV files to ml/data/raw/{cry,alarm,speech,ambient}/")
        return

    print(f"\nDataset: {len(X)} samples across {len(set(y))} classes")

    # 2. Build + train classifier head
    print("\n── Training NICU classifier head ─────────────────────")
    model = build_model(len(CLASSES))
    model.summary()

    callbacks = [
        tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(patience=3, factor=0.5),
    ]

    model.fit(
        X, y,
        epochs=EPOCHS, batch_size=BATCH_SIZE,
        validation_split=VAL_SPLIT,
        callbacks=callbacks,
    )

    # 3. Export to TF.js format
    print("\n── Exporting to TF.js ───────────────────────────────")
    # pyrefly: ignore [missing-import]
    import tensorflowjs as tfjs
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tfjs.converters.save_keras_model(model, str(MODEL_DIR))
    print(f"✅  Model saved to {MODEL_DIR}")
    print(f"    Copy to: frontend/public/models/")

    # 4. Save class map
    class_map = {str(i): cls for i, cls in enumerate(CLASSES)}
    with open(MODEL_DIR / 'class_map.json', 'w') as f:
        json.dump(class_map, f, indent=2)
    print(f"    Class map: {class_map}")

if __name__ == '__main__':
    train()
