/**
 * App.jsx — NICU Guardian
 *
 * Root component. Wires the audio pipeline into the dashboard.
 * Visual pipeline, agent alerts, and advanced panels are built in subsequent phases.
 *
 * Build phases completed:
 *   ✅ Phase 0 — Dashboard UI (light mode)
 *   ✅ Phase 1 — Audio Pipeline  ← current
 *   ⬜ Phase 2 — Groq Agents (escalation, root cause, occupancy)
 *   ⬜ Phase 3 — Visual Pipeline (occupancy, agitation, TDOA, nurse tracker)
 *   ⬜ Phase 4 — Parent presence, shift memory agent
 */

import { useState, useCallback } from 'react';

import AudioCapture    from './components/AudioPipeline/AudioCapture';
import YAMNetClassifier from './components/AudioPipeline/YAMNetClassifier';
import StressIndexMeter from './components/AudioPipeline/StressIndexMeter';

// Dashboard panels (Phase 0 — already built, imported from feature branch)
// import IncubatorMap  from './components/Dashboard/IncubatorMap';
// import AlertFeed     from './components/Dashboard/AlertFeed';
// import ShiftReport   from './components/Dashboard/ShiftReport';

const MONITORED_BAY = 'BAY_03';

export default function App() {
  const [stressData, setStressData] = useState({
    stressIndex:     0,
    classifications: { cry: 0, alarm: 0, ambient: 0 },
    dbLevel:         0,
    trend:           'stable',
  });

  // History ring buffer (last 60 readings = 30 seconds at 500ms)
  const [history, setHistory] = useState([]);

  const handleStressUpdate = useCallback((data) => {
    setStressData(data);
    setHistory(prev => [...prev.slice(-59), data.stressIndex]);
  }, []);

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:'system-ui,-apple-system,sans-serif' }}>

      {/* gradient accent bar */}
      <div style={{ height:3, background:'linear-gradient(90deg,#0f766e,#0891b2,#7c3aed)' }}/>

      {/* header */}
      <header style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', padding:'0 16px', height:56,
                      display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10,
                          background:'linear-gradient(135deg,#0f766e,#0891b2)',
                          display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:16 }}>
              ❤️
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>
                NICU<span style={{ color:'#0f766e' }}>Guardian</span>
              </div>
              <div style={{ fontSize:10, color:'#94a3b8' }}>AI Ward Monitor</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 9px',
                          borderRadius:999, background:'#ccfbf1', fontSize:11, color:'#0f766e',
                          fontWeight:600, marginLeft:6 }}>
              <span>● Phase 1 — Audio Pipeline</span>
            </div>
          </div>

          <div style={{ fontSize:12, color:'#94a3b8' }}>
            Samsung Solve for Tomorrow 2025 · NIT Rourkela
          </div>
        </div>
      </header>

      {/* body */}
      <div style={{ maxWidth:1100, margin:'0 auto', padding:16 }}>

        {/* Phase 1 notice */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10,
                      padding:'10px 14px', marginBottom:16, fontSize:13, color:'#1d4ed8' }}>
          <b>Phase 1 — Audio Pipeline</b> · Connect a microphone and click "Start capture" to begin
          live stress monitoring. The dashboard will auto-connect to the backend via WebSocket.
        </div>

        {/* main layout */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16 }}>

          {/* left: controls */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <AudioCapture
              incubatorId={MONITORED_BAY}
              onStressUpdate={handleStressUpdate}
            />
            <YAMNetClassifier
              classifications={stressData.classifications}
            />
          </div>

          {/* right: live gauge + timeline */}
          <StressIndexMeter
            value={stressData.stressIndex}
            history={history}
            trend={stressData.trend}
            incubatorId={MONITORED_BAY}
          />
        </div>

        {/* placeholder for upcoming phases */}
        <div style={{ marginTop:16, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
          {[
            { phase:'Phase 2', label:'Groq Agents',    icon:'🧠', desc:'Escalation · Root Cause · Prediction' },
            { phase:'Phase 3', label:'Visual Pipeline', icon:'📷', desc:'Occupancy · Agitation · TDOA · Nurse tracker' },
            { phase:'Phase 4', label:'Parent + Shift',  icon:'📋', desc:'Parent presence · Shift Memory Agent' },
          ].map(({ phase, label, icon, desc }) => (
            <div key={phase} style={{ background:'#ffffff', borderRadius:12, padding:'14px 16px',
                                      border:'1px dashed #cbd5e1', opacity:0.7 }}>
              <div style={{ fontSize:18, marginBottom:6 }}>{icon}</div>
              <div style={{ fontSize:11, color:'#0f766e', fontWeight:600 }}>{phase}</div>
              <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', margin:'2px 0' }}>{label}</div>
              <div style={{ fontSize:11, color:'#94a3b8' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
