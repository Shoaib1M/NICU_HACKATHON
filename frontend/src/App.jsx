/**
 * App.jsx — NICU Guardian
 *
 * Root component. Wires audio + visual pipelines and all dashboard panels.
 *
 * Build phases completed:
 *   ✅ Phase 1 — Audio Pipeline (mic → YAMNet → stress → WebSocket)
 *   ✅ Phase 2 — Groq Agents (escalation, root cause, prediction)
 *   ✅ Phase 3 — Visual Pipeline (camera → MediaPipe → occupancy/motion/nurse)
 *   ✅ Phase 4 — Parent Presence, Shift Memory Agent
 */

import { useState, useCallback } from 'react';

// Phase 1 — Audio Pipeline
import AudioCapture    from './components/AudioPipeline/AudioCapture';
import YAMNetClassifier from './components/AudioPipeline/YAMNetClassifier';
import StressIndexMeter from './components/AudioPipeline/StressIndexMeter';

// Phase 2 — Agent Alerts
import AlertFeed from './components/Dashboard/AlertFeed';

// Phase 3 — Visual Pipeline
import CameraCapture    from './components/VisualPipeline/CameraCapture';
import OccupancyCounter from './components/VisualPipeline/OccupancyCounter';
import MotionDetector   from './components/VisualPipeline/MotionDetector';
import NurseTracker     from './components/VisualPipeline/NurseTracker';

// Phase 4 — Parent Presence + Shift Memory
import ParentPresenceChart from './components/Dashboard/ParentPresenceChart';
import ShiftReport         from './components/Dashboard/ShiftReport';

const MONITORED_BAY = 'BAY_03';

export default function App() {
  // Audio state
  const [stressData, setStressData] = useState({
    stressIndex:     0,
    classifications: { cry: 0, alarm: 0, ambient: 0 },
    dbLevel:         0,
    trend:           'stable',
  });
  const [history, setHistory] = useState([]);

  // Visual state
  const [visualData, setVisualData] = useState({
    personCount:  0,
    nursePresent: false,
    motionScore:  0,
  });

  const handleStressUpdate = useCallback((data) => {
    setStressData(data);
    setHistory(prev => [...prev.slice(-59), data.stressIndex]);
  }, []);

  const handleVisualUpdate = useCallback((data) => {
    setVisualData(data);
  }, []);

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:'system-ui,-apple-system,sans-serif' }}>

      {/* gradient accent bar */}
      <div style={{ height:3, background:'linear-gradient(90deg,#0f766e,#0891b2,#7c3aed)' }}/>

      {/* header */}
      <header style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0' }}>
        <div style={{ maxWidth:1200, margin:'0 auto', padding:'0 16px', height:56,
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
                          borderRadius:999, background:'#dcfce7', fontSize:11, color:'#15803d',
                          fontWeight:600, marginLeft:6 }}>
              <span>● All Phases Active</span>
            </div>
          </div>

          <div style={{ fontSize:12, color:'#94a3b8' }}>
            Samsung Solve for Tomorrow 2025 · NIT Rourkela
          </div>
        </div>
      </header>

      {/* body */}
      <div style={{ maxWidth:1200, margin:'0 auto', padding:16 }}>

        {/* info banner */}
        <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10,
                      padding:'10px 14px', marginBottom:16, fontSize:13, color:'#1d4ed8' }}>
          <b>NICU Guardian</b> · Real-time AI neonatal monitoring. Start audio capture and camera
          to begin live stress monitoring with autonomous agent alerts.
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            ROW 1: Audio + Stress Gauge
            ═══════════════════════════════════════════════════════════════════ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16, marginBottom:16 }}>

          {/* left: audio controls */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <AudioCapture
              incubatorId={MONITORED_BAY}
              onStressUpdate={handleStressUpdate}
            />
            <YAMNetClassifier
              classifications={stressData.classifications}
            />
          </div>

          {/* right: stress gauge + alerts */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <StressIndexMeter
              value={stressData.stressIndex}
              history={history}
              trend={stressData.trend}
              incubatorId={MONITORED_BAY}
            />
            <AlertFeed />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            ROW 2: Visual Pipeline
            ═══════════════════════════════════════════════════════════════════ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16, marginBottom:16 }}>

          {/* left: camera feed */}
          <CameraCapture
            incubatorId={MONITORED_BAY}
            onVisualUpdate={handleVisualUpdate}
          />

          {/* right: visual stats */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <OccupancyCounter
              personCount={visualData.personCount}
              nursePresent={visualData.nursePresent}
            />
            <MotionDetector
              motionScore={visualData.motionScore}
              cryProb={stressData.classifications.cry}
            />
            <NurseTracker
              nursePresent={visualData.nursePresent}
            />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            ROW 3: Parent Presence + Shift Report
            ═══════════════════════════════════════════════════════════════════ */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:16 }}>
          <ParentPresenceChart incubatorId={MONITORED_BAY} />
          <ShiftReport />
        </div>

      </div>
    </div>
  );
}
