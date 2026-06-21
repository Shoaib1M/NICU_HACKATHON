/**
 * YAMNetClassifier.jsx — NICU Guardian
 *
 * Displays YAMNet model load status and live classification confidence.
 * This component is informational — actual inference runs inside useAudioPipeline.
 *
 * Props:
 *   classifications  { cry, alarm, ambient }   From useAudioPipeline
 *   modelReady       boolean                   True once YAMNet + classifier loaded
 */

import { useState, useEffect } from 'react';
import { loadYAMNet }          from '../../models/yamnet_loader';
import { loadNICUClassifier }  from '../../models/nicu_classifier';

const CLASSES = [
  { key: 'cry',     label: 'Cry / infant vocalise', color: '#d97706', icon: '🍼' },
  { key: 'alarm',   label: 'Alarm / beep / siren',  color: '#dc2626', icon: '🔔' },
  { key: 'ambient', label: 'Ambient / silence',      color: '#16a34a', icon: '🌿' },
];

const S = {
  card:    { background:'#ffffff', borderRadius:12, padding:16, border:'1px solid #e2e8f0' },
  header:  { display:'flex', alignItems:'center', gap:8, marginBottom:14 },
  title:   { flex:1, fontWeight:600, fontSize:13, color:'#0f172a' },
  models:  { display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' },
  pill:    { fontSize:10, padding:'3px 9px', borderRadius:999, fontWeight:600 },
  row:     { display:'flex', alignItems:'center', gap:10, marginBottom:10 },
  icon:    { fontSize:18, width:24, textAlign:'center' },
  info:    { flex:1 },
  lbl:     { fontSize:11, color:'#475569' },
  pct:     { fontSize:13, fontWeight:700 },
  track:   { height:6, borderRadius:999, background:'#f1f5f9', marginTop:3 },
  conf:    { fontSize:10, color:'#94a3b8', marginTop:12, lineHeight:1.6 },
};

function ModelPill({ label, loaded }) {
  return (
    <span style={{
      ...S.pill,
      background: loaded ? '#dcfce7' : '#f1f5f9',
      color:      loaded ? '#15803d' : '#94a3b8',
    }}>
      {loaded ? '✓' : '⏳'} {label}
    </span>
  );
}

export default function YAMNetClassifier({ classifications = { cry:0, alarm:0, ambient:0 } }) {
  const [yamnetReady,     setYamnetReady]     = useState(false);
  const [classifierReady, setClassifierReady] = useState(false);

  // Check model load status
  useEffect(() => {
    loadYAMNet().then(() => setYamnetReady(true)).catch(() => {});
    loadNICUClassifier().then(m => setClassifierReady(m !== null)).catch(() => {});
  }, []);

  return (
    <div style={S.card}>
      <div style={S.header}>
        <span style={{ fontSize:18 }}>🧠</span>
        <span style={S.title}>YAMNet classifier</span>
      </div>

      {/* model status pills */}
      <div style={S.models}>
        <ModelPill label="YAMNet (521 classes)" loaded={yamnetReady} />
        <ModelPill label="NICU head (fine-tuned)" loaded={classifierReady} />
      </div>

      {/* live classification bars */}
      {CLASSES.map(({ key, label, color, icon }) => {
        const pct = Math.round((classifications[key] || 0) * 100);
        return (
          <div key={key} style={S.row}>
            <span style={S.icon}>{icon}</span>
            <div style={S.info}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={S.lbl}>{label}</span>
                <span style={{ ...S.pct, color }}>{pct}%</span>
              </div>
              <div style={S.track}>
                <div style={{ height:6, borderRadius:999, background:color, width:`${pct}%`, transition:'width .4s' }}/>
              </div>
            </div>
          </div>
        );
      })}

      <div style={S.conf}>
        Mode: {classifierReady ? '60% fine-tuned + 40% YAMNet blend' : 'YAMNet-only (train NICU head to improve accuracy)'}
      </div>
    </div>
  );
}
