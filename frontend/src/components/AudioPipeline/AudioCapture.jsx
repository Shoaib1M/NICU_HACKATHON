/**
 * AudioCapture.jsx — NICU Guardian
 *
 * Controls the audio pipeline: request mic, start/stop capture,
 * and display live dB level + YAMNet classification bars.
 *
 * Props:
 *   incubatorId    string     Which bay is being monitored
 *   onStressUpdate function   ({ stressIndex, classifications, dbLevel, trend }) => void
 */

import { useEffect, useCallback } from 'react';
import { useAudioPipeline }       from '../../hooks/useAudioPipeline';

const S = {
  card:    { background:'#ffffff', borderRadius:12, padding:16, border:'1px solid #e2e8f0' },
  header:  { display:'flex', alignItems:'center', gap:8, marginBottom:14 },
  title:   { flex:1, fontWeight:600, fontSize:13, color:'#0f172a' },
  grid:    { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 },
  box:     { background:'#f8fafc', borderRadius:8, padding:'8px 10px', border:'1px solid #f1f5f9' },
  lbl:     { fontSize:10, color:'#94a3b8', marginBottom:2 },
  val:     { fontSize:15, fontWeight:700 },
  barRow:  { marginBottom:8 },
  barLbl:  { display:'flex', justifyContent:'space-between', fontSize:11, color:'#94a3b8', marginBottom:3 },
  track:   { height:6, borderRadius:999, background:'#f1f5f9' },
  err:     { background:'#fee2e2', color:'#dc2626', borderRadius:8, padding:'6px 10px', fontSize:12, marginBottom:10 },
  btn:     { width:'100%', padding:'8px 0', borderRadius:8, border:'1px solid #e2e8f0', cursor:'pointer', fontWeight:600, fontSize:13 },
};

function StatBox({ label, value, color = '#0f172a' }) {
  return (
    <div style={S.box}>
      <div style={S.lbl}>{label}</div>
      <div style={{ ...S.val, color }}>{value}</div>
    </div>
  );
}

function ClassBar({ label, value, color }) {
  const pct = Math.round(value * 100);
  return (
    <div style={S.barRow}>
      <div style={S.barLbl}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={S.track}>
        <div style={{ height:6, borderRadius:999, background:color, width:`${pct}%`, transition:'width .4s' }}/>
      </div>
    </div>
  );
}

function LiveDot({ active }) {
  return (
    <div style={{
      width:28, height:28, borderRadius:'50%',
      background: active ? '#dcfce7' : '#f1f5f9',
      display:'flex', alignItems:'center', justifyContent:'center', fontSize:14,
      ...(active ? { animation:'blink 1.5s ease-in-out infinite' } : {}),
    }}>
      🎙️
    </div>
  );
}

function Badge({ running, error }) {
  if (error)   return <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, background:'#fee2e2', color:'#dc2626' }}>Error</span>;
  if (running) return <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, background:'#dcfce7', color:'#15803d', fontWeight:600 }}>● Live</span>;
  return        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, background:'#f1f5f9', color:'#64748b' }}>Idle</span>;
}

export default function AudioCapture({ incubatorId = 'BAY_03', onStressUpdate }) {
  const { stressIndex, classifications, dbLevel, trend, isRunning, start, stop, error } =
    useAudioPipeline(incubatorId);

  // Propagate updates upward to parent / dashboard
  useEffect(() => {
    onStressUpdate?.({ stressIndex, classifications, dbLevel, trend });
  }, [stressIndex, classifications, dbLevel, trend, onStressUpdate]);

  return (
    <div style={S.card}>
      {/* header */}
      <div style={S.header}>
        <LiveDot active={isRunning} />
        <span style={S.title}>Audio capture — {incubatorId}</span>
        <Badge running={isRunning} error={error} />
      </div>

      {/* stat boxes */}
      <div style={S.grid}>
        <StatBox label="dB Level"     value={`${dbLevel} dB`} />
        <StatBox label="Cry"    value={`${Math.round(classifications.cry    * 100)}%`} color="#d97706" />
        <StatBox label="Alarm"  value={`${Math.round(classifications.alarm  * 100)}%`} color="#dc2626" />
        <StatBox label="Trend"  value={trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'}
          color={trend === 'rising' ? '#dc2626' : trend === 'falling' ? '#16a34a' : '#64748b'} />
      </div>

      {/* classification bars */}
      <ClassBar label="Cry probability"   value={classifications.cry}     color="#d97706" />
      <ClassBar label="Alarm probability" value={classifications.alarm}   color="#dc2626" />
      <ClassBar label="Ambient noise"     value={classifications.ambient} color="#16a34a" />

      {/* error banner */}
      {error && <div style={S.err}>⚠️ {error}</div>}

      {/* start / stop button */}
      <button
        onClick={isRunning ? stop : start}
        style={{
          ...S.btn,
          background: isRunning ? '#fee2e2' : '#dcfce7',
          color:      isRunning ? '#dc2626' : '#15803d',
        }}
      >
        {isRunning ? '⏹  Stop capture' : '▶  Start capture'}
      </button>
    </div>
  );
}
