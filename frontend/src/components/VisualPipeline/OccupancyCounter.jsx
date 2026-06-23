/**
 * OccupancyCounter.jsx — NICU Guardian (Feature 7 — Phase 3)
 *
 * Displays current ward occupancy with color coding.
 * Green ≤3, Amber 4–6, Red >6 (NICU guideline max).
 *
 * Props:
 *   personCount  number
 *   nursePresent boolean
 */

const MAX_OCCUPANCY = 6;

function barColor(count) {
  if (count <= 3) return '#16a34a';
  if (count <= MAX_OCCUPANCY) return '#d97706';
  return '#dc2626';
}

export default function OccupancyCounter({ personCount = 0, nursePresent = false }) {
  const pct = Math.min(100, (personCount / MAX_OCCUPANCY) * 100);
  const color = barColor(personCount);

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, padding: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>👥 Ward Occupancy</span>
        <span style={{ fontSize: 11, color: nursePresent ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
          {nursePresent ? '👩‍⚕️ Nurse present' : 'No nurse detected'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color }}>{personCount}</span>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>/ {MAX_OCCUPANCY} max</span>
      </div>

      {/* occupancy bar */}
      <div style={{ height: 8, borderRadius: 999, background: '#f1f5f9' }}>
        <div style={{
          height: 8, borderRadius: 999, background: color,
          width: `${pct}%`, transition: 'width 0.4s, background 0.4s',
        }} />
      </div>

      {personCount > MAX_OCCUPANCY && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
          ⚠️ Over NICU limit — {personCount - MAX_OCCUPANCY} excess visitor{personCount - MAX_OCCUPANCY > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
