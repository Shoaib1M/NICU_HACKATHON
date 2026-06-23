/**
 * ShiftReport.jsx — NICU Guardian (Feature S — Phase 4)
 *
 * Expandable accordion showing the Shift Memory Agent's narrative report.
 * Clicking "Generate Report" triggers POST /shift-report, then polls
 * GET /shift-report for the result.
 */

import { useState, useCallback } from 'react';

const BACKEND = 'http://localhost:8000';

const S = {
  card:     { background: '#ffffff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' },
  header:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title:    { fontWeight: 600, fontSize: 14, color: '#0f172a' },
  btn:      { padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: '#eff6ff', color: '#1d4ed8' },
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 },
  statBox:  { background: '#f8fafc', borderRadius: 8, padding: '8px 10px', border: '1px solid #f1f5f9', textAlign: 'center' },
  statLbl:  { fontSize: 10, color: '#94a3b8', marginBottom: 2 },
  statVal:  { fontSize: 15, fontWeight: 700, color: '#0f172a' },
  narrative:{ background: '#f8fafc', borderRadius: 8, padding: 14, fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', border: '1px solid #f1f5f9' },
  empty:    { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' },
  loading:  { textAlign: 'center', color: '#0891b2', fontSize: 13, padding: '20px 0' },
  toggle:   { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', color: '#0891b2', fontSize: 12, fontWeight: 600, marginTop: 10, padding: 0 },
};

export default function ShiftReport() {
  const [report, setReport]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(false);

  const generateReport = useCallback(async () => {
    setLoading(true);
    try {
      // Trigger generation
      await fetch(`${BACKEND}/shift-report`, { method: 'POST' });

      // Poll for result (agent runs in background)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const res  = await fetch(`${BACKEND}/shift-report`);
          const data = await res.json();
          if (data.narrative) {
            clearInterval(poll);
            setReport(data);
            setLoading(false);
            setExpanded(true);
          } else if (attempts >= 30) {
            clearInterval(poll);
            setLoading(false);
          }
        } catch {
          if (attempts >= 30) {
            clearInterval(poll);
            setLoading(false);
          }
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to generate shift report:', err);
      setLoading(false);
    }
  }, []);

  return (
    <div style={S.card}>
      <div style={S.header}>
        <span style={S.title}>📋 Shift Memory Report</span>
        <button style={S.btn} onClick={generateReport} disabled={loading}>
          {loading ? '⏳ Generating...' : '🧠 Generate Report'}
        </button>
      </div>

      {loading && (
        <div style={S.loading}>
          🧠 Shift Memory Agent is analysing the past 8 hours of data...
        </div>
      )}

      {!report && !loading && (
        <div style={S.empty}>
          No shift report generated yet.<br />
          <span style={{ fontSize: 11 }}>Click "Generate Report" for an AI-powered shift handover summary.</span>
        </div>
      )}

      {report && !loading && (
        <>
          {/* stat summary */}
          <div style={S.grid}>
            <div style={S.statBox}>
              <div style={S.statLbl}>Peak Stress</div>
              <div style={{ ...S.statVal, color: report.peak_stress > 70 ? '#dc2626' : '#d97706' }}>
                {report.peak_stress}/100
              </div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Alerts</div>
              <div style={S.statVal}>
                {report.resolved_alerts}/{report.total_alerts}
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}> resolved</span>
              </div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Avg Response</div>
              <div style={S.statVal}>{report.avg_nurse_response_secs}s</div>
            </div>
          </div>

          <div style={S.grid}>
            <div style={S.statBox}>
              <div style={S.statLbl}>Fatigue Events</div>
              <div style={{ ...S.statVal, color: report.alarm_fatigue_count > 0 ? '#d97706' : '#16a34a' }}>
                {report.alarm_fatigue_count}
              </div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Parent Sessions</div>
              <div style={S.statVal}>{report.parent_sessions}</div>
            </div>
            <div style={S.statBox}>
              <div style={S.statLbl}>Stress Reduction</div>
              <div style={{ ...S.statVal, color: '#16a34a' }}>
                {report.avg_stress_reduction_pct > 0 ? `↓${report.avg_stress_reduction_pct}%` : '—'}
              </div>
            </div>
          </div>

          {/* expandable narrative */}
          <button style={S.toggle} onClick={() => setExpanded(!expanded)}>
            {expanded ? '▼' : '▶'} {expanded ? 'Hide' : 'Show'} AI Narrative
          </button>

          {expanded && (
            <div style={{ ...S.narrative, marginTop: 10 }}>
              {report.narrative}
            </div>
          )}
        </>
      )}
    </div>
  );
}
