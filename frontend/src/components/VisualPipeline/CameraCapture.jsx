/**
 * CameraCapture.jsx — NICU Guardian (Visual Pipeline — Phase 3)
 *
 * Main visual pipeline UI component.
 * Shows webcam preview with skeleton overlay, person count,
 * nurse presence indicator, and motion score.
 *
 * Props:
 *   incubatorId    string     Which bay is being monitored
 *   onVisualUpdate function   ({ personCount, nursePresent, motionScore }) => void
 */

import { useEffect } from 'react';
import { useVisualPipeline } from '../../hooks/useVisualPipeline';

const S = {
  card:     { background: '#ffffff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' },
  header:   { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 },
  title:    { flex: 1, fontWeight: 600, fontSize: 13, color: '#0f172a' },
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 },
  box:      { background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: '1px solid #f1f5f9' },
  lbl:      { fontSize: 10, color: '#94a3b8', marginBottom: 2 },
  val:      { fontSize: 15, fontWeight: 700 },
  videoWrap:{ position: 'relative', borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: '#0f172a' },
  video:    { width: '100%', display: 'block', borderRadius: 8 },
  canvas:   { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  err:      { background: '#fee2e2', color: '#dc2626', borderRadius: 8, padding: '6px 10px', fontSize: 12, marginBottom: 10 },
  btn:      { width: '100%', padding: '8px 0', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  noVideo:  { width: '100%', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 },
};

function occupancyColor(count) {
  if (count <= 3) return '#16a34a';
  if (count <= 6) return '#d97706';
  return '#dc2626';
}

function motionColor(score) {
  if (score < 0.3) return '#16a34a';
  if (score < 0.6) return '#d97706';
  return '#dc2626';
}

function LiveDot({ active }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: active ? '#dcfce7' : '#f1f5f9',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
    }}>
      📷
    </div>
  );
}

function Badge({ running, error }) {
  if (error)   return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fee2e2', color: '#dc2626' }}>Error</span>;
  if (running) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#dcfce7', color: '#15803d', fontWeight: 600 }}>● Live</span>;
  return        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b' }}>Idle</span>;
}

export default function CameraCapture({ incubatorId = 'BAY_03', onVisualUpdate }) {
  const {
    personCount, nursePresent, motionScore, isRunning, start, stop, error,
    videoRef, canvasRef,
  } = useVisualPipeline(incubatorId);

  // Propagate updates to parent
  useEffect(() => {
    onVisualUpdate?.({ personCount, nursePresent, motionScore });
  }, [personCount, nursePresent, motionScore, onVisualUpdate]);

  return (
    <div style={S.card}>
      {/* header */}
      <div style={S.header}>
        <LiveDot active={isRunning} />
        <span style={S.title}>Camera — {incubatorId}</span>
        <Badge running={isRunning} error={error} />
      </div>

      {/* stat boxes */}
      <div style={S.grid}>
        <div style={S.box}>
          <div style={S.lbl}>People</div>
          <div style={{ ...S.val, color: occupancyColor(personCount) }}>{personCount}</div>
        </div>
        <div style={S.box}>
          <div style={S.lbl}>Nurse</div>
          <div style={{ ...S.val, color: nursePresent ? '#16a34a' : '#94a3b8' }}>
            {nursePresent ? '✓ Yes' : '— No'}
          </div>
        </div>
        <div style={S.box}>
          <div style={S.lbl}>Motion</div>
          <div style={{ ...S.val, color: motionColor(motionScore) }}>
            {(motionScore * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* video preview */}
      <div style={S.videoWrap}>
        {!isRunning && (
          <div style={S.noVideo}>Click "Start camera" to begin visual monitoring</div>
        )}
        <video ref={videoRef} style={{ ...S.video, display: isRunning ? 'block' : 'none' }} muted playsInline />
        <canvas ref={canvasRef} style={{ ...S.canvas, display: isRunning ? 'block' : 'none' }} />
      </div>

      {/* occupancy warning */}
      {personCount > 6 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                      padding: '6px 10px', fontSize: 12, color: '#dc2626', marginBottom: 10 }}>
          ⚠️ Occupancy exceeds NICU guideline ({personCount}/6 max). Non-essential visitors should step out.
        </div>
      )}

      {/* error banner */}
      {error && <div style={S.err}>⚠️ {error}</div>}

      {/* start / stop button */}
      <button
        onClick={isRunning ? stop : start}
        style={{
          ...S.btn,
          background: isRunning ? '#fee2e2' : '#eff6ff',
          color:      isRunning ? '#dc2626' : '#1d4ed8',
        }}
      >
        {isRunning ? '⏹  Stop camera' : '📷  Start camera'}
      </button>
    </div>
  );
}
