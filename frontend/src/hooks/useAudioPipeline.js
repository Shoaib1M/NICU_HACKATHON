/**
 * src/hooks/useAudioPipeline.js — NICU Guardian
 *
 * Orchestrates the complete audio analysis loop (Feature 1):
 *
 *  1. Request microphone via getUserMedia({ sampleRate: 16000 })
 *  2. Build Web Audio graph: MediaStreamSource → AnalyserNode → ScriptProcessor
 *  3. Accumulate PCM samples at 16kHz in a rolling 5-second buffer
 *  4. Every 500ms:
 *       a. Estimate dB from AnalyserNode frequency data
 *       b. Run YAMNet on the last 0.96s of PCM (15,360 samples)
 *       c. Extract cry / alarm / ambient probabilities
 *       d. Optionally refine with custom NICU classifier head
 *       e. Compute + smooth stress index
 *       f. Send audio_frame to backend via /ws/audio
 *  5. Expose { stressIndex, classifications, dbLevel, trend, isRunning, start, stop }
 *
 * Audio frame schema (matches AudioFrame in backend/database/schemas.py):
 * {
 *   type:                "audio_frame",
 *   timestamp:           ISO 8601,
 *   incubator_id:        string,
 *   db_level:            number,
 *   classifications:     { cry, alarm, ambient },
 *   mic_channels:        [number],        ← per-mic RMS (for TDOA — F6)
 *   infant_motion_score: number,          ← injected from visual pipeline (F8)
 * }
 */

import { useState, useRef, useCallback, useEffect } from 'react';

import { computeStressIndex, stressLabel, stressColor, pushSmooth, stressTrend } from '../utils/stressIndex';
import { loadYAMNet, runYAMNet, extractNICUClasses, computeRMS, rmsToDB } from '../models/yamnet_loader';
import { loadNICUClassifier, classifyEmbeddings } from '../models/nicu_classifier';
import { recordAlarm, clearBayHistory } from '../utils/alarmFatigue';
import { useWebSocket } from './useWebSocket';

// ── constants ─────────────────────────────────────────────────────────────────

const TARGET_SR  = 16000;                   // YAMNet requires 16kHz
const FRAME_MS   = 500;                     // analysis interval
const YAMNET_WIN = Math.floor(TARGET_SR * 0.96); // YAMNet minimum input ~15,360 samples
const PCM_CAP    = TARGET_SR * 5;           // keep last 5 seconds
const SMOOTH_WIN = 5;                       // moving-average window size

// ── hook ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} [incubatorId='BAY_03']
 * @returns {{
 *   stressIndex:     number,
 *   classifications: { cry: number, alarm: number, ambient: number },
 *   dbLevel:         number,
 *   trend:           'rising' | 'falling' | 'stable',
 *   isRunning:       boolean,
 *   start:           () => Promise<void>,
 *   stop:            () => void,
 *   error:           string | null,
 * }}
 */
