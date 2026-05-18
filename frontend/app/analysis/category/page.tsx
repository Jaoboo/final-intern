'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { API } from '../../shared'
import { useSharedFilters, loadCachedOpts, saveCachedOpts, emptyFilters, consumeTabNav } from '../useSharedFilters'
import type { Filters, DatePreset } from '../useSharedFilters'

// ── Theme colors ─────────────────────────────────────────────────────
const T = {
  primary:    '#3B5BDB',
  primaryBg:  '#EEF2FF',
  danger:     '#C92A2A',
  border:     '#DEE2E6',
  bg:         '#F1F3F5',
  card:       '#FFFFFF',
  text:       '#212529',
  textMuted:  '#868E96',
  textLight:  '#ADB5BD',
  warning:    '#E67700',
}

// Category palette — each of the 4 cards has its own accent
const CAT_COLORS: Record<string, { accent: string; soft: string; glow: string }> = {
  tank_top: { accent: '#4b4b4b', soft: '#e6f0ff', glow: 'rgba(192,0,26,0.12)' },
  tank_btm: { accent: '#4b4b4b', soft: '#e6f0ff', glow: 'rgba(230,119,0,0.12)' },
  ph_top:   { accent: '#4b4b4b', soft: '#e6f0ff', glow: 'rgba(25,113,194,0.12)' },
  ph_btm:   { accent: '#4b4b4b', soft: '#e6f0ff', glow: 'rgba(103,65,217,0.12)' },
}

const CAT_LABELS: Record<string, string> = {
  tank_top: 'Tank Top',
  tank_btm: 'Tank Btm',
  ph_top:   'P/H Top',
  ph_btm:   'P/H Btm',
}

function shiftParam(f: Filters): string {
  if (f.shiftA && f.shiftB) return ''
  if (f.shiftA) return 'A'
  if (f.shiftB) return 'B'
  return ''
}

function getRange(preset: DatePreset, s: string, e: string): { start: string; end: string } {
  const today = new Date(), fmt = (d: Date) => d.toISOString().slice(0, 10)
  if (preset === 'custom')     return { start: s, end: e }
  if (preset === 'this_year')  return { start: `${today.getFullYear()}-01-01`, end: fmt(today) }
  if (preset === 'this_month') { const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, '0'); return { start: `${y}-${m}-01`, end: fmt(today) } }
  if (preset === 'this_week')  { const day = today.getDay(), diff = today.getDate() - day + (day === 0 ? -6 : 1); return { start: fmt(new Date(today.getFullYear(), today.getMonth(), diff)), end: fmt(today) } }
  return { start: '', end: '' }
}

function getDateLabel(preset: DatePreset, s: string, e: string): string {
  const today = new Date(), mn = today.toLocaleString('en-US', { month: 'short' })
  if (preset === 'this_month') return `${mn} ${today.getFullYear()}`
  if (preset === 'this_year')  return `Year ${today.getFullYear()}`
  if (preset === 'this_week')  return 'This Week'
  if (preset === 'custom' && s && e) return `${s} – ${e}`
  return 'Select Date'
}

