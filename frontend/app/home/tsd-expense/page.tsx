'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import * as echarts from 'echarts'
import { API, authHeaders } from '../../shared'

// ── Types ──────────────────────────────────────────────────────────
interface TSDRecord {
  no:               number
  date_day:         string
  shift_group:      string
  'department name': string
  scrap_code:       string
  item:             string
  price:            number
  quantity:         number
  unit:             string
  'Total actual':   number
  _id:              number
}

// ── Constants ──────────────────────────────────────────────────────
const SCRAP_COLORS: Record<string, string> = {
  '31': '#f9a8c9',
  '32': '#93c5fd',
  '35': '#7b85c4',
  '39': '#ef4444',
}

const DEPT_COLORS = [
  '#3B82F6','#1e3a8a','#f97316','#a855f7',
  '#ec4899','#8b5cf6','#f59e0b','#06b6d4',
  '#10b981','#6366f1','#e11d48','#0ea5e9',
  '#84cc16','#14b8a6','#f43f5e','#8b5cf6',
]

// ── Helpers ────────────────────────────────────────────────────────
function getYearMonth(d: string) {
  if (!d) return ''
  return d.slice(0, 7).replace('-', '')
}

function getFY(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  const m = dt.getMonth() + 1
  const y = dt.getFullYear()
  return m >= 4 ? `FY${y}` : `FY${y - 1}`
}

function getMonthNum(d: string) {
  if (!d) return ''
  return String(new Date(d).getMonth() + 1).padStart(2, '0')
}

function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtFull(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2 })
}

// ── EChart hook ────────────────────────────────────────────────────
function useEChart(
  ref: React.RefObject<HTMLDivElement | null>,
  option: echarts.EChartsOption | null,
  onEvents?: Record<string, (p: any) => void>,
) {
  const chartRef = useRef<echarts.ECharts | null>(null)

  // Init once on mount
  useEffect(() => {
    if (!ref.current) return
    const instance = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = instance
    const resize = () => instance.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      instance.dispose()
      chartRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update option whenever it changes
  useEffect(() => {
    if (!chartRef.current || !option) return
    chartRef.current.setOption(option, { notMerge: true })
    // trigger resize in case container size changed
    chartRef.current.resize()
  }, [option])

  // Bind events
  useEffect(() => {
    if (!chartRef.current || !onEvents) return
    Object.entries(onEvents).forEach(([e, fn]) => chartRef.current!.on(e, fn))
    return () => { Object.keys(onEvents).forEach(e => chartRef.current?.off(e)) }
  }, [onEvents])
}

// ── FilterSelect ───────────────────────────────────────────────────
function FilterSelect({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%', height: 34, paddingLeft: 10, paddingRight: 28,
            border: '1px solid #e5e7eb', borderRadius: 8,
            background: '#fff', color: '#111827', fontSize: 13,
            outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
            fontFamily: 'inherit',
          }}
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#9ca3af', fontSize: 10 }}>▾</span>
      </div>
    </div>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = '#1462FF' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 3,
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div>}
    </div>
  )
}

// ── Panel wrapper ─────────────────────────────────────────────────
function Panel({
  title, children, extra, style,
}: {
  title: string; children: React.ReactNode; extra?: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)', ...style,
    }}>
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
        fontSize: 13, fontWeight: 700, color: '#374151',
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
        background: '#fafafa',
      }}>
        {title}
        {extra}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', fontSize: 13 }}>
      No data
    </div>
  )
}