export function useAudioPipeline(incubatorId = 'BAY_03') {
  const [stressIndex,     setStressIndex]     = useState(0);
  const [classifications, setClassifications] = useState({ cry: 0, alarm: 0, ambient: 0 });
  const [dbLevel,         setDbLevel]         = useState(0);
  const [trend,           setTrend]           = useState('stable');
  const [isRunning,       setIsRunning]       = useState(false);
  const [error,           setError]           = useState(null);

  // Model refs (loaded once, persist across renders)
  const yamnetRef     = useRef(null);
  const classifierRef = useRef(null);

  // Web Audio refs
  const audioCtxRef   = useRef(null);
  const streamRef     = useRef(null);
  const analyserRef   = useRef(null);
  const processorRef  = useRef(null);

  // Data refs
  const pcmBuf        = useRef([]);   // rolling PCM buffer
  const smoothBuf     = useRef([]);   // stress smoothing buffer
  const classBuf      = useRef([]);   // classification smoothing buffer
  const timerRef      = useRef(null);

  // Latest motion score from visual pipeline — updated externally via ref
  const motionRef     = useRef(0);

  // WebSocket to backend /ws/audio (send only — no callback needed)
  const { send: sendFrame, status: wsStatus } = useWebSocket('/ws/audio', () => {}, true);

  // ── model pre-load ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadYAMNet()
      .then(m => { yamnetRef.current = m; })
      .catch(err => console.error('YAMNet failed to load:', err));
    loadNICUClassifier()
      .then(m => { classifierRef.current = m; })
      .catch(err => console.error('NICU Classifier failed to load:', err));
  }, []);

  // ── per-interval analysis ──────────────────────────────────────────────────
  const analyse = useCallback(async () => {
    if (!yamnetRef.current || !analyserRef.current) return;

    // 1. Grab latest PCM chunk
    const pcm = Float32Array.from(pcmBuf.current.slice(-YAMNET_WIN));
    if (pcm.length < YAMNET_WIN) return; // buffer not full yet

    // 2. dB level from real PCM RMS (BUG 2a FIX)
    const rms = computeRMS(pcm);
    const db = rmsToDB(rms);
    setDbLevel(db);

    // 3. YAMNet inference
    const { scores, embeddings } = await runYAMNet(pcm, yamnetRef.current);

    // BUG 2a FIX: Log raw top-5 AudioSet class scores so we can see what it detects
    const top5 = Array.from(scores)
      .map((score, index) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    console.log(`🎙️ YAMNet Top 5:`, top5.map(t => `#${t.index} (${(t.score*100).toFixed(1)}%)`).join(' | '));

    // 4. Class probabilities — prefer fine-tuned classifier if available
    let clf = extractNICUClasses(scores);
    if (classifierRef.current) {
      const refined = await classifyEmbeddings(embeddings, classifierRef.current);
      if (refined) {
        // Blend 60% fine-tuned / 40% YAMNet
        clf = {
          cry:     +(0.6 * refined.cry     + 0.4 * clf.cry    ).toFixed(4),
          alarm:   +(0.6 * refined.alarm   + 0.4 * clf.alarm  ).toFixed(4),
          ambient: +(0.6 * refined.ambient + 0.4 * clf.ambient).toFixed(4),
        };
      }
    }

    // BUG 2a FIX: Smooth classifications over the last 4 frames
    classBuf.current.push(clf);
    if (classBuf.current.length > 4) classBuf.current.shift();
    
    const avgClf = { cry: 0, alarm: 0, ambient: 0 };
    for (const c of classBuf.current) {
      avgClf.cry += c.cry;
      avgClf.alarm += c.alarm;
      avgClf.ambient += c.ambient;
    }
    const bufLen = classBuf.current.length;
    avgClf.cry = +(avgClf.cry / bufLen).toFixed(4);
    avgClf.alarm = +(avgClf.alarm / bufLen).toFixed(4);
    avgClf.ambient = +(avgClf.ambient / bufLen).toFixed(4);

    setClassifications(avgClf);

    // 5. Stress index
    const raw     = computeStressIndex({ dbLevel: db, cryProb: avgClf.cry, alarmProb: avgClf.alarm, ambientPenalty: avgClf.ambient, motionScore: motionRef.current });
    const smooth  = pushSmooth(smoothBuf.current, raw, SMOOTH_WIN);
    const t       = stressTrend(smoothBuf.current);
    setStressIndex(smooth);
    setTrend(t);

    // Feature 5 — alarm fatigue check (alarm class only)
    if (avgClf.alarm > 0.3) {
      const fatigue = recordAlarm(incubatorId, 'alarm', smooth);
      if (fatigue) console.warn(`⚠️ Alarm fatigue detected — ${incubatorId}`);
    }

    // Clear bay history when stress normalises
    if (smooth < 40) clearBayHistory(incubatorId);

    // 6. Send audio frame to backend
    sendFrame({
      type:                'audio_frame',
      timestamp:           new Date().toISOString(),
      incubator_id:        incubatorId,
      db_level:            db,
      classifications:     avgClf,
      mic_channels:        [db],          // single-mic; expand for TDOA (F6)
      infant_motion_score: motionRef.current,
    });

  }, [incubatorId, sendFrame]);

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (isRunning) return;
    setError(null);

    try {
      // Request mic
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: TARGET_SR, channelCount: 1, echoCancellation: false, noiseSuppression: false },
      });

      // Web Audio graph
      audioCtxRef.current = new AudioContext({ sampleRate: TARGET_SR });
      await audioCtxRef.current.resume(); // Ensure it's running after async await
      
      const src  = audioCtxRef.current.createMediaStreamSource(streamRef.current);
      const ana  = audioCtxRef.current.createAnalyser();
      ana.fftSize = 2048;
      analyserRef.current = ana;

      // ScriptProcessor captures raw PCM (fine for a hackathon demo)
      const proc = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = ({ inputBuffer }) => {
        const samples = Array.from(inputBuffer.getChannelData(0));
        pcmBuf.current = [...pcmBuf.current, ...samples].slice(-PCM_CAP);
      };
      processorRef.current = proc;

      src.connect(ana);
      src.connect(proc);
      proc.connect(audioCtxRef.current.destination);

      setIsRunning(true);
      timerRef.current = setInterval(analyse, FRAME_MS);
      console.log('🎙️  Audio pipeline started —', incubatorId);

    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission denied. Allow mic access and try again.'
        : err.message;
      setError(msg);
      console.error('Audio pipeline error:', err);
    }
  }, [isRunning, analyse, incubatorId]);

  // ── stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    pcmBuf.current    = [];
    smoothBuf.current = [];
    classBuf.current  = [];
    setIsRunning(false);
    setStressIndex(0);
    console.log('🎙️  Audio pipeline stopped');
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  // Public: allow visual pipeline to inject motion score
  const setMotionScore = useCallback((score) => { motionRef.current = score; }, []);

  return { stressIndex, classifications, dbLevel, trend, isRunning, start, stop, error, setMotionScore };
}
