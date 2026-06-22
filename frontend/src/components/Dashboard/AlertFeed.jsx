import { useState, useCallback } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

const S = {
  container: { background: '#ffffff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 400 },
  header: { fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 12, display: 'flex', justifyContent: 'space-between' },
  feed: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  alertCard: { padding: 12, borderRadius: 8, borderLeft: '4px solid #dc2626', background: '#fef2f2', fontSize: 13, color: '#1e293b' },
  alertTitle: { fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' },
  alertBody: { color: '#475569', lineHeight: 1.4 },
  alertTime: { fontSize: 10, color: '#94a3b8', fontWeight: 500 },
  resolveBtn: { marginTop: 8, fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#fee2e2', color: '#dc2626', border: 'none', cursor: 'pointer', fontWeight: 600 },
  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }
};

export default function AlertFeed() {
  const [alerts, setAlerts] = useState([]);

  // Subscribe to the /ws/alerts channel from the backend (Feature 2)
  const { status } = useWebSocket('/ws/alerts', (newAlert) => {
    setAlerts((prev) => {
      // Avoid duplicates and keep the feed up to 20 items
      if (prev.find(a => a._id === newAlert._id)) return prev;
      return [newAlert, ...prev].slice(0, 20);
    });
  });

  const markResolved = useCallback(async (id) => {
    try {
      await fetch(`http://localhost:8000/alerts/${id}/resolve`, { method: 'POST' });
      setAlerts(prev => prev.filter(a => a._id !== id));
    } catch (e) {
      console.error('Failed to resolve alert', e);
    }
  }, []);

  return (
    <div style={S.container}>
      <div style={S.header}>
        <span>Agent Alerts Feed</span>
        <span style={{ fontSize: 11, color: status === 'connected' ? '#16a34a' : '#94a3b8' }}>
          {status === 'connected' ? '● Live' : '○ Offline'}
        </span>
      </div>
      
      <div style={S.feed}>
        {alerts.length === 0 ? (
          <div style={S.empty}>No active alerts</div>
        ) : (
          alerts.map(alert => (
            <div key={alert._id} style={{ ...S.alertCard, borderLeftColor: alert.severity === 'high' ? '#dc2626' : '#d97706' }}>
              <div style={S.alertTitle}>
                <span>{alert.title}</span>
                <span style={S.alertTime}>{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </div>
              <div style={S.alertBody}>{alert.body}</div>
              <button style={S.resolveBtn} onClick={() => markResolved(alert._id)}>
                ✓ Mark Resolved
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