// ── Date Picker Popover ──────────────────────────────────────────── //
function DatePickerPopover({ filters, onChange, onClose }: {
  filters: Filters
  onChange: (f: Filters) => void
  onClose: () => void
}) {
  const presets: { value: DatePreset; label: string }[] = [
    { value: 'this_year', label: 'This Year' },
    { value: 'this_month', label: 'This Month' },
    { value: 'this_week', label: 'This Week' },
    { value: 'custom', label: 'Custom Range' },
  ]
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={onClose} />
      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200, background: '#fff', border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: '0 6px 20px rgba(0,0,0,.11)', padding: 8, minWidth: 170 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {presets.map(p => (
            <button key={p.value} onClick={() => onChange({ ...filters, datePreset: p.value })}
              style={{ padding: '6px 9px', borderRadius: 6, border: 'none', textAlign: 'left', background: filters.datePreset === p.value ? T.primaryBg : 'transparent', color: filters.datePreset === p.value ? T.primary : T.text, fontWeight: filters.datePreset === p.value ? 700 : 400, fontSize: 12.5, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif' }}>
              {p.label}
            </button>
          ))}
        </div>
        {filters.datePreset === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 7, marginTop: 5, borderTop: `1px solid ${T.border}` }}>
            {(['Start', 'End'] as const).map(lbl => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 10, color: T.textMuted, width: 26 }}>{lbl}</span>
                <input type="date"
                  value={lbl === 'Start' ? filters.startDate : filters.endDate}
                  onChange={e => onChange({ ...filters, [lbl === 'Start' ? 'startDate' : 'endDate']: e.target.value })}
                  style={{ flex: 1, padding: '4px 6px', border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 11, fontFamily: 'Sarabun,sans-serif', outline: 'none', color: T.text }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────── //
// Types
// ─────────────────────────────────────────────────────────────────── //
interface ModeNode {
  defect_mode: string
  defect_count: number
  expanded: boolean
  parts: { part_no: string; defect_count: number }[]
}

interface BreakdownSection {
  total_defect: number
  by_mode: { defect_mode: string; defect_count: number }[]
  by_part: { part_no: string; defect_count: number }[]
}

// ─────────────────────────────────────────────────────────────────── //
// SVG curved connector
// ─────────────────────────────────────────────────────────────────── //
function CurvedConnector({ x1, y1, x2, y2, color }: {
  x1: number; y1: number; x2: number; y2: number; color: string
}) {
  const mx = (x1 + x2) / 2
  return (
    <path
      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
      fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.3}
    />
  )
}

// ─────────────────────────────────────────────────────────────────── //
// Mind-Map Card
// ─────────────────────────────────────────────────────────────────── //
function MindMapCard({ catKey, data }: { catKey: string; data: BreakdownSection | null }) {
  const { accent, soft, glow } = CAT_COLORS[catKey]
  const label = CAT_LABELS[catKey]

  const [nodes, setNodes] = useState<ModeNode[]>([])

  useEffect(() => {
    if (!data || data.total_defect === 0) { setNodes([]); return }
    setNodes(
      data.by_mode.slice(0, 3).map(m => ({
        defect_mode:   m.defect_mode,
        defect_count:  m.defect_count,
        expanded:      false,
        // top-3 parts (global for this section from API)
        parts: data.by_part.slice(0, 3),
      }))
    )
  }, [data])

  const toggleNode = (idx: number) =>
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, expanded: !n.expanded } : n))

  const closeNode = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, expanded: false } : n))
  }

  // ── Layout constants ──────────────────────────────────────────────
  const CARD_W   = 370
  const ROOT_X   = 68
  const MODE_X   = 168
  const PART_X   = 296
  const MODE_GAP = 58
  const PART_GAP = 30

  // Compute SVG height and y-positions dynamically
  const totalModeH = nodes.length * MODE_GAP
  const extraH     = nodes.reduce((a, n) => a + (n.expanded ? n.parts.length * PART_GAP : 0), 0)
  const svgH       = Math.max(150, totalModeH + extraH + 60)

  let curY = (svgH - (totalModeH + extraH - MODE_GAP)) / 2
  const modeYs:   number[]   = []
  const partYsArr: number[][] = []

  for (let i = 0; i < nodes.length; i++) {
    modeYs.push(curY)
    if (nodes[i].expanded) {
      const pys = nodes[i].parts.map(
        (_, j) => curY + (j - (nodes[i].parts.length - 1) / 2) * PART_GAP
      )
      partYsArr.push(pys)
      curY += nodes[i].parts.length * PART_GAP + 8
    } else {
      partYsArr.push([])
      curY += MODE_GAP
    }
  }

  const rootY    = svgH / 2
  const maxCount = nodes[0]?.defect_count || 1

  if (!data || data.total_defect === 0) {
    return (
      <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, padding: '14px 16px', minHeight: 120, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 6 }}>{label}</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textLight, fontSize: 11.5 }}>No data</div>
      </div>
    )
  }

  return (
    <div style={{ background: T.card, borderRadius: 10, border: `1.5px solid ${accent}28`, boxShadow: `0 2px 14px ${glow}`, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '8px 14px', background: soft, borderBottom: `1px solid ${accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: accent, fontFamily: 'Sarabun,sans-serif' }}>{label}</span>
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, background: '#fff', border: `1px solid ${T.border}`, borderRadius: 20, padding: '2px 10px' }}>
          Total <span style={{ color: accent, fontWeight: 700 }}>{data.total_defect.toLocaleString()}</span>
        </div>
      </div>

      {/* Mind-map SVG */}
      <svg width={CARD_W} height={svgH} style={{ display: 'block', overflow: 'visible' }}>

        {/* ── Root node ── */}
        <rect x={6} y={rootY - 19} width={ROOT_X - 4} height={38} rx={7} fill={accent} opacity={0.9} />
        <text x={(ROOT_X - 4) / 2 + 4} y={rootY - 4} textAnchor="middle" dominantBaseline="middle"
          fontSize={9} fontWeight={700} fill="#fff" fontFamily="Sarabun,sans-serif">Defect</text>
        <text x={(ROOT_X - 4) / 2 + 4} y={rootY + 8} textAnchor="middle" dominantBaseline="middle"
          fontSize={8.5} fontWeight={600} fill="rgba(255,255,255,0.75)" fontFamily="Sarabun,sans-serif">
          {data.total_defect.toLocaleString()}
        </text>

        {/* ── Connectors root → mode ── */}
        {nodes.map((_, i) => (
          <CurvedConnector key={i} x1={ROOT_X - 4} y1={rootY} x2={MODE_X - 6} y2={modeYs[i]} color={accent} />
        ))}

        {/* ── Mode nodes ── */}
        {nodes.map((n, i) => {
          const my   = modeYs[i]
          const barW = Math.max(16, (n.defect_count / maxCount) * 68)

          return (
            <g key={i}>
              {/* Mode card — clickable */}
              <g style={{ cursor: 'pointer' }} onClick={() => toggleNode(i)}>
                <rect x={MODE_X - 6} y={my - 16} width={90} height={32} rx={7}
                  fill={n.expanded ? accent : soft}
                  stroke={accent} strokeWidth={n.expanded ? 0 : 1} strokeOpacity={0.4}
                />
                {/* mini progress bar (only when collapsed) */}
                {!n.expanded && (
                  <rect x={MODE_X - 5} y={my + 7} width={barW} height={3} rx={1.5}
                    fill={accent} opacity={0.22} />
                )}
                <text x={MODE_X} y={my - 4} fontSize={8.5} fontWeight={700}
                  fill={n.expanded ? '#fff' : accent} fontFamily="Sarabun,sans-serif"
                  style={{ pointerEvents: 'none' }}>
                  {n.defect_mode.length > 14 ? n.defect_mode.slice(0, 13) + '…' : n.defect_mode}
                </text>
                <text x={MODE_X} y={my + 7} fontSize={8} fontWeight={600}
                  fill={n.expanded ? 'rgba(255,255,255,0.7)' : T.textMuted} fontFamily="Sarabun,sans-serif"
                  style={{ pointerEvents: 'none' }}>
                  {n.defect_count.toLocaleString()}
                </text>
              </g>

              {/* +/− button */}
              {n.expanded ? (
                <g onClick={e => closeNode(e, i)} style={{ cursor: 'pointer' }}>
                  <circle cx={MODE_X + 84} cy={my} r={8} fill="#fff" stroke={accent} strokeWidth={1.3} />
                  <line x1={MODE_X + 80} y1={my} x2={MODE_X + 88} y2={my} stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
                </g>
              ) : (
                <g onClick={() => toggleNode(i)} style={{ cursor: 'pointer' }}>
                  <circle cx={MODE_X + 84} cy={my} r={8} fill={soft} stroke={accent} strokeWidth={1.3} strokeOpacity={0.45} />
                  <line x1={MODE_X + 80} y1={my} x2={MODE_X + 88} y2={my} stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeOpacity={0.55} />
                  <line x1={MODE_X + 84} y1={my - 4} x2={MODE_X + 84} y2={my + 4} stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeOpacity={0.55} />
                </g>
              )}

              {/* ── Part child nodes (when expanded) ── */}
              {n.expanded && partYsArr[i].map((py, j) => {
                const part = n.parts[j]
                if (!part) return null
                const pMaxCount = n.parts[0]?.defect_count || 1
                const pBarW = Math.max(10, (part.defect_count / pMaxCount) * 62)
                return (
                  <g key={j}>
                    {/* connector mode → part */}
                    <CurvedConnector x1={MODE_X + 92} y1={my} x2={PART_X - 4} y2={py} color={accent} />
                    {/* part chip */}
                    <rect x={PART_X - 4} y={py - 13} width={76} height={26} rx={6}
                      fill="#fff" stroke={accent} strokeWidth={1} strokeOpacity={0.28} />
                    {/* part mini bar */}
                    <rect x={PART_X - 3} y={py + 6} width={pBarW} height={3} rx={1.5}
                      fill={accent} opacity={0.18} />
                    <text x={PART_X} y={py - 2} fontSize={8} fontWeight={700}
                      fill={T.text} fontFamily="Sarabun,sans-serif">
                      {part.part_no.length > 11 ? part.part_no.slice(0, 10) + '…' : part.part_no}
                    </text>
                    <text x={PART_X} y={py + 7} fontSize={7.5} fontWeight={500}
                      fill={T.textMuted} fontFamily="Sarabun,sans-serif">
                      {part.defect_count.toLocaleString()}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Inner Page ───────────────────────────────────────────────────── //
function CategoryPageInner() {
  const { filters, setFilters, updateFilter, navigateTo, pathname } = useSharedFilters()
  const suppressLoadingRef = useRef(consumeTabNav())

  const [loading,        setLoading]        = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [breakdown,      setBreakdown]      = useState<any>(null)

  const [modelOpts,      setModelOpts]      = useState<string[]>([])
  const [lineOpts,       setLineOpts]       = useState<string[]>([])
  const [defectModeOpts, setDefectModeOpts] = useState<string[]>([])

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const cached = loadCachedOpts()
    if (cached) {
      setModelOpts(cached.models); setLineOpts(cached.lines); setDefectModeOpts(cached.defectModes)
      return
    }
    Promise.all([
      fetch(`${API}/options/models`).then(r => r.json()).catch(() => []),
      fetch(`${API}/options/lines`).then(r => r.json()).catch(() => []),
      fetch(`${API}/options/defect-modes`).then(r => r.json()).catch(() => []),
    ]).then(([m, l, d]) => {
      const models = Array.isArray(m) ? m : []
      const lines  = Array.isArray(l) ? l : []
      const defectModes = Array.isArray(d) ? d : []
      setModelOpts(models); setLineOpts(lines); setDefectModeOpts(defectModes)
      saveCachedOpts({ models, lines, defectModes })
    })
  }, [])

  const fetchData = useCallback(async (f: Filters) => {
    const suppress = suppressLoadingRef.current
    suppressLoadingRef.current = false
    if (!suppress) setLoading(true)
    try {
      const { start, end } = getRange(f.datePreset, f.startDate, f.endDate)
      const p = new URLSearchParams()
      if (start) p.set('date_from', start)
      if (end)   p.set('date_to',   end)
      const sh = shiftParam(f); if (sh) p.set('shift', sh)
      if (f.model)      p.set('model',       f.model)
      if (f.defectMode) p.set('defect_mode', f.defectMode)
      if (f.line)       p.set('line',        f.line)
      const bd = await fetch(`${API}/analyze/breakdown?${p}`).then(r => r.json()).catch(() => null)
      setBreakdown(bd && typeof bd === 'object' ? bd : null)
    } finally { if (!suppress) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!suppressLoadingRef.current) fetchData(filters)
  }, []) // eslint-disable-line

  const handleDateChange = useCallback((next: Filters) => {
    setFilters(next, fetchData)
  }, [setFilters, fetchData])

  const handleUpdateFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    updateFilter(key, value, fetchData)
  }, [updateFilter, fetchData])

  const handleReset = () => {
    const f = emptyFilters()
    setFilters(f, fetchData)
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchData(f)
  }

  return (
    <div style={{ background: T.bg, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════ */}
      <div style={{ height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>Analysis</div>
          <div style={{ fontSize: 10, color: T.textMuted }}>Analysis &gt; Catalog</div>
        </div>
        <div style={{ display: 'flex', gap: 2, background: '#E9ECEF', borderRadius: 7, padding: 3 }}>
          {([
            { label: 'Summarize', href: '/analysis/trend'    },
            { label: 'Catalog',   href: '/analysis/category' },
          ]).map(v => {
            const active = pathname === v.href
            return (
              <button key={v.href} onClick={() => navigateTo(v.href)}
                style={{ padding: '5px 16px', borderRadius: 5, border: 'none', cursor: 'pointer', background: active ? T.primary : 'transparent', color: active ? '#fff' : T.textMuted, fontWeight: 600, fontSize: 12, fontFamily: 'Sarabun,sans-serif', boxShadow: active ? `0 1px 5px ${T.primary}44` : 'none', transition: 'all .15s' }}>
                {v.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ══ FILTER BAR ══════════════════════════════════════════════ */}
      <div style={{ flexShrink: 0, margin: '0 22px 10px', background: T.card, borderRadius: 8, border: `1px solid ${T.border}`, padding: '8px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>

          {/* Date */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'relative', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: T.text }}>Date</span>
              <span style={{ fontSize: 9, color: T.textMuted }}>prod. date</span>
            </div>
            <button onClick={() => setShowDatePicker(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 11.5, color: T.text, fontWeight: 500, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', whiteSpace: 'nowrap' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              {getDateLabel(filters.datePreset, filters.startDate, filters.endDate)}
            </button>
            {showDatePicker && (
              <DatePickerPopover filters={filters} onChange={handleDateChange} onClose={() => setShowDatePicker(false)} />
            )}
          </div>

          <div style={{ width: 1, height: 28, background: T.border, flexShrink: 0 }} />

          {/* Shift */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: T.text }}>Shift</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {(['A', 'B'] as const).map(s => {
                const on = s === 'A' ? filters.shiftA : filters.shiftB
                return (
                  <button key={s} onClick={() => handleUpdateFilter(s === 'A' ? 'shiftA' : 'shiftB', !on)}
                    style={{ height: 28, width: 32, borderRadius: 5, border: `1.5px solid ${on ? T.primary : T.border}`, background: on ? T.primary : '#fff', color: on ? '#fff' : T.textMuted, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .15s' }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ width: 1, height: 28, background: T.border, flexShrink: 0 }} />

          {/* Line / Model / Defect Mode */}
          {([
            { label: 'Line',        val: filters.line,       key: 'line',       opts: lineOpts,       w: 90  },
            { label: 'Model',       val: filters.model,      key: 'model',      opts: modelOpts,      w: 110 },
            { label: 'Defect Mode', val: filters.defectMode, key: 'defectMode', opts: defectModeOpts, w: 130 },
          ] as const).map(({ label: lbl2, val, key, opts, w }) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: T.text }}>{lbl2}</span>
              <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${T.border}`, borderRadius: 5, padding: '0 7px', height: 28, background: '#fff', width: w }}>
                <select value={val} onChange={e => handleUpdateFilter(key as keyof Filters, e.target.value)}
                  style={{ border: 'none', outline: 'none', fontSize: 11.5, color: val ? T.text : T.textMuted, background: 'transparent', fontFamily: 'Sarabun,sans-serif', flex: 1, cursor: 'pointer', width: '100%' }}>
                  <option value="">All</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          ))}

          <div style={{ flex: 1 }} />

          {/* Reload */}
          <button onClick={() => fetchData(filters)} disabled={loading} title="Reload"
            style={{ height: 28, width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 5, cursor: 'pointer', color: T.textMuted, flexShrink: 0, opacity: loading ? .6 : 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.18-8.93" />
            </svg>
          </button>

          {/* Reset */}
          <button onClick={handleReset}
            style={{ height: 28, padding: '0 11px', display: 'flex', alignItems: 'center', gap: 4, background: '#fff', border: `1px solid ${T.danger}55`, borderRadius: 5, cursor: 'pointer', color: T.danger, fontWeight: 700, fontSize: 11.5, fontFamily: 'Sarabun,sans-serif', flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            reset
          </button>

          {loading && (
            <div style={{ width: 14, height: 14, border: `2px solid ${T.border}`, borderTop: `2px solid ${T.primary}`, borderRadius: '50%', animation: 'az-spin .7s linear infinite', flexShrink: 0 }} />
          )}
        </div>
      </div>

      {/* ══ CONTENT ══════════════════════════════════════════════════ */}
      <div style={{ flex: 1, minHeight: 0, padding: '0 22px 12px', overflowY: 'auto' }}>

        {/* Usage hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <circle cx="5.5" cy="5.5" r="5" fill="none" stroke={T.textLight} strokeWidth="1" />
            <line x1="5.5" y1="3" x2="5.5" y2="6" stroke={T.textLight} strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="5.5" cy="7.8" r=".7" fill={T.textLight} />
          </svg>
          <span style={{ fontSize: 10, color: T.textLight, fontFamily: 'Sarabun,sans-serif' }}>
            คลิก <b>+ node</b> เพื่อดู top-3 P/H · คลิก <b>−</b> เพื่อปิด
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(['tank_top', 'tank_btm', 'ph_top', 'ph_btm'] as const).map(key => (
            <MindMapCard key={key} catKey={key} data={breakdown?.[key] ?? null} />
          ))}
        </div>
      </div>

      <style>{`@keyframes az-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

export default function AnalysisCategoryPage() {
  return (
    <Suspense>
      <CategoryPageInner />
    </Suspense>
  )
}