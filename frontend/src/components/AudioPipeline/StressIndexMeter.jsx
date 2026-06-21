/**
 * StressIndexMeter.jsx — NICU Guardian (Feature 1 — Live Stress Index)
 *
 * Displays:
 *   - Animated semi-circle SVG gauge  (colour transitions green → amber → red)
 *   - Sparkline area chart (last 30 readings via Recharts)
 *   - Threshold reference lines at 40 (Elevated) and 70 (Critical)
 *   - Trend indicator (rising / falling / stable)
 *
 * Props:
 *   value           number   Stress index 0–100
 *   history         number[] Last N readings
 *   trend           string   'rising' | 'falling' | 'stable'
 *   incubatorId     string
 */

import {
  AreaChart, Area, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';

import { stressColor, stressLabel } from '../../utils/stressIndex';

// ── Gauge SVG ─────────────────────────────────────────────────────────────────

function Gauge({ value }) {
  const c  = stressColor(value);
  const h  = Math.PI * 38; // half-circumference for r=38
  return (
    <svg viewBox="0 0 90 60" width={90} height={60} style={{ flexShrink: 0 }}>
      {/* track */}
      <path d="M 7 52 A 38 38 0 0 0 83 52" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round"/>
      {/* fill */}
      <path d="M 7 52 A 38 38 0 0 0 83 52" fill="none" stroke={c} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(value / 100) * h} ${h}`}
        style={{ transition: 'stroke-dasharray .5s, stroke .5s' }}/>
      {/* value */}
      <text x="45" y="45" textAnchor="middle" fontSize="18" fontWeight="800" fill={c}
        style={{ transition: 'fill .5s' }}>{value}</text>
      <text x="45" y="56" textAnchor="middle" fontSize="9" fill="#94a3b8">/100</text>
    </svg>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const v = Math.round(payload[0].value);
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 10px', fontSize:11 }}>
      <span style={{ color: stressColor(v), fontWeight:700 }}>Stress {v}</span>
    </div>
  );
}

// ── Trend badge ────────────────────────────────────────────────────────────────

function TrendBadge({ trend }) {
  const map = {
    rising:  { label:'↑ Rising',  bg:'#fee2e2', color:'#dc2626' },
    falling: { label:'↓ Falling', bg:'#dcfce7', color:'#15803d' },
    stable:  { label:'→ Stable',  bg:'#f1f5f9', color:'#64748b' },
  };
  const { label, bg, color } = map[trend] || map.stable;
  return (
    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, background:bg, color, fontWeight:600 }}>
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function StressIndexMeter({
  value       = 0,
  history     = [],
  trend       = 'stable',
  incubatorId = 'BAY_03',
}) {
  const c     = stressColor(value);
  const label = stressLabel(value);

  // Recharts expects { v } objects
  const chartData = history.map((v, i) => ({ t: i, v }));

  return (
    <div style={{ background:'#ffffff', borderRadius:12, padding:16, border:'1px solid #e2e8f0' }}>

      {/* header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ color:'#0f766e', fontSize:15 }}>📈</span>
          <span style={{ fontWeight:600, fontSize:13, color:'#0f172a' }}>
            Live Stress Index — {incubatorId}
          </span>
        </div>
        <span style={{ fontSize:10, padding:'2px 8px', borderRadius:999, background:c+'18', color:c, border:`1px solid ${c}33`, fontWeight:600 }}>
          {label}
        </span>
      </div>

      {/* gauge row */}
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:12 }}>
        <Gauge value={value}/>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:4 }}>Current reading</div>
          <div style={{ fontSize:32, fontWeight:800, color:c, lineHeight:1, transition:'color .5s' }}>
            {value}
            <span style={{ fontSize:14, fontWeight:400, color:'#94a3b8' }}> / 100</span>
          </div>
          <div style={{ marginTop:8 }}>
            <TrendBadge trend={trend}/>
          </div>
        </div>
      </div>

      {/* sparkline */}
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={chartData} margin={{ top:4, right:4, left:-22, bottom:0 }}>
          <defs>
            <linearGradient id={`sg-${incubatorId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={c} stopOpacity={0.2}/>
              <stop offset="95%" stopColor={c} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <YAxis domain={[0, 100]} tick={{ fontSize:9, fill:'#94a3b8' }}/>
          <Tooltip content={<ChartTooltip/>}/>
          <ReferenceLine y={70} stroke="#dc262688" strokeDasharray="4 2"/>
          <ReferenceLine y={40} stroke="#d9770688" strokeDasharray="4 2"/>
          <Area
            type="monotone" dataKey="v"
            stroke={c} strokeWidth={2}
            fill={`url(#sg-${incubatorId})`}
            dot={false} isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* legend */}
      <div style={{ display:'flex', gap:14, fontSize:10, color:'#94a3b8', marginTop:4 }}>
        <span style={{ color:'#d9770688' }}>─ ─ Elevated (40)</span>
        <span style={{ color:'#dc262688' }}>─ ─ Critical (70)</span>
      </div>
    </div>
  );
}
