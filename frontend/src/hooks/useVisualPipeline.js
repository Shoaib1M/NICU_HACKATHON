/**
 * useVisualPipeline.js — NICU Guardian (Phase 3)
 *
 * TWO-ZONE ARCHITECTURE (BUG 1 FIX):
 * ═══════════════════════════════════
 *
 *  ┌─────────────────────────────────────────────┐
 *  │               CAMERA FRAME                  │
 *  │                                             │
 *  │   ┌─── PERSON ZONE ──────────────────┐      │
 *  │   │ MediaPipe Pose skeletons here    │      │
 *  │   │ = nurses, visitors, staff        │      │
 *  │   │                                  │      │
 *  │   │   ┌─── INFANT ZONE ──────┐      │      │
 *  │   │   │ Pixel-variance only  │      │      │
 *  │   │   │ = incubator region   │      │      │
 *  │   │   │ NO skeletons used    │      │      │
 *  │   │   └──────────────────────┘      │      │
 *  │   └──────────────────────────────────┘      │
 *  └─────────────────────────────────────────────┘
 *
 *  - Infant motion = pixel variance INSIDE the incubator bounding box ONLY.
 *    The infant is too small for MediaPipe Pose. Pure frame-differencing.
 *  - Person/nurse = MediaPipe Pose skeletons OUTSIDE the incubator box,
 *    with minimum height threshold (must be a standing adult).
 *  - These are MUTUALLY EXCLUSIVE: a person standing near the incubator
 *    produces personCount +1, nursePresent = true, but ZERO infant motion.
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

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURABLE ZONES — Adjust these during demo calibration!
// All coordinates are NORMALIZED [0, 1] relative to the camera frame.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * INFANT ZONE (incubator bounding box)
 * Only pixel-variance motion inside this box counts as infant motion.
 * Adjust x, y, w, h to match where the incubator appears in your camera feed.
 */
const INFANT_BOX = {
  x: 0.3,   // left edge of incubator (30% from left)
  y: 0.6,   // top edge of incubator (moved down to 60% from top for desk testing)
  w: 0.4,   // width of incubator region (40% of frame)
  h: 0.35,  // height of incubator region
};

/**
 * PERSON ZONE constraints
 * A MediaPipe skeleton must satisfy ALL of these to count as a person:
 *  - Torso midpoint (avg of shoulders + hips) must be OUTSIDE the infant box
 *  - Skeleton bounding-box height must exceed MIN_PERSON_HEIGHT (standing adult)
 */
const MIN_PERSON_HEIGHT = 0.25;    // reduced to 25% for desk testing
const MIN_SKELETON_CONFIDENCE = 0.5; // minimum average landmark confidence

// ── other constants ──────────────────────────────────────────────────────────

const ANALYSIS_INTERVAL_MS = 1000;  // run analysis every 1s

// MediaPipe Tasks Vision CDN paths
const VISION_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const POSE_MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

// ══════════════════════════════════════════════════════════════════════════════
// HELPER: check if a point is inside the infant bounding box
// ══════════════════════════════════════════════════════════════════════════════

function isInsideInfantBox(x, y) {
  return (
    x >= INFANT_BOX.x &&
    x <= INFANT_BOX.x + INFANT_BOX.w &&
    y >= INFANT_BOX.y &&
    y <= INFANT_BOX.y + INFANT_BOX.h
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOK
// ══════════════════════════════════════════════════════════════════════════════

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
  const prevInfantRef = useRef(null); // previous frame's infant-zone pixels (for motion)

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
          numPoses: 10,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (!cancelled) {
          landmarkerRef.current = landmarker;
          console.log('✅ MediaPipe PoseLandmarker loaded');
        }
      } catch (err) {
        console.error('MediaPipe load error:', err);
      }
    }

    loadModel();
    return () => { cancelled = true; };
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // PER-INTERVAL ANALYSIS — the core two-zone logic
  // ══════════════════════════════════════════════════════════════════════════
  const analyse = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const W = canvas.width;
    const H = canvas.height;

    // ═══════════════════════════════════════════════════════════════════════
    // ZONE 1: INFANT MOTION — pixel variance INSIDE the incubator box ONLY
    // No MediaPipe skeletons. Pure frame-differencing.
    // ═══════════════════════════════════════════════════════════════════════

    const ix = Math.round(INFANT_BOX.x * W);
    const iy = Math.round(INFANT_BOX.y * H);
    const iw = Math.round(INFANT_BOX.w * W);
    const ih = Math.round(INFANT_BOX.h * H);

    let motion = 0;
    const infantRegion = ctx.getImageData(ix, iy, iw, ih);
    const infantData   = infantRegion.data;

    if (prevInfantRef.current && prevInfantRef.current.length === infantData.length) {
      let totalDiff = 0;
      const pixelCount = infantData.length / 4;
      for (let i = 0; i < infantData.length; i += 4) {
        totalDiff += Math.abs(infantData[i]     - prevInfantRef.current[i]);     // R
        totalDiff += Math.abs(infantData[i + 1] - prevInfantRef.current[i + 1]); // G
        totalDiff += Math.abs(infantData[i + 2] - prevInfantRef.current[i + 2]); // B
      }
      // Normalise to [0, 1] with a sensitivity multiplier
      motion = Math.min(1, totalDiff / (pixelCount * 255 * 3) * 10);
    }
    prevInfantRef.current = new Uint8ClampedArray(infantData);
    motion = +motion.toFixed(3);
    setMotionScore(motion);

    // Draw the infant zone box on canvas (teal dashed rectangle)
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(ix, iy, iw, ih);
    ctx.setLineDash([]);
    ctx.font      = '11px system-ui';
    ctx.fillStyle = '#0f766e';
    ctx.fillText(`🍼 Infant Zone (motion: ${(motion * 100).toFixed(0)}%)`, ix + 4, iy - 6);

    // ═══════════════════════════════════════════════════════════════════════
    // ZONE 2: PERSON / NURSE DETECTION — MediaPipe skeletons OUTSIDE infant box
    // Only standing adults with sufficient height count as people.
    // ═══════════════════════════════════════════════════════════════════════

    let poses = [];
    if (landmarkerRef.current) {
      try {
        const result = landmarkerRef.current.detectForVideo(video, performance.now());
        poses = result.landmarks || [];
      } catch (err) {
        // Pose detection can fail on some frames
      }
    }

    let validPersonCount = 0;
    let nurseDetected    = false;
    const validSkels     = [];

    poses.forEach((landmarks, poseIdx) => {
      // Calculate torso midpoint (average of shoulders + hips)
      const lShoulder = landmarks[11];
      const rShoulder = landmarks[12];
      const lHip      = landmarks[23];
      const rHip      = landmarks[24];

      if (!lShoulder || !rShoulder || !lHip || !rHip) return;

      const torsoX = (lShoulder.x + rShoulder.x + lHip.x + rHip.x) / 4;
      const torsoY = (lShoulder.y + rShoulder.y + lHip.y + rHip.y) / 4;

      // Calculate skeleton bounding-box height
      const allY = landmarks.map(lm => lm.y).filter(y => y > 0);
      const skelHeight = Math.max(...allY) - Math.min(...allY);

      // Average confidence of key landmarks
      const avgConf = (
        (lShoulder.visibility || 0) +
        (rShoulder.visibility || 0) +
        (lHip.visibility || 0) +
        (rHip.visibility || 0)
      ) / 4;

      // ── ZONE CHECK: Is this skeleton a valid person? ──────────────────
      const torsoInsideInfantBox = isInsideInfantBox(torsoX, torsoY);
      const isTallEnough         = skelHeight >= MIN_PERSON_HEIGHT;
      const isConfident          = avgConf >= MIN_SKELETON_CONFIDENCE;

      // Log the zone decision for each skeleton (helps debug during demo)
      console.log(
        `👤 Pose ${poseIdx}: torso=(${torsoX.toFixed(2)},${torsoY.toFixed(2)}) ` +
        `height=${skelHeight.toFixed(2)} conf=${avgConf.toFixed(2)} ` +
        `inInfantBox=${torsoInsideInfantBox} tall=${isTallEnough} → ` +
        `${(!torsoInsideInfantBox && isTallEnough && isConfident) ? '✅ PERSON' : '❌ IGNORED'}`
      );

      if (torsoInsideInfantBox) {
        // Skeleton is inside the infant box — this is NOT a person,
        // it's likely a misdetection on the infant. IGNORE for person count.
        return;
      }

      if (!isTallEnough) {
        // Skeleton is too small — not a standing adult. IGNORE.
        return;
      }

      if (!isConfident) {
        // Low confidence — unreliable detection. IGNORE.
        return;
      }

      // ── Valid person detected OUTSIDE the infant box ───────────────────
      validPersonCount++;
      nurseDetected = true; // any person near the bay is treated as nurse/staff

      validSkels.push({
        x: +torsoX.toFixed(3),
        y: +torsoY.toFixed(3),
        confidence: +avgConf.toFixed(2),
      });

      // Draw skeleton on canvas (person zone)
      ctx.fillStyle = '#0f766e';
      const nose = landmarks[0];
      if (nose) {
        ctx.beginPath();
        ctx.arc(nose.x * W, nose.y * H, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.font      = '12px system-ui';
        ctx.fillStyle = '#0f766e';
        ctx.fillText(`Person ${validPersonCount}`, nose.x * W + 10, nose.y * H - 5);
      }

      // Draw bones
      const bones = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      ctx.strokeStyle = '#0891b2';
      ctx.lineWidth = 2;
      bones.forEach(([a, b]) => {
        const la = landmarks[a];
        const lb = landmarks[b];
        if (la && lb && (la.visibility || 0) > 0.4 && (lb.visibility || 0) > 0.4) {
          ctx.beginPath();
          ctx.moveTo(la.x * W, la.y * H);
          ctx.lineTo(lb.x * W, lb.y * H);
          ctx.stroke();
        }
      });
    });

    setPersonCount(validPersonCount);
    setNursePresent(nurseDetected);
    setSkeletons(validSkels);

    console.log(
      `📷 Frame: persons=${validPersonCount} nurse=${nurseDetected} ` +
      `infantMotion=${motion.toFixed(3)} (poses raw=${poses.length})`
    );

    // ── Send visual frame to backend ─────────────────────────────────────
    sendFrame({
      type:                'visual_frame',
      timestamp:           new Date().toISOString(),
      incubator_id:        incubatorId,
      person_count:        validPersonCount,
      nurse_present:       nurseDetected,
      infant_motion_score: motion,
      skeleton_positions:  validSkels,
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
      console.log('📷 Visual pipeline started —', incubatorId);
      console.log('📷 Infant zone:', INFANT_BOX);

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
    prevInfantRef.current = null;
    setIsRunning(false);
    setPersonCount(0);
    setMotionScore(0);
    setNursePresent(false);
    setSkeletons([]);
    console.log('📷 Visual pipeline stopped');
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return {
    personCount, nursePresent, motionScore, skeletons,
    isRunning, start, stop, error,
    videoRef, canvasRef,
  };
}
