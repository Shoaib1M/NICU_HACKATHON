/**
 * ParentPresenceChart.jsx — NICU Guardian (Feature 9 — Phase 4)
 *
 * Fetches parent presence correlation stats from GET /parent-presence
 * and displays a bar chart comparing stress during parent visits
 * vs. parent absence.
 *
 * Props:
 *   incubatorId  string  (default "BAY_03")
 */

import { useState, useEffect } from 'react';

const BACKEND = 'http://localhost:8000';

const S = {
  card:     { background: '#ffffff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' },
  title:    { fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 14 },
  row:      { display: 'flex', gap: 12, marginBottom: 14 },
  statBox:  { flex: 1, background: '#f8fafc', borderRadius: 8, padding: '10px 12px', border: '1px solid #f1f5f9', textAlign: 'center' },
  statLbl:  { fontSize: 10, color: '#94a3b8', marginBottom: 4 },
  statVal:  { fontSize: 22, fontWeight: 700 },
  barWrap:  { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 },
  barRow:   { display: 'flex', alignItems: 'center', gap: 10 },
  barLabel: { width: 100, fontSize: 12, fontWeight: 600, color: '#475569', textAlign: 'right' },
  barOuter: { flex: 1, height: 24, borderRadius: 6, background: '#f1f5f9', position: 'relative', overflow: 'hidden' },
  barVal:   { position: 'absolute', right: 8, top: 3, fontSize: 11, fontWeight: 600, color: '#ffffff' },
  insight:  { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#1d4ed8' },
  empty:    { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' },
};

export default function ParentPresenceChart({ incubatorId = 'BAY_03' }) {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res  = await fetch(`${BACKEND}/parent-presence?bay=${incubatorId}&minutes=480`);
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch (err) {
        console.error('Failed to fetch parent presence stats:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStats();
    // Refresh every 2 minutes
    const interval = setInterval(fetchStats, 120_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [incubatorId]);

  if (loading) {
    return (
      <div style={S.card}>
        <div style={S.title}>👨‍👩‍👧 Parent Presence Correlation</div>
        <div style={S.empty}>Loading...</div>
      </div>
    );
  }

  const hasData = stats && (stats.parent_present_readings > 0 || stats.parent_absent_readings > 0);
  const maxStress = Math.max(stats?.avg_stress_with_parent || 0, stats?.avg_stress_without || 0, 1);

  return (
    <div style={S.card}>
      <div style={S.title}>👨‍👩‍👧 Parent Presence Correlation</div>

      {!hasData ? (
        <div style={S.empty}>
          No parent visit data recorded yet.<br />
          <span style={{ fontSize: 11 }}>Data is collected when the camera detects non-clinical visitors.</span>
        </div>
      ) : (
        <>
          {/* stat boxes */}
          <div style={S.row}>
            <div style={S.statBox}>
              <div style={S.statLbl}>Parent Sessions</div>
              <div style={{ ...S.statVal, color: '#0f766e' }}>{stats.sessions?.length || 0}</div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Stress Reduction</div>
              <div style={{ ...S.statVal, color: stats.stress_reduction_pct > 0 ? '#16a34a' : '#94a3b8' }}>
                {stats.stress_reduction_pct > 0 ? `↓${stats.stress_reduction_pct}%` : '—'}
              </div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Readings</div>
              <div style={{ ...S.statVal, color: '#475569', fontSize: 16 }}>
                {stats.parent_present_readings + stats.parent_absent_readings}
              </div>
            </div>
          </div>

          {/* bar chart */}
          <div style={S.barWrap}>
            <div style={S.barRow}>
              <span style={S.barLabel}>With parent</span>
              <div style={S.barOuter}>
                <div style={{
                  height: '100%', borderRadius: 6,
                  background: 'linear-gradient(90deg, #0f766e, #0891b2)',
                  width: `${(stats.avg_stress_with_parent / maxStress) * 100}%`,
                  transition: 'width 0.6s',
                }}>
                  <span style={S.barVal}>{stats.avg_stress_with_parent}</span>
                </div>
              </div>
            </div>
            <div style={S.barRow}>
              <span style={S.barLabel}>Without parent</span>
              <div style={S.barOuter}>
                <div style={{
                  height: '100%', borderRadius: 6,
                  background: 'linear-gradient(90deg, #d97706, #dc2626)',
                  width: `${(stats.avg_stress_without / maxStress) * 100}%`,
                  transition: 'width 0.6s',
                }}>
                  <span style={S.barVal}>{stats.avg_stress_without}</span>
                </div>
              </div>
            </div>
          </div>

          {/* clinical insight */}
          {stats.stress_reduction_pct > 0 && (
            <div style={S.insight}>
              💡 Parent contact shows a <b>{stats.stress_reduction_pct}%</b> reduction in infant stress.
              Kangaroo care and skin-to-skin contact are evidence-based interventions for NICU neonates.
            </div>
          )}
        </>
      )}
    </div>
  );
}