// ── Stacked Bar Chart (Top-left) ───────────────────────────────────
function StackedBarChart({ data }: { data: TSDRecord[] }) {
  const ref = useRef<HTMLDivElement>(null)

  const { months, scrapCodes, series, totals } = useMemo(() => {
    const mSet = new Set<string>()
    const cSet = new Set<string>()
    data.forEach(r => {
      const m = getYearMonth(r.date_day)
      if (m) mSet.add(m)
      cSet.add(r.scrap_code || 'N/A')
    })
    const months = Array.from(mSet).sort()
    const scrapCodes = Array.from(cSet).sort()

    const map: Record<string, Record<string, number>> = {}
    months.forEach(m => { map[m] = {} })
    data.forEach(r => {
      const m = getYearMonth(r.date_day)
      const c = r.scrap_code || 'N/A'
      if (m) map[m][c] = (map[m][c] || 0) + (r['Total actual'] || 0)
    })

    const totals = months.map(m => Object.values(map[m]).reduce((s, v) => s + v, 0))

    const series: echarts.SeriesOption[] = scrapCodes.map(code => ({
      name: code,
      type: 'bar',
      stack: 'total',
      data: months.map(m => map[m][code] || 0),
      itemStyle: { color: SCRAP_COLORS[code] || '#94a3b8' },
      label: {
        show: true,
        formatter: (p: any) => p.value > 200_000 ? fmtK(p.value) : '',
        fontSize: 10,
        color: '#374151',
      },
    }))

    return { months, scrapCodes, series, totals }
  }, [data])

  const option = useMemo<echarts.EChartsOption>(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const items = (params as any[]).map((p: any) => `${p.marker}${p.seriesName}: ${fmtK(p.value)}`).join('<br/>')
        const total = (params as any[]).reduce((s: number, p: any) => s + p.value, 0)
        return `${params[0].name}<br/>${items}<br/><b>Total: ${fmtK(total)}</b>`
      },
    },
    legend: {
      top: 0, left: 0,
      data: scrapCodes.map(c => ({ name: c, icon: 'circle' })),
      textStyle: { fontSize: 11 },
      itemWidth: 10, itemHeight: 10,
    },
    grid: { top: 36, right: 12, bottom: 28, left: 60 },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: { fontSize: 10, color: '#9ca3af' },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#9ca3af', formatter: (v: number) => fmtK(v) },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series: [
      ...series,
      {
        type: 'bar',
        stack: 'total',
        data: months.map((_, i) => ({
          value: 0,
          label: {
            show: true,
            position: 'top',
            formatter: () => fmtK(totals[i]),
            fontSize: 10,
            fontWeight: 700,
            color: '#374151',
          },
        })),
        itemStyle: { color: 'transparent' },
        tooltip: { show: false },
      } as any,
    ],
  }), [months, scrapCodes, series, totals])

  useEChart(ref, months.length > 0 ? option : null)
  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {months.length === 0 && <Empty />}
    </div>
  )
}

// ── Pie Chart (Top-right) ─────────────────────────────────────────
function DeptPieChart({
  data, onSelect,
}: {
  data: TSDRecord[]; onSelect: (d: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const pieData = useMemo(() => {
    const map: Record<string, number> = {}
    data.forEach(r => {
      const k = r['department name'] || 'N/A'
      map[k] = (map[k] || 0) + (r['Total actual'] || 0)
    })
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value], i) => ({
        name,
        value,
        pct: total ? ((value / total) * 100).toFixed(2) : '0',
        itemStyle: { color: DEPT_COLORS[i % DEPT_COLORS.length] },
      }))
  }, [data])

  const option = useMemo<echarts.EChartsOption>(() => ({
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}<br/>฿${p.value.toLocaleString()} (${p.data.pct}%)`,
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'center',
      textStyle: { fontSize: 10 },
      itemWidth: 10,
      itemHeight: 10,
      formatter: (name: string) => {
        const d = pieData.find(x => x.name === name)
        return `${name}  ${d ? fmtK(d.value) : ''}`
      },
    },
    series: [{
      type: 'pie',
      radius: ['38%', '68%'],
      center: ['38%', '50%'],
      data: pieData,
      label: {
        show: true,
        formatter: (p: any) => `${fmtK(p.value)}\n(${p.data.pct}%)`,
        fontSize: 10,
        lineHeight: 14,
      },
      labelLine: { length: 8, length2: 6 },
      emphasis: { scale: true, scaleSize: 5 },
    }],
  }), [pieData])

  const onEvents = useMemo(() => ({ click: (p: any) => onSelect(p.name) }), [onSelect])
  useEChart(ref, pieData.length > 0 ? option : null, onEvents)
  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {pieData.length === 0 && <Empty />}
    </div>
  )
}

// ── Daily Bar Chart (Bottom-left) — ยอดเงินรวมต่อวัน + Cumulative + Target ──
function DailyLineChart({ data }: { data: TSDRecord[] }) {
  const ref = useRef<HTMLDivElement>(null)

  const { dates, actuals, cumulatives, targets } = useMemo(() => {
    // 1. รวม actual ต่อวัน
    const dayMap: Record<string, number> = {}
    data.forEach(r => {
      const d = r.date_day?.slice(0, 10)
      if (d) dayMap[d] = (dayMap[d] || 0) + (r['Total actual'] || 0)
    })
    const dates = Object.keys(dayMap).sort()
    const actuals = dates.map(d => dayMap[d])

    // 2. Monthly Cumulative Actual — สะสมภายในเดือน (reset ต้นเดือนใหม่)
    const cumulatives: number[] = []
    let runningMonth = ''
    let runningSum = 0
    dates.forEach((d, i) => {
      const ym = d.slice(0, 7)
      if (ym !== runningMonth) { runningMonth = ym; runningSum = 0 }
      runningSum += actuals[i]
      cumulatives.push(runningSum)
    })

    // 3. Monthly Target — เส้นตรงเฉลี่ยต่อวันของเดือน × n
    //    ใช้ยอดรวมจริงของเดือนนั้นหารจำนวนวันที่มีข้อมูล
    const monthTotal: Record<string, number> = {}
    const monthDays: Record<string, number> = {}
    dates.forEach((d, i) => {
      const ym = d.slice(0, 7)
      monthTotal[ym] = (monthTotal[ym] || 0) + actuals[i]
      monthDays[ym]  = (monthDays[ym]  || 0) + 1
    })
    const targets: number[] = []
    const monthSeq: Record<string, number> = {}
    dates.forEach(d => {
      const ym = d.slice(0, 7)
      monthSeq[ym] = (monthSeq[ym] || 0) + 1
      const dailyAvg = monthTotal[ym] / monthDays[ym]
      targets.push(Math.round(dailyAvg * monthSeq[ym]))
    })

    return { dates, actuals, cumulatives, targets }
  }, [data])

  const option = useMemo<echarts.EChartsOption>(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const ps = params as any[]
        const lines = ps.map((p: any) =>
          `${p.marker}${p.seriesName}: <b>฿${(p.value as number).toLocaleString()}</b>`
        )
        return `${ps[0]?.axisValue}<br/>${lines.join('<br/>')}`
      },
    },
    legend: {
      top: 2, right: 0,
      data: ['Sum of Total Actual', 'MonthlyCumulativeActual', 'MonthlyTarget'],
      textStyle: { fontSize: 10 },
      itemWidth: 14, itemHeight: 8,
      icon: 'roundRect',
    },
    grid: { top: 32, right: 56, bottom: 52, left: 64 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        fontSize: 9, color: '#9ca3af', rotate: 35,
        formatter: (v: string) => v.slice(5).replace('-', '/'),
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: [
      {
        // axis ซ้าย — Daily bar
        type: 'value',
        name: 'Daily',
        nameTextStyle: { fontSize: 9, color: '#9ca3af' },
        axisLabel: { fontSize: 10, color: '#9ca3af', formatter: (v: number) => fmtK(v) },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      {
        // axis ขวา — Cumulative / Target lines
        type: 'value',
        name: 'Cumulative',
        nameTextStyle: { fontSize: 9, color: '#9ca3af' },
        position: 'right',
        axisLabel: { fontSize: 10, color: '#9ca3af', formatter: (v: number) => fmtK(v) },
        splitLine: { show: false },
      },
    ],
    series: ([
      // Bar: Daily actual (สีฟ้า, axis ซ้าย)
      {
        name: 'Sum of Total Actual',
        type: 'bar',
        yAxisIndex: 0,
        data: actuals,
        itemStyle: { color: '#3B82F6', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 22,
        label: {
          show: true,
          position: 'top' as const,
          formatter: (p: any) => (p.value as number) > 0 ? fmtK(p.value) : '',
          fontSize: 9,
          color: '#374151',
        },
      },
      // Line: Monthly Cumulative Actual (สีส้ม, axis ขวา)
      {
        name: 'MonthlyCumulativeActual',
        type: 'line',
        yAxisIndex: 1,
        data: cumulatives,
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#f97316', width: 2 },
        itemStyle: { color: '#f97316' },
        label: {
          show: true,
          position: 'top' as const,
          formatter: (p: any) => (p.value as number) > 0 ? fmtK(p.value) : '',
          fontSize: 9,
          color: '#f97316',
        },
      },
      // Line: Monthly Target (เส้นประสีเทา, axis ขวา)
      {
        name: 'MonthlyTarget',
        type: 'line',
        yAxisIndex: 1,
        data: targets,
        smooth: false,
        symbol: 'none',
        lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' as const },
        itemStyle: { color: '#94a3b8' },
        label: {
          show: true,
          formatter: (p: any) => {
            const idx = p.dataIndex as number
            const curYm  = dates[idx]?.slice(0, 7) ?? ''
            const nextYm = dates[idx + 1]?.slice(0, 7) ?? ''
            return (curYm !== nextYm || idx === dates.length - 1)
              ? fmtK(p.value)
              : ''
          },
          fontSize: 9,
          color: '#64748b',
          position: 'top' as const,
        },
      },
    ] as echarts.SeriesOption[]),
  }), [dates, actuals, cumulatives, targets])

  useEChart(ref, dates.length > 0 ? option : null)
  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {dates.length === 0 && <Empty />}
    </div>
  )
}

// ── Detail Table (Bottom-right) ───────────────────────────────────
function DetailTable({ data }: { data: TSDRecord[] }) {
  const rows = useMemo(() => {
    const map: Record<string, {
      dept: string; item: string; partName: string
      scrap: string; qty: number; unit: string; total: number
    }> = {}
    data.forEach(r => {
      const key = `${r['department name']}||${r.item}||${r.scrap_code}`
      if (!map[key]) map[key] = {
        dept: r['department name'] || 'N/A',
        item: r.item || '—',
        partName: r.item || '—',
        scrap: r.scrap_code || '—',
        qty: 0, unit: r.unit || '', total: 0,
      }
      map[key].qty += r.quantity || 0
      map[key].total += r['Total actual'] || 0
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [data])

  const grand = rows.reduce((s, r) => s + r.total, 0)

  const th: React.CSSProperties = {
    padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
    position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '6px 10px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#374151',
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            <th style={th}>Department Name</th>
            <th style={th}>Item</th>
            <th style={th}>Part Name</th>
            <th style={{ ...th, textAlign: 'right' }}>Scrap code</th>
            <th style={{ ...th, textAlign: 'right' }}>Quantity</th>
            <th style={th}>Unit</th>
            <th style={{ ...th, textAlign: 'right' }}>Sum of Total Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#d1d5db', fontSize: 13 }}>No data</td></tr>
            : rows.map((r, i) => (
              <tr
                key={i}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f5ff'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
              >
                <td style={{ ...td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.dept}</td>
                <td style={{ ...td, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.item}</td>
                <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.partName}</td>
                <td style={{ ...td, textAlign: 'center' }}>{r.scrap}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                <td style={td}>{r.unit}</td>
                <td style={{ ...td, textAlign: 'right', color: '#1462FF', fontWeight: 700 }}>
                  {r.total.toLocaleString()}
                </td>
              </tr>
            ))
          }
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr style={{ background: '#eef3ff' }}>
              <td colSpan={6} style={{ ...td, fontWeight: 700, borderTop: '2px solid #e5e7eb' }}>Total</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#1462FF', borderTop: '2px solid #e5e7eb' }}>
                {grand.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// ── Main Page
// ─────────────────────────────────────────────────────────────────
export default function TSDExpenseMonitoringPage() {
  const [data,         setData]         = useState<TSDRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [selectedDept, setSelectedDept] = useState<string | null>(null)

  // Filter states
  const [fy,         setFy]         = useState('All')
  const [month,      setMonth]      = useState('All')
  const [scrapCode,  setScrapCode]  = useState('All')
  const [department, setDepartment] = useState('All')
  const [itemFilter, setItemFilter] = useState('All')

  // ── Fetch ──
  const fetchData = useCallback(() => {
    setLoading(true)
    fetch(`${API}/records/tsd-defect`, { headers: authHeaders() })
      .then(r => r.json())
      .then((d: TSDRecord[]) => setData(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Options ──
  const fyOpts    = useMemo(() => ['All', ...Array.from(new Set(data.map(r => getFY(r.date_day)).filter(Boolean))).sort()], [data])
  const monthOpts = useMemo(() => ['All', ...Array.from(new Set(data.map(r => getMonthNum(r.date_day)).filter(Boolean))).sort()], [data])
  const scrapOpts = useMemo(() => ['All', ...Array.from(new Set(data.map(r => r.scrap_code).filter(Boolean))).sort()], [data])
  const deptOpts  = useMemo(() => ['All', ...Array.from(new Set(data.map(r => r['department name']).filter(Boolean))).sort()], [data])
  const itemOpts  = useMemo(() => ['All', ...Array.from(new Set(data.map(r => r.item).filter(Boolean))).sort()], [data])

  // ── Filtered data ──
  const filtered = useMemo(() => data.filter(r => {
    if (fy         !== 'All' && getFY(r.date_day)           !== fy)         return false
    if (month      !== 'All' && getMonthNum(r.date_day)     !== month)      return false
    if (scrapCode  !== 'All' && r.scrap_code                !== scrapCode)  return false
    if (department !== 'All' && r['department name']        !== department) return false
    if (itemFilter !== 'All' && r.item                      !== itemFilter) return false
    return true
  }), [data, fy, month, scrapCode, department, itemFilter])

  // Bottom-right table: if dept selected from pie, filter further
  const tableData = useMemo(() =>
    selectedDept ? filtered.filter(r => r['department name'] === selectedDept) : filtered,
    [filtered, selectedDept],
  )

  // KPI totals
  const kpiTotal = filtered.reduce((s, r) => s + (r['Total actual'] || 0), 0)
  const kpiQty   = filtered.reduce((s, r) => s + (r.quantity || 0), 0)
  const kpiItems = new Set(filtered.map(r => r.item)).size

  const handleSelectDept = useCallback((d: string | null) =>
    setSelectedDept(prev => prev === d ? null : d), [])

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#F0F2F5', overflow: 'hidden', fontFamily: 'inherit',
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: '14px 24px 0', flexShrink: 0,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>
            TSD-Defect expense monitoring
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
            Dashboard › TSD-Defect expense monitoring
          </p>
        </div>
        <button
          onClick={fetchData}
          style={{
            height: 34, padding: '0 14px', background: '#fff',
            border: '1px solid #e5e7eb', borderRadius: 8, color: '#6b7280',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontFamily: 'inherit',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Refresh
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        margin: '10px 24px 0',
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '12px 20px', display: 'flex', alignItems: 'flex-end',
        gap: 12, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <FilterSelect label="FY"              value={fy}         options={fyOpts}    onChange={v => { setFy(v); setSelectedDept(null) }} />
        <FilterSelect label="Month"           value={month}      options={monthOpts} onChange={v => { setMonth(v); setSelectedDept(null) }} />
        <FilterSelect label="Scrap Code"      value={scrapCode}  options={scrapOpts} onChange={v => { setScrapCode(v); setSelectedDept(null) }} />
        <FilterSelect label="Department Name" value={department} options={deptOpts}  onChange={v => { setDepartment(v); setSelectedDept(null) }} />
        <FilterSelect label="Part Name"       value={itemFilter} options={itemOpts}  onChange={v => { setItemFilter(v); setSelectedDept(null) }} />
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
              </path>
            </svg>
            <span>กำลังโหลดข้อมูล...</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── KPI row ── */}
          <div style={{
            margin: '10px 24px 0',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
            flexShrink: 0,
          }}>
            <KpiCard
              label="Sum of Total Actual"
              value={`฿${fmtK(kpiTotal)}`}
              sub={`฿${fmtFull(kpiTotal)} บาท`}
              color="#1462FF"
            />
            <KpiCard
              label="Total Quantity"
              value={kpiQty.toLocaleString()}
              sub="ชิ้น"
              color="#059669"
            />
            <KpiCard
              label="Unique Items"
              value={String(kpiItems)}
              sub="รายการ"
              color="#f97316"
            />
          </div>

          {/* ── 2×2 chart grid ── */}
          <div style={{
            flex: 1, minHeight: 0,
            margin: '10px 24px 14px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 10,
          }}>

            {/* Top-left: KPI label + Stacked Bar by scrap code */}
            <Panel
              title="Sum of Total Actual"
              extra={
                <span style={{ fontSize: 22, fontWeight: 800, color: '#1462FF', marginLeft: 8 }}>
                  {fmtK(kpiTotal)}
                </span>
              }
            >
              <div style={{ marginBottom: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Sum of Total Actual</span>
              </div>
              <StackedBarChart data={filtered} />
            </Panel>

            {/* Top-right: Pie by department */}
            <Panel
              title="Sum of Total Actual by Department Name"
              extra={
                selectedDept ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <span style={{
                      fontSize: 11, background: '#eef3ff', color: '#1462FF',
                      fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                    }}>
                      {selectedDept}
                    </span>
                    <button
                      onClick={() => setSelectedDept(null)}
                      style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                ) : undefined
              }
            >
              <DeptPieChart data={filtered} onSelect={handleSelectDept} />
            </Panel>

            {/* Bottom-left: Daily Bar + Line */}
            <Panel title="Actual by Daily">
              {selectedDept && (
                <div style={{
                  marginBottom: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Selected Department:</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#1462FF',
                    background: '#eef3ff', padding: '2px 10px', borderRadius: 20,
                  }}>
                    {selectedDept}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#1462FF' }}>
                    ฿{fmtK(tableData.reduce((s, r) => s + (r['Total actual'] || 0), 0))}
                  </span>
                </div>
              )}
              <DailyLineChart data={selectedDept ? tableData : filtered} />
            </Panel>

            {/* Bottom-right: Detail Table */}
            <Panel
              title={`Table${selectedDept ? ` — ${selectedDept}` : ''}`}
              extra={
                selectedDept ? (
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                    คลิกที่แผนภูมิวงกลมเพื่อกรอง
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                    คลิกที่แผนภูมิวงกลมเพื่อกรองตาม Department
                  </span>
                )
              }
            >
              <DetailTable data={tableData} />
            </Panel>

          </div>
        </>
      )}
    </div>
  )
}