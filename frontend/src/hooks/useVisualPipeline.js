/**
 * useVisualPipeline.js — NICU Guardian (Phase 3)
 *
 * Orchestrates the camera-based visual analysis loop:
 *
 *  1. Request webcam via getUserMedia({ video: true })
 *  2. Load MediaPipe PoseLandmarker (lite model via CDN WASM)
 *  3. Every ~1 second:
 *       a. Run pose detection on current video frame
 *       b. Count distinct skeletons → personCount
 *       c. Heuristic nurse detection → nursePresent
 *       d. Compute motionScore from frame-to-frame pixel variance
 *       e. Build skeleton positions array
 *       f. Send visual_frame to backend via /ws/visual
 *  4. Expose { personCount, nursePresent, motionScore, skeletons, isRunning, start, stop, videoRef, canvasRef }
 *
 * Visual frame schema (matches VisualFrame in backend/database/schemas.py):
 * {
 *   type:               "visual_frame",
 *   timestamp:          ISO 8601,
 *   incubator_id:       string,
 *   person_count:       number,
 *   nurse_present:      boolean,
 *   infant_motion_score: number,
 *   skeleton_positions: [{ x, y, confidence }]
 * }
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';

// ── constants ─────────────────────────────────────────────────────────────────

const ANALYSIS_INTERVAL_MS = 1000;  // run pose detection every 1s
const NURSE_ZONE_Y_MIN     = 0.2;   // nurse must have upper body in this Y range
const NURSE_ZONE_Y_MAX     = 0.8;
const MAX_OCCUPANCY        = 6;     // NICU guideline

// MediaPipe Tasks Vision CDN paths
const VISION_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const POSE_MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

// ── hook ──────────────────────────────────────────────────────────────────────

export function useVisualPipeline(incubatorId = 'BAY_03') {
  const [personCount,  setPersonCount]  = useState(0);
  const [nursePresent, setNursePresent] = useState(false);
  const [motionScore,  setMotionScore]  = useState(0);
  const [skeletons,    setSkeletons]    = useState([]);
  const [isRunning,    setIsRunning]    = useState(false);
  const [error,        setError]        = useState(null);

  // Refs
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const streamRef     = useRef(null);
  const landmarkerRef = useRef(null);
  const timerRef      = useRef(null);
  const prevFrameRef  = useRef(null); // for motion detection

  // WebSocket to backend /ws/visual
  const { send: sendFrame } = useWebSocket('/ws/visual', () => {}, true);

  // ── load MediaPipe PoseLandmarker ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadModel() {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { PoseLandmarker, FilesetResolver } = vision;

        const fileset = await FilesetResolver.forVisionTasks(VISION_WASM_CDN);

        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 10,            // detect up to 10 people
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!cancelled) {
          landmarkerRef.current = landmarker;
          console.log('✅ MediaPipe PoseLandmarker loaded');
        }
      } catch (err) {
        console.error('MediaPipe load error:', err);
        // Fallback: continue without pose detection (motion-only mode)
      }
    }

    loadModel();
    return () => { cancelled = true; };
  }, []);

  // ── per-interval analysis ──────────────────────────────────────────────────
  const analyse = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;

    // ── 1. Pose detection ─────────────────────────────────────────────────
    let poses = [];
    if (landmarkerRef.current) {
      try {
        const result = landmarkerRef.current.detectForVideo(video, performance.now());
        poses = result.landmarks || [];
      } catch (err) {
        // Pose detection can fail on some frames — skip silently
      }
    }

    // ── 2. Person count ───────────────────────────────────────────────────
    const count = poses.length;
    setPersonCount(count);

    // ── 3. Skeleton positions (for WebSocket + drawing) ───────────────────
    const skels = poses.map((landmarks) => {
      // Use nose landmark (index 0) as representative position
      const nose = landmarks[0];
      return {
        x: +(nose?.x ?? 0).toFixed(3),
        y: +(nose?.y ?? 0).toFixed(3),
        confidence: +(nose?.visibility ?? 0).toFixed(2),
      };
    });
    setSkeletons(skels);

    // ── 4. Nurse detection heuristic ──────────────────────────────────────
    // A "nurse" is someone with confident upper-body landmarks in the bay zone
    const nurse = poses.some((landmarks) => {
      const nose       = landmarks[0];
      const lShoulder  = landmarks[11];
      const rShoulder  = landmarks[12];
      if (!nose || !lShoulder || !rShoulder) return false;

      const avgConfidence = ((nose.visibility || 0) + (lShoulder.visibility || 0) + (rShoulder.visibility || 0)) / 3;
      const inZone = nose.y > NURSE_ZONE_Y_MIN && nose.y < NURSE_ZONE_Y_MAX;

      return avgConfidence > 0.6 && inZone;
    });
    setNursePresent(nurse);

    // ── 5. Motion score (pixel variance between frames) ───────────────────
    let motion = 0;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width  = video.videoWidth  || 320;
      canvas.height = video.videoHeight || 240;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data  = frame.data;

      if (prevFrameRef.current && prevFrameRef.current.length === data.length) {
        // Compute mean absolute difference across all pixels (R,G,B channels)
        let totalDiff = 0;
        const pixelCount = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          totalDiff += Math.abs(data[i]     - prevFrameRef.current[i]);     // R
          totalDiff += Math.abs(data[i + 1] - prevFrameRef.current[i + 1]); // G
          totalDiff += Math.abs(data[i + 2] - prevFrameRef.current[i + 2]); // B
        }
        // Normalise to [0, 1] — 255 * 3 is max possible diff per pixel
        motion = Math.min(1, totalDiff / (pixelCount * 255 * 3) * 10);
      }
      prevFrameRef.current = new Uint8ClampedArray(data);
    }
    motion = +motion.toFixed(3);
    setMotionScore(motion);

    // ── 6. Draw skeleton overlay ──────────────────────────────────────────
    if (canvas && poses.length > 0) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      // Draw connections for each pose
      poses.forEach((landmarks) => {
        // Draw key joints as circles
        const keypoints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
        ctx.fillStyle = '#0f766e';
        keypoints.forEach((idx) => {
          const lm = landmarks[idx];
          if (lm && (lm.visibility || 0) > 0.5) {
            ctx.beginPath();
            ctx.arc(lm.x * w, lm.y * h, 4, 0, 2 * Math.PI);
            ctx.fill();
          }
        });

        // Draw bones
        const bones = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
        ctx.strokeStyle = '#0891b2';
        ctx.lineWidth = 2;
        bones.forEach(([a, b]) => {
          const la = landmarks[a];
          const lb = landmarks[b];
          if (la && lb && (la.visibility || 0) > 0.4 && (lb.visibility || 0) > 0.4) {
            ctx.beginPath();
            ctx.moveTo(la.x * w, la.y * h);
            ctx.lineTo(lb.x * w, lb.y * h);
            ctx.stroke();
          }
        });
      });
    }

    // ── 7. Send visual frame to backend ───────────────────────────────────
    sendFrame({
      type:                'visual_frame',
      timestamp:           new Date().toISOString(),
      incubator_id:        incubatorId,
      person_count:        count,
      nurse_present:       nurse,
      infant_motion_score: motion,
      skeleton_positions:  skels,
    });

  }, [incubatorId, sendFrame]);

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (isRunning) return;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'environment' },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsRunning(true);
      timerRef.current = setInterval(analyse, ANALYSIS_INTERVAL_MS);
      console.log('📷  Visual pipeline started —', incubatorId);

    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access and try again.'
        : err.message;
      setError(msg);
      console.error('Visual pipeline error:', err);
    }
  }, [isRunning, analyse, incubatorId]);

  // ── stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    prevFrameRef.current = null;
    setIsRunning(false);
    setPersonCount(0);
    setMotionScore(0);
    setNursePresent(false);
    setSkeletons([]);
    console.log('📷  Visual pipeline stopped');
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return {
    personCount, nursePresent, motionScore, skeletons,
    isRunning, start, stop, error,
    videoRef, canvasRef,
  };
}
