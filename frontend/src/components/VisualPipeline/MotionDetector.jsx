/**
 * MotionDetector.jsx — NICU Guardian (Feature 8 — Phase 3)
 *
 * Shows infant motion score (0–1) as a colored bar.
 * Indicates whether visual fusion is modifying the stress index.
 *
 * Props:
 *   motionScore   number   0–1
 *   cryProb       number   0–1 (from audio pipeline, for fusion indicator)
 */

function motionColor(score) {
  if (score < 0.3) return '#16a34a';
  if (score < 0.6) return '#d97706';
  return '#dc2626';
}

function motionLabel(score) {
  if (score < 0.3) return 'Calm';
  if (score < 0.6) return 'Active';
  return 'Agitated';
}

export default function MotionDetector({ motionScore = 0, cryProb = 0 }) {
  const pct   = Math.round(motionScore * 100);
  const color = motionColor(motionScore);
  const label = motionLabel(motionScore);

  // Visual fusion status
  const confirmedDistress = motionScore >= 0.5 && cryProb >= 0.5;
  const likelyFalsePos    = motionScore < 0.2 && cryProb >= 0.6;
  const fusionActive      = confirmedDistress || likelyFalsePos;

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, padding: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>🏃 Infant Motion</span>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color }}>{pct}%</span>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>motion</span>
      </div>

      {/* motion bar */}
      <div style={{ height: 8, borderRadius: 999, background: '#f1f5f9' }}>
        <div style={{
          height: 8, borderRadius: 999, background: color,
          width: `${pct}%`, transition: 'width 0.4s, background 0.4s',
        }} />
      </div>

      {/* fusion indicator */}
      {fusionActive && (
        <div style={{
          marginTop: 8, fontSize: 11, fontWeight: 600, padding: '4px 8px',
          borderRadius: 6,
          background: confirmedDistress ? '#fef2f2' : '#eff6ff',
          color: confirmedDistress ? '#dc2626' : '#1d4ed8',
        }}>
          {confirmedDistress
            ? '🔴 Visual fusion: confirmed distress (stress ×1.15)'
            : '🔵 Visual fusion: likely false positive (stress ×0.85)'}
        </div>
      )}
    </div>
  );
}
