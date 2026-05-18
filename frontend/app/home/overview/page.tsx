'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

const API = 'http://localhost:8000'
const WS  = 'ws://localhost:8000/ws'
const TARGET = 1.8

// ── Types ──────────────────────────────────────────────────────────
interface DailyStatus {
  today:         string
  defect_count:  number   // จาก /correction/today
  volume:        number
  ratio_today:   number
  target:        number
  over_target:   boolean
  note_required: boolean
  note:          null | object
}

// shape จาก GET /records/defect
interface DefectRecord {
  no:                number
  name:              string
  date_day:          string   // "YYYY-MM-DD"
  time:              string   // "HH:MM:SS"
  defect_mode:       string
  defect_code:       string
  defect_by_process: string
  defect_type:       string
  part_no:           string
  core_no:           string
  model:             string   // API ส่ง "model" ไม่ใช่ "model_name"
  line:              string
  shift:             string
  group:             string
  shift_group:       string
}

interface TopItem    { label: string; count: number; pct: number }
interface HourBucket { hour: number; label: string; count: number }

// ── Shift helpers ──────────────────────────────────────────────────
function getShiftHours(s: 'day' | 'night'): number[] {
  return s === 'day'
    ? [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    : [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]
}

function buildHourBuckets(
  defects: DefectRecord[],
  shiftType: 'day' | 'night',
  dateStr: string,
): HourBucket[] {
  const hours  = getShiftHours(shiftType)
  const counts: Record<number, number> = {}
  hours.forEach(h => (counts[h] = 0))

  for (const d of defects) {
    const scanDate = d.date_day?.slice(0, 10) ?? ''
    const h        = parseInt((d.time ?? '').slice(0, 2), 10)
    if (isNaN(h)) continue

    if (shiftType === 'day') {
      if (scanDate === dateStr && h >= 7 && h <= 18)
        counts[h] = (counts[h] || 0) + 1
    } else {
      const prev = new Date(dateStr)
      prev.setDate(prev.getDate() - 1)
      const prevStr = prev.toISOString().slice(0, 10)
      if (scanDate === dateStr && h >= 0 && h <= 6)
        counts[h] = (counts[h] || 0) + 1
      if (scanDate === prevStr  && h >= 19)
        counts[h] = (counts[h] || 0) + 1
    }
  }

  return hours.map(h => ({
    hour:  h,
    label: `${String(h).padStart(2, '0')}:00`,
    count: counts[h] || 0,
  }))
}

function buildTop5(
  defects: DefectRecord[],
  dateStr: string,
  groupBy: 'model' | 'line' | 'defect_mode',
): TopItem[] {
  // กรองเฉพาะวันนี้
  const rows = defects.filter(d => d.date_day?.slice(0, 10) === dateStr)
  const map: Record<string, number> = {}
  for (const d of rows) {
    // API /records/defect ส่ง field ชื่อ "model", "line", "defect_mode"
    const key = groupBy === 'model'       ? (d.model       || '—')
              : groupBy === 'line'        ? (d.line        || '—')
              : (d.defect_mode || '—')
    map[key] = (map[key] || 0) + 1
  }
  const total = rows.length
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({
      label, count,
      pct: total ? Math.round((count / total) * 100) : 0,
    }))
}

// ── Gauge ──────────────────────────────────────────────────────────
function Gauge({ ratio, target }: { ratio: number; target: number }) {
  const max  = target * 2
  const pct  = Math.min(ratio / max, 1)
  const over = ratio >= target

  function polar(deg: number, r: number) {
    const rad = ((deg - 90) * Math.PI) / 180
    return { x: 60 + r * Math.cos(rad), y: 65 + r * Math.sin(rad) }
  }
  function arc(s: number, e: number, r: number) {
    const a = polar(s, r), b = polar(e, r)
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
  }

  const angleDeg  = -135 + pct * 270
  const needleTip = polar(angleDeg, 33)
  const tDeg = -135 + (target / max) * 270
  const ti = polar(tDeg, 34), to = polar(tDeg, 50)

  return (
    <svg width="120" height="88" viewBox="0 0 120 95" style={{ flexShrink: 0 }}>
      <path d={arc(-135, 135, 42)} fill="none" stroke="#f0f0f0" strokeWidth="9" strokeLinecap="round" />
      <path d={arc(-135, -135 + pct * 270, 42)} fill="none"
        stroke={over ? '#C0001A' : '#7BC67A'} strokeWidth="9" strokeLinecap="round" />
      <line x1={ti.x} y1={ti.y} x2={to.x} y2={to.y}
        stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="65" x2={needleTip.x} y2={needleTip.y}
        stroke={over ? '#C0001A' : '#374151'} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="60" cy="65" r="4" fill={over ? '#C0001A' : '#374151'} />
      <text x="60" y="90" textAnchor="middle" fontSize="12" fontWeight="800"
        fill={over ? '#C0001A' : '#111827'} fontFamily="inherit">
        {ratio.toFixed(2)}%
      </text>
    </svg>
  )
}

// ── Hourly bar chart ───────────────────────────────────────────────
function HourlyChart({ buckets }: { buckets: HourBucket[] }) {
  const peak = Math.max(...buckets.map(b => b.count), 1)
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, flex: 1, minHeight: 0, paddingBottom: 6 }}>
        {buckets.map(b => {
          const hPct  = b.count > 0 ? Math.max((b.count / peak) * 100, 10) : 2
          const ratio = b.count / peak
          const col   = b.count === 0 ? '#f3f4f6'
                      : ratio > 0.65  ? '#C0001A'
                      : ratio > 0.35  ? '#F5A623'
                      : '#7BC67A'
          return (
            <div key={b.hour} title={`${b.label}  •  ${b.count} defects`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 3 }}>
              {b.count > 0 && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: col, lineHeight: 1 }}>{b.count}</span>
              )}
              <div style={{ width: '100%', height: `${hPct}%`, background: col, borderRadius: '4px 4px 0 0', transition: 'height .35s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 4, borderTop: '1px solid #f3f4f6', paddingTop: 5 }}>
        {buckets.map(b => (
          <div key={b.hour} style={{ flex: 1, textAlign: 'center', fontSize: 8, color: '#9ca3af', overflow: 'hidden' }}>
            {b.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Top-5 row ──────────────────────────────────────────────────────
const RANK_COLORS = ['#C0001A', '#F5A623', '#6DB8E8', '#9B8FC4', '#7BC67A']

function Top5Row({ item, rank }: { item: TopItem; rank: number }) {
  const color = RANK_COLORS[rank] ?? '#ccc'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 24, height: 24, borderRadius: 7,
        background: color, color: '#fff',
        fontSize: 11, fontWeight: 800, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {rank + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {item.label}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color, flexShrink: 0, marginLeft: 8 }}>
            {item.count}
            <span style={{ fontSize: 10.5, color: '#9ca3af', fontWeight: 500, marginLeft: 3 }}>({item.pct}%)</span>
          </span>
        </div>
        <div style={{ height: 5, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${item.pct}%`, background: color, borderRadius: 99, transition: 'width .45s ease' }} />
        </div>
      </div>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────
function Skel({ w = '100%', h = 14, r = 4 }: { w?: string | number; h?: number; r?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg,#f0f0f0 25%,#f8f8f8 50%,#f0f0f0 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

// ── Styled select dropdown ─────────────────────────────────────────
function StyledSelect({
  value, onChange, options, icon,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  icon?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      border: '1px solid #e5e7eb', borderRadius: 8,
      background: '#f9fafb', padding: '0 10px',
      height: 34, minWidth: 140,
    }}>
      {icon && (
        <span style={{ color: '#9ca3af', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {icon}
        </span>
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          flex: 1, border: 'none', background: 'transparent', outline: 'none',
          fontSize: 13, fontFamily: 'inherit', color: '#374151',
          cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', fontWeight: 600,
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, pointerEvents: 'none' }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

// ── Live dot indicator ─────────────────────────────────────────────
function LiveDot({ active }: { active: boolean }) {
  return (
    <div title={active ? 'Real-time connected' : 'Disconnected'} style={{
      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: active ? '#059669' : '#d1d5db',
      boxShadow: active ? '0 0 0 3px #05966922' : 'none',
      transition: 'all .3s',
    }} />
  )
}

// ══════════════════════════════════════════════════════════════════
//  Page
// ══════════════════════════════════════════════════════════════════
export default function OverviewPage() {
  const [status,    setStatus]    = useState<DailyStatus | null>(null)
  const [defects,   setDefects]   = useState<DefectRecord[]>([])
  const [loading,   setLoading]   = useState(true)
  const [groupBy,   setGroupBy]   = useState<'model' | 'line' | 'defect_mode'>('model')
  const [shiftView, setShiftView] = useState<'day' | 'night'>('day')
  const [nowDate,   setNowDate]   = useState(new Date().toISOString().slice(0, 10))
  const [clockStr,  setClockStr]  = useState('')
  const [wsAlive,   setWsAlive]   = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // ── Clock ────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setNowDate(n.toISOString().slice(0, 10))
      setClockStr(
        `${n.getDate()} ${n.toLocaleString('en-US', { month: 'short' })} ${n.getFullYear()}` +
        `  ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
      )
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Fetch ────────────────────────────────────────────────────
  // /correction/today  → status card (defect_count, volume, ratio_today)
  // /records/defect    → raw list สำหรับคำนวณ Top5 + Hourly chart
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, d] = await Promise.all([
        fetch(`${API}/correction/today`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
        fetch(`${API}/records/defect`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => []),
      ])
      setStatus(s)
      setDefects(Array.isArray(d) ? d : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── WebSocket: refresh อัตโนมัติเมื่อมีข้อมูลใหม่ ──────────
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      try {
        const ws = new WebSocket(WS)
        wsRef.current = ws

        ws.onopen  = () => setWsAlive(true)
        ws.onclose = () => {
          setWsAlive(false)
          retryTimer = setTimeout(connect, 5_000)   // reconnect หลัง 5 วิ
        }
        ws.onerror = () => ws.close()
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'defect_inserted' || msg.type === 'data_updated') {
              fetchAll()
            }
          } catch { /* ignore parse error */ }
        }
      } catch { /* ignore connect error */ }
    }

    connect()
    return () => {
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [fetchAll])

  // ── Derived ──────────────────────────────────────────────────
  const totalDefect = status?.defect_count ?? 0
  const volume      = status?.volume       ?? 0
  const ratio       = status?.ratio_today  ?? 0
  const isOver      = ratio >= TARGET

  const top5        = buildTop5(defects, nowDate, groupBy)
  const hourly      = buildHourBuckets(defects, shiftView, nowDate)
  const totalHourly = hourly.reduce((s, b) => s + b.count, 0)
  const peakHour    = Math.max(...hourly.map(b => b.count), 0)

  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid rgba(0,0,0,.08)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
  }

  const GROUP_OPTIONS = [
    { value: 'model',       label: 'Model' },
    { value: 'line',        label: 'Line' },
    { value: 'defect_mode', label: 'Defect Mode' },
  ]
  const SHIFT_OPTIONS = [
    { value: 'day',   label: '☀  Day  (07:30 – 19:29)' },
    { value: 'night', label: '☽  Night (19:30 – 07:29)' },
  ]

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#F8FAFC', overflow: 'hidden',
      fontFamily: 'var(--font-anaheim), var(--font-sarabun), sans-serif',
    }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* ── Header ── */}
      <div style={{ padding: '22px 28px 14px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>Overview</h1>
          <span style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginTop: 3 }}>Dashboard &gt; Overview</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <LiveDot active={wsAlive} />
          <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>{wsAlive ? 'Live' : 'Offline'}</span>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{clockStr}</span>
          <button onClick={fetchAll} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', background: '#fff',
            border: '1px solid rgba(0,0,0,.08)', borderRadius: 8,
            fontSize: 12, color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, padding: '0 24px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ══ Row 1: stat cards ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1fr', gap: 14, flexShrink: 0 }}>

          {/* Status */}
          <div style={{ ...card, padding: '20px 22px', flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</p>
              {loading ? (
                <><Skel w="65%" h={22} r={6} /><div style={{ marginTop: 10 }}><Skel w="80%" h={12} r={4} /></div></>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: isOver ? '#C0001A' : '#059669',
                      boxShadow: `0 0 0 3px ${isOver ? '#C0001A22' : '#05966922'}`,
                    }} />
                    <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px', color: isOver ? '#C0001A' : '#059669' }}>
                      {isOver ? 'Over Target' : 'In Control'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>
                    Target ≤ <strong style={{ color: '#374151' }}>{TARGET}%</strong>
                    <span style={{
                      marginLeft: 10, fontSize: 11, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 20,
                      background: isOver ? '#FEF2F2' : '#ECFDF5',
                      color: isOver ? '#B91C1C' : '#065F46',
                    }}>
                      Today {ratio.toFixed(2)}%
                    </span>
                  </p>
                </>
              )}
            </div>
            {!loading && <Gauge ratio={ratio} target={TARGET} />}
          </div>

          {/* Total Defect */}
          <div style={{ ...card, padding: '20px 22px' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Defect</p>
            {loading ? (
              <><Skel w="55%" h={44} r={6} /><div style={{ marginTop: 10 }}><Skel w="70%" h={12} r={4} /></div><div style={{ marginTop: 10 }}><Skel w="100%" h={4} r={99} /></div></>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 44, fontWeight: 800, color: '#111827', lineHeight: 1, letterSpacing: '-2px' }}>
                    {totalDefect.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 500 }}>pcs</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>
                  Volume: <strong style={{ color: '#374151' }}>{volume.toLocaleString()}</strong> pcs today
                </p>
                <div style={{ height: 4, background: '#f3f4f6', borderRadius: 99, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, transition: 'width .4s ease',
                    width: `${Math.min(volume ? (totalDefect / volume * 100 / TARGET * 100) : 0, 100)}%`,
                    background: isOver ? '#C0001A' : '#7BC67A',
                  }} />
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 11, color: '#9ca3af' }}>
                  {volume > 0
                    ? `${(totalDefect / volume * 100).toFixed(2)}% of volume`
                    : 'No volume recorded today'}
                </p>
              </>
            )}
          </div>

          {/* Defect Ratio */}
          <div style={{ ...card, padding: '20px 22px' }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Defect Ratio</p>
            {loading ? (
              <><Skel w="55%" h={44} r={6} /><div style={{ marginTop: 10 }}><Skel w="70%" h={12} r={4} /></div><div style={{ marginTop: 10 }}><Skel w="100%" h={4} r={99} /></div></>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, letterSpacing: '-2px', color: isOver ? '#C0001A' : '#111827' }}>
                    {ratio.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 18, color: '#9ca3af', fontWeight: 600 }}>%</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>
                  Target ≤ <strong style={{ color: '#374151' }}>{TARGET}%</strong>
                  <span style={{
                    marginLeft: 8, fontSize: 11, fontWeight: 700,
                    padding: '2px 7px', borderRadius: 20,
                    background: isOver ? '#FEF2F2' : '#ECFDF5',
                    color: isOver ? '#B91C1C' : '#065F46',
                  }}>
                    {isOver ? `▲ +${(ratio - TARGET).toFixed(2)}%` : `▼ −${(TARGET - ratio).toFixed(2)}%`}
                  </span>
                </p>
                <div style={{ height: 4, background: '#f3f4f6', borderRadius: 99, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, transition: 'width .4s ease',
                    width: `${Math.min((ratio / (TARGET * 2)) * 100, 100)}%`,
                    background: isOver ? '#C0001A' : '#7BC67A',
                  }} />
                </div>
                <p style={{ margin: '5px 0 0', fontSize: 11, color: '#9ca3af' }}>
                  {isOver ? 'Exceeded target threshold' : 'Within acceptable range'}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ══ Row 2: Top 5 + Hourly ══ */}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 14 }}>

          {/* Top 5 */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(0,0,0,.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111827', flexShrink: 0 }}>Top 5</span>
              <StyledSelect
                value={groupBy}
                onChange={v => setGroupBy(v as 'model' | 'line' | 'defect_mode')}
                options={GROUP_OPTIONS}
                icon={
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                }
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loading
                ? [1,2,3,4,5].map(i => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: '#f3f4f6', flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <Skel w={`${80 - i * 10}%`} h={13} r={4} />
                      <Skel w="100%" h={5} r={99} />
                    </div>
                  </div>
                ))
                : top5.length === 0
                ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 13 }}>
                    No defects today
                  </div>
                : top5.map((item, i) => <Top5Row key={item.label + i} item={item} rank={i} />)
              }
            </div>

            <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(0,0,0,.06)', flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, color: '#9ca3af' }}>
                Total today: <strong style={{ color: '#374151' }}>{totalDefect}</strong> defects
              </span>
            </div>
          </div>

          {/* Hourly Chart */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(0,0,0,.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111827', flexShrink: 0 }}>Hourly Defects</span>
              <StyledSelect
                value={shiftView}
                onChange={v => setShiftView(v as 'day' | 'night')}
                options={SHIFT_OPTIONS}
                icon={
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                }
              />
            </div>

            <div style={{ padding: '12px 20px', borderBottom: '1px solid #f9fafb', display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
              <div>
                <p style={{ margin: 0, fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {shiftView === 'day' ? 'Day Shift' : 'Night Shift'}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1 }}>
                  {loading ? '—' : totalHourly}
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#9ca3af', marginLeft: 4 }}>pcs</span>
                </p>
              </div>
              <div style={{ width: 1, alignSelf: 'stretch', background: '#f3f4f6' }} />
              <div style={{ display: 'flex', gap: 14 }}>
                {[
                  { color: '#7BC67A', label: 'Low' },
                  { color: '#F5A623', label: 'Med' },
                  { color: '#C0001A', label: 'High' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                    <span style={{ fontSize: 11.5, color: '#9ca3af' }}>{l.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9ca3af' }}>
                Peak: <strong style={{ color: '#374151' }}>{peakHour}</strong>/hr
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: '16px 16px 6px', display: 'flex', flexDirection: 'column' }}>
              {loading
                ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 13 }}>Loading…</div>
                : <HourlyChart buckets={hourly} />
              }
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}