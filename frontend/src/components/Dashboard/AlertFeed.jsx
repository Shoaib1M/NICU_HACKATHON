import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const SEVERITY_COLORS = {
  high:   { border: '#dc2626', bg: '#fef2f2', badge: '#dc2626', badgeBg: '#fee2e2' },
  medium: { border: '#d97706', bg: '#fffbeb', badge: '#d97706', badgeBg: '#fef3c7' },
  low:    { border: '#2563eb', bg: '#eff6ff', badge: '#2563eb', badgeBg: '#dbeafe' },
};

const S = {
  container: { background: '#ffffff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 400 },
  header: { fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  feed: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  alertTitle: { fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' },
  alertBody: { color: '#475569', lineHeight: 1.4 },
  alertTime: { fontSize: 10, color: '#94a3b8', fontWeight: 500 },
  resolveBtn: { marginTop: 8, fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#fee2e2', color: '#dc2626', border: 'none', cursor: 'pointer', fontWeight: 600 },
  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' },
  testBtn: {
    fontSize: 11, padding: '3px 10px', borderRadius: 6,
    background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0',
    cursor: 'pointer', fontWeight: 600, transition: 'all .15s',
  },
  badge: (sev) => ({
    fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 600,
    background: (SEVERITY_COLORS[sev] || SEVERITY_COLORS.medium).badgeBg,
    color: (SEVERITY_COLORS[sev] || SEVERITY_COLORS.medium).badge,
  }),
};

export default function AlertFeed() {
  const [alerts, setAlerts] = useState([]);
  const [testing, setTesting] = useState(false);

  // Subscribe to the /ws/alerts channel from the backend (Feature 2)
  const { status } = useWebSocket('/ws/alerts', (newAlert) => {
    setAlerts((prev) => {
      // Avoid duplicates and keep the feed up to 20 items
      if (prev.find(a => a._id === newAlert._id)) return prev;
      return [newAlert, ...prev].slice(0, 20);
    });
  });

  // Load existing alerts from REST API on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/alerts?bay=BAY_03&minutes=60`);
        if (res.ok) {
          const data = await res.json();
          setAlerts(prev => {
            const existingIds = new Set(prev.map(a => a._id));
            const newAlerts = data.filter(a => !existingIds.has(a._id));
            return [...prev, ...newAlerts].slice(0, 20);
          });
        }
      } catch (e) {
        console.warn('Failed to fetch existing alerts:', e);
      }
    })();
  }, []);

  const markResolved = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/alerts/${id}/resolve`, { method: 'POST' });
      setAlerts(prev => prev.filter(a => a._id !== id));
    } catch (e) {
      console.error('Failed to resolve alert', e);
    }
  }, []);

  const fireTestAlert = useCallback(async () => {
    setTesting(true);
    try {
      await fetch(`${API_BASE}/alerts/test`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to fire test alert', e);
    } finally {
      setTimeout(() => setTesting(false), 800);
    }
  }, []);

  return (
    <div style={S.container}>
      <div style={S.header}>
        <span>Agent Alerts Feed</span>
        <div style={S.headerRight}>
          <button
            style={{ ...S.testBtn, opacity: testing ? 0.6 : 1 }}
            onClick={fireTestAlert}
            disabled={testing}
            title="Fire a test alert to verify the pipeline"
          >
            {testing ? '⏳ Sending…' : '🧪 Test Alert'}
          </button>
          <span style={{ fontSize: 11, color: status === 'connected' ? '#16a34a' : '#94a3b8' }}>
            {status === 'connected' ? '● Live' : status === 'connecting' ? '◌ Connecting…' : '○ Offline'}
          </span>
        </div>
      </div>
      
      <div style={S.feed}>
        {alerts.length === 0 ? (
          <div style={S.empty}>No active alerts — click 🧪 Test Alert to verify</div>
        ) : (
          alerts.map(alert => {
            const sev = alert.severity || 'medium';
            const colors = SEVERITY_COLORS[sev] || SEVERITY_COLORS.medium;
            return (
              <div key={alert._id} style={{
                padding: 12, borderRadius: 8, fontSize: 13, color: '#1e293b',
                borderLeft: `4px solid ${colors.border}`, background: colors.bg,
              }}>
                <div style={S.alertTitle}>
                  <span>{alert.title}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={S.badge(sev)}>{sev.toUpperCase()}</span>
                    <span style={S.alertTime}>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div style={S.alertBody}>{alert.body}</div>
                <button style={S.resolveBtn} onClick={() => markResolved(alert._id)}>
                  ✓ Mark Resolved
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

