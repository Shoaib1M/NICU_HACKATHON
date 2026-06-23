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

export default function NurseTracker({ nursePresent = false }) {
  const [lastSeenAgo, setLastSeenAgo] = useState(null); // seconds since last seen
  const lastSeenRef = useRef(null);

  useEffect(() => {
    if (nursePresent) {
      lastSeenRef.current = Date.now();
      setLastSeenAgo(0);
    }
  }, [nursePresent]);

  // Update "last seen" timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeenRef.current && !nursePresent) {
        setLastSeenAgo(Math.round((Date.now() - lastSeenRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [nursePresent]);

  const statusColor = nursePresent ? '#16a34a' : '#94a3b8';

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, padding: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>👩‍⚕️ Nurse Tracker</span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 999,
          background: nursePresent ? '#dcfce7' : '#f1f5f9',
          color: nursePresent ? '#15803d' : '#64748b',
          fontWeight: 600,
        }}>
          {nursePresent ? '● At bedside' : '○ Not detected'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Status icon */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: nursePresent ? '#dcfce7' : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          {nursePresent ? '👩‍⚕️' : '🔍'}
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: statusColor }}>
            {nursePresent ? 'Nurse is present' : 'Waiting for nurse'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {nursePresent
              ? 'Response verified — escalation paused'
              : lastSeenAgo !== null
                ? `Last seen ${lastSeenAgo}s ago`
                : 'No nurse detected this session'}
          </div>
        </div>
      </div>
    </div>
  );
}
