/**
 * NurseTracker.jsx — NICU Guardian (Feature 10 — Phase 3)
 *
 * Shows whether a nurse is currently detected in the bay.
 * Tracks time since last escalation alert (if any).
 *
 * Props:
 *   nursePresent  boolean
 */

import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function NurseTracker({ nursePresent = false }) {
  const [stats, setStats] = useState({ pending_alert: false, alert_started_at: null, avg_response_secs: 0, total_responses: 0 });
  const [waitingTime, setWaitingTime] = useState(null);
  
  // Poll backend for nurse response stats (Feature 10)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_BASE}/nurse-stats?bay=BAY_03`);
        if (res.ok) setStats(await res.json());
      } catch (err) {
        console.warn('Nurse stats fetch failed:', err);
      }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 2000);
    return () => clearInterval(iv);
  }, []);

  // Compute live waiting time if an alert is pending
  useEffect(() => {
    if (!stats.pending_alert || !stats.alert_started_at) {
      setWaitingTime(null);
      return;
    }
    const iv = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(stats.alert_started_at).getTime()) / 1000);
      setWaitingTime(elapsed);
    }, 1000);
    return () => clearInterval(iv);
  }, [stats.pending_alert, stats.alert_started_at]);

  const statusColor = nursePresent ? '#16a34a' : stats.pending_alert ? '#dc2626' : '#94a3b8';

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, padding: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>👩‍⚕️ Nurse Tracker</span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 999,
          background: nursePresent ? '#dcfce7' : stats.pending_alert ? '#fee2e2' : '#f1f5f9',
          color: nursePresent ? '#15803d' : stats.pending_alert ? '#dc2626' : '#64748b',
          fontWeight: 600,
        }}>
          {nursePresent ? '● At bedside' : stats.pending_alert ? '⚠ Esc alert active' : '○ Not detected'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {/* Status icon */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: nursePresent ? '#dcfce7' : stats.pending_alert ? '#fee2e2' : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          {nursePresent ? '👩‍⚕️' : stats.pending_alert ? '🚨' : '🔍'}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: statusColor }}>
            {nursePresent 
              ? 'Nurse is present' 
              : stats.pending_alert && waitingTime !== null
                ? `waiting for nurse… ${Math.floor(waitingTime/60)}:${String(waitingTime%60).padStart(2,'0')}`
                : 'Waiting for alert...'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {nursePresent
              ? 'Response verified — escalation paused'
              : stats.pending_alert 
                ? 'Camera monitoring for nurse arrival'
                : 'No active escalation for this bay'}
          </div>
        </div>
      </div>
      
      {/* Response Metrics */}
      <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>Shift Avg Response:</span>
        <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>
          {stats.avg_response_secs > 0 ? `${stats.avg_response_secs}s` : '--'}
          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4, fontWeight: 500 }}>({stats.total_responses} calls)</span>
        </span>
      </div>
    </div>
  );
}
