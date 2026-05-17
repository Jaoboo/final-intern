'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { API, DONUT_COLORS } from '../../shared'

interface MonitoringData {
  month: { defect_count: number; volume_count: number; ratio: number; cost_total: number }
  selected: { defect_count: number; volume_count: number; ratio: number; cost_estimate: number }
  pareto: { defect_mode: string; defect_count: number }[]
}

interface DailyTrend {
  date: string
  volume: number
  total_defect: number
  ratio: number
  by_mode: Record<string, number>
}

interface DefectModeOption {
  defect_item: string; defect_mode: string
  defect_code: string; defect_by_process: string; defect_type: string
}

interface CorrectionNote {
  note_date:      string
  line:           string
  defect_type:    string
  changing_point: string
  created_at:     string
}

type ViewType = 'All' | 'after' | 'before'

const DEFAULT_TARGETS: Record<ViewType, number> = {
  All:    1.8,
  after:  1.0,
  before: 0.8,
}

const fmt = (d: Date) => {
  const y  = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
}

function getRange(anchor: string, backDays: number): { from: string; to: string } {
  const [y, mo, day] = (anchor || fmt(new Date())).split('-').map(Number)
  const to   = new Date(y, mo - 1, day)
  const from = new Date(y, mo - 1, day - backDays)
  return { from: fmt(from), to: fmt(to) }
}

function buildParetoFromTrend(trend: DailyTrend[], selDate: string) {
  const day = trend.find(d => d.date === selDate)
  if (!day) return []
  return Object.entries(day.by_mode)
    .map(([defect_mode, defect_count]) => ({ defect_mode, defect_count }))
    .sort((a, b) => b.defect_count - a.defect_count)
}

function mergeTrends(after: DailyTrend[], before: DailyTrend[]): DailyTrend[] {
  const map: Record<string, DailyTrend> = {}
  after.forEach(d => { map[d.date] = { ...d } })
  before.forEach(d => {
    if (map[d.date]) {
      map[d.date].total_defect += d.total_defect
      map[d.date].volume = Math.max(map[d.date].volume, d.volume)
      Object.entries(d.by_mode).forEach(([k, v]) => {
        map[d.date].by_mode[k] = (map[d.date].by_mode[k] || 0) + v
      })
      const total = Object.values(map[d.date].by_mode).reduce((a, b) => a + b, 0)
      map[d.date].ratio = map[d.date].volume
        ? +((total / map[d.date].volume) * 100).toFixed(4)
        : 0
    } else {
      map[d.date] = { ...d }
    }
  })
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
}

export default function DailyMonitoringPage() {
  const today = fmt(new Date())

  const [afterData,  setAfterData]  = useState<MonitoringData | null>(null)
  const [beforeData, setBeforeData] = useState<MonitoringData | null>(null)

  const afterTrendRef  = useRef<DailyTrend[]>([])
  const beforeTrendRef = useRef<DailyTrend[]>([])
  const aParetoRef     = useRef<{ defect_mode: string; defect_count: number }[]>([])
  const bParetoRef     = useRef<{ defect_mode: string; defect_count: number }[]>([])

  const [correctionNotes,   setCorrectionNotes]   = useState<CorrectionNote[]>([])
  const correctionNotesRef = useRef<CorrectionNote[]>([])
  const [todayOverTarget,   setTodayOverTarget]   = useState(false)
  const [todayNoteRequired, setTodayNoteRequired] = useState(false)

  const [showCorrPopup,  setShowCorrPopup]  = useState(false)
  const [corrMsg,        setCorrMsg]        = useState('')
  const [corrSubmitting, setCorrSubmitting] = useState(false)
  const [lineOpts,       setLineOpts]       = useState<string[]>([])
  const [typeOpts,       setTypeOpts]       = useState<string[]>([])
  const [corrTargetDate, setCorrTargetDate] = useState('')
  const [corrTargetMode, setCorrTargetMode] = useState('')

  interface CorrEntry { id: string; type: string; line: string; changing: string; editing: boolean }
  const newEntry = (): CorrEntry => ({ id: Math.random().toString(36).slice(2), type: '', line: '', changing: '', editing: true })
  const [corrEntries,     setCorrEntries]     = useState<CorrEntry[]>([newEntry()])
  const [existingEntries, setExistingEntries] = useState<CorrEntry[]>([])

  const [thresholds,    setThresholds]    = useState<Record<ViewType, number>>({ ...DEFAULT_TARGETS })
  const thresholdsRef = useRef<Record<ViewType, number>>({ ...DEFAULT_TARGETS })

  const [defectModes,  setDefectModes]  = useState<DefectModeOption[]>([])
  const [defectMode,   setDefectMode]   = useState('')
  const [defectType,   setDefectType]   = useState('')
  const [selectedDate, setSelectedDate] = useState(today)
  const [viewType,     setViewType]     = useState<ViewType>('All')
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)
  const [isLoading,    setIsLoading]    = useState(false)

  // ── Refs ────────────────────────────────────────────────────────────
  const viewTypeRef     = useRef<ViewType>('All')
  const selectedDateRef = useRef(selectedDate)
  const defectModeRef   = useRef(defectMode)
  const defectTypeRef   = useRef(defectType)
  const chartsRef       = useRef<Record<string, echarts.ECharts>>({})
  const redrawChartsRef = useRef<(...args: any[]) => void>(() => {})

  // ── Sync refs with state ────────────────────────────────────────────
  useEffect(() => { selectedDateRef.current = selectedDate }, [selectedDate])
  useEffect(() => { defectModeRef.current   = defectMode   }, [defectMode])
  useEffect(() => { defectTypeRef.current   = defectType   }, [defectType])

  const setViewTypeSync = (vt: ViewType) => {
    viewTypeRef.current = vt
    setViewType(vt)
  }

  // ── parseChangingPoint — ต้องนิยามก่อน handleOverTargetClick ──────
  const parseChangingPoint = (raw: string): CorrEntry[] => {
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map(line => {
      const m = line.match(/^(.+?)\[(.+?)\]:\s*(.*)$/)
      if (m) return { id: Math.random().toString(36).slice(2), type: m[1].trim(), line: m[2].trim(), changing: m[3].trim(), editing: false }
      return { id: Math.random().toString(36).slice(2), type: '', line: '', changing: line, editing: false }
    })
  }

  const handleOverTargetClick = useCallback((dateFull: string, mode: string) => {
    setCorrTargetDate(dateFull)
    setCorrTargetMode(mode)
    setCorrEntries([newEntry()])
    const existing = correctionNotesRef.current.find(n => n.note_date === dateFull)
    if (existing?.changing_point) {
      setExistingEntries(parseChangingPoint(existing.changing_point))
    } else {
      setExistingEntries([])
    }
    setShowCorrPopup(true)
  }, []) // eslint-disable-line

  // ── Draw Trend ──────────────────────────────────────────────────────
  const drawTrend = useCallback((
    domId: string,
    trend: DailyTrend[],
    threshold: number,
    selDate: string,
    activeMode: string,
    label: string,
    corrNotes: CorrectionNote[] = [],
    onOverTargetClick?: (dateFull: string, mode: string) => void,
    showCorrNotes: boolean = false,
  ) => {
    const dom = document.getElementById(domId)
    if (!dom) return

    // ── FIX: dispose ก่อน init เสมอ เพื่อป้องกัน double-init ──
    if (chartsRef.current[domId]) {
      chartsRef.current[domId].dispose()
      delete chartsRef.current[domId]
    }

    // ── FIX: ถ้า dom ยังไม่มี height ให้รอ 1 frame ──
    if (dom.offsetHeight === 0) {
      requestAnimationFrame(() => drawTrend(domId, trend, threshold, selDate, activeMode, label, corrNotes, onOverTargetClick, showCorrNotes))
      return
    }

    const chart = echarts.init(dom)
    chartsRef.current[domId] = chart

    if (!trend.length) { chart.clear(); return }

    const dates    = trend.map(d => d.date.slice(5))
    const selShort = selDate.slice(5)

    const ratios = trend.map(d => {
      if (!activeMode) return d.ratio
      const cnt = d.by_mode[activeMode] || 0
      return d.volume ? +((cnt / d.volume) * 100).toFixed(4) : 0
    })

    const total    = trend.length
    const startPct = total > 10 ? ((total - 10) / (total - 1)) * 100 : 0

    const allModes = activeMode
      ? [activeMode]
      : Array.from(new Set(trend.flatMap(d => Object.keys(d.by_mode))))

    const barSeries = allModes.map((mode, i) => ({
      name: mode,
      type: 'bar',
      stack: activeMode ? undefined : 'defect',
      data: trend.map(d => {
        const cnt = d.by_mode[mode] || 0
        return d.volume ? +((cnt / d.volume) * 100).toFixed(4) : 0
      }),
      itemStyle: {
        color: (p: any) =>
          dates[p.dataIndex] === selShort
            ? '#C0001A'
            : DONUT_COLORS[i % DONUT_COLORS.length],
      },
    }))

    const corrNoteMap: Record<string, CorrectionNote> = {}
    corrNotes.forEach(n => { corrNoteMap[n.note_date.slice(5)] = n })

    const corrMarkPoints = showCorrNotes ? dates
      .map((d, i) => ({ d, i, note: corrNoteMap[d] }))
      .filter(x => x.note)
      .map(x => ({
        name: 'correction',
        coord: [x.i, Math.max(ratios[x.i] ?? 0, threshold * 0.05) + threshold * 0.08],
        symbolSize: [22, 22],
        symbol: 'path://M12 2 L2 22 L22 22 Z',
        itemStyle: { color: '#FF9800', opacity: 0.92 },
        label: {
          show: true, formatter: '⚠', color: '#FF9800',
          fontSize: 14, offset: [0, -4], fontFamily: 'sans-serif',
        },
      })) : []

    chart.setOption({
      grid: { left: 50, right: 20, top: 36, bottom: 60 },
      tooltip: { show: false },
      legend: { show: false },
      dataZoom: [
        {
          type: 'slider', bottom: 4, height: 18,
          start: startPct, end: 100,
          fillerColor: 'rgba(192,0,26,.08)', borderColor: '#ddd',
          handleStyle: { color: '#C0001A' },
          textStyle: { color: '#aaa', fontSize: 9 },
        },
      ],
      xAxis: {
        type: 'category', data: dates,
        axisLabel: {
          color:      (val: string) => val === selShort ? '#C0001A' : '#aaa',
          fontWeight: (val: string) => val === selShort ? 700 : 400,
          fontSize: 10,
        },
      },
      yAxis: {
        type: 'value', name: 'Ratio %',
        nameTextStyle: { fontSize: 10, color: '#aaa' },
        axisLabel: { color: '#aaa', formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(0,0,0,.06)' } },
      },
      series: [
        ...barSeries,
        {
          name: 'ratio', type: 'line', data: ratios,
          lineStyle: { color: '#222', width: 1.5 },
          itemStyle: { color: '#222' }, symbolSize: 3,
          label: {
            show: true, position: 'top',
            formatter: (p: any) => p.value > 0 ? p.value.toFixed(2) + '%' : '',
            fontSize: 9, color: '#555',
          },
          z: 10,
          markPoint: corrMarkPoints.length > 0
            ? { data: corrMarkPoints, silent: false }
            : undefined,
        },
        {
          name: 'target', type: 'line', data: trend.map(() => threshold),
          lineStyle: { color: '#e00', width: 1.5, type: 'dashed' },
          symbol: 'none', z: 11,
        },
      ],
    })

    // ── Custom DOM Tooltip ──
    let tipEl = document.getElementById('dm-custom-tooltip')
    if (!tipEl) {
      tipEl = document.createElement('div')
      tipEl.id = 'dm-custom-tooltip'
      tipEl.style.cssText = [
        'position:fixed', 'z-index:99999', 'background:#fff',
        'border:1px solid rgba(0,0,0,.1)', 'border-radius:10px',
        'padding:10px 14px', 'box-shadow:0 8px 32px rgba(0,0,0,.18)',
        'pointer-events:none', 'display:none',
        'font-family:Sarabun,sans-serif', 'font-size:13px',
        'min-width:180px', 'max-width:300px',
      ].join(';')
      document.body.appendChild(tipEl)
    }

    const buildTooltipHtml = (dataIndex: number) => {
      const dateLabel = dates[dataIndex]
      const note      = corrNoteMap[dateLabel]
      const d         = trend[dataIndex]

      const modeEntries = allModes
        .map((mode, i) => {
          const cnt = d.by_mode[mode] || 0
          const val = d.volume ? +((cnt / d.volume) * 100).toFixed(4) : 0
          return { mode, val, color: dates[dataIndex] === selShort ? '#C0001A' : DONUT_COLORS[i % DONUT_COLORS.length] }
        })
        .filter((x: { mode: string; val: number; color: string }) => x.val > 0)

      let html = `<div style="font-weight:700;margin-bottom:6px;font-size:13px">${dateLabel}</div>`
      modeEntries.forEach(({ mode, val, color }: { mode: string; val: number; color: string }) => {
        html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="color:#555;flex:1">${mode}</span>
          <span style="font-weight:700;padding-left:12px">${val.toFixed(4)}%</span>
        </div>`
      })

      const ratio = ratios[dataIndex]
      html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #eee;color:#333;font-weight:700">
        Ratio: ${ratio.toFixed(2)}%
      </div>`

      if (note && showCorrNotes) {
        const lines = note.changing_point.split('\n').filter(Boolean)
        const linesHtml = lines.map((l: string) => {
          const m = l.match(/^(.+?)\[(.+?)\]:\s*(.*)$/)
          if (m) {
            return `<div style="font-size:11px;margin-top:3px;display:flex;gap:4px;align-items:baseline;flex-wrap:wrap">
              <span style="color:#E65100;font-weight:700;white-space:nowrap">${m[1]}[${m[2]}]:</span>
              <span style="color:#333">${m[3]}</span>
            </div>`
          }
          return `<div style="font-size:11px;color:#555;margin-top:2px">${l}</div>`
        }).join('')
        html += `<div style="margin-top:8px;padding-top:8px;border-top:2px solid #FF9800">
          <div style="color:#FF9800;font-weight:700;font-size:11px;margin-bottom:6px">⚠ Changing point:</div>
          ${linesHtml}
        </div>`
      }
      return html
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!tipEl) return
      const pointInPixel = chart.convertFromPixel('grid', [e.offsetX, e.offsetY])
      const dataIndex = Math.round(pointInPixel[0])
      if (dataIndex < 0 || dataIndex >= trend.length) {
        tipEl.style.display = 'none'
        return
      }
      tipEl.innerHTML = buildTooltipHtml(dataIndex)
      tipEl.style.display = 'block'

      const vw = window.innerWidth
      const vh = window.innerHeight
      const tw = tipEl.offsetWidth
      const th = tipEl.offsetHeight
      let tx = e.clientX + 16
      if (tx + tw > vw - 8) tx = e.clientX - tw - 8
      let ty = e.clientY - th - 12
      if (ty < 8) ty = e.clientY + 20
      if (ty + th > vh - 8) ty = vh - th - 8
      tipEl.style.left = Math.max(tx, 8) + 'px'
      tipEl.style.top  = Math.max(ty, 8) + 'px'
    }

    const onMouseLeave = () => { if (tipEl) tipEl.style.display = 'none' }

    dom.addEventListener('mousemove', onMouseMove)
    dom.addEventListener('mouseleave', onMouseLeave)

    chart.off('click')
    chart.on('click', (params: any) => {
      if (params.componentType !== 'series' || params.seriesType !== 'bar') return
      const dayRatio = ratios[params.dataIndex]
      if (dayRatio >= threshold && onOverTargetClick) {
        onOverTargetClick(trend[params.dataIndex].date, params.seriesName)
      }
    })

    const onWheel = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation() }
    dom.addEventListener('wheel', onWheel, { passive: false })

    // ── FIX: เพิ่ม ResizeObserver ──
    const ro = new ResizeObserver(() => { chart.resize() })
    ro.observe(dom)

    const origDispose = chart.dispose.bind(chart)
    chart.dispose = () => {
      ro.disconnect()
      dom.removeEventListener('mousemove', onMouseMove)
      dom.removeEventListener('mouseleave', onMouseLeave)
      dom.removeEventListener('wheel', onWheel)
      if (tipEl) tipEl.style.display = 'none'
      origDispose()
    }
  }, []) // eslint-disable-line

  // ── Draw Pareto ─────────────────────────────────────────────────────
  const drawPareto = useCallback((
    domId: string,
    pareto: { defect_mode: string; defect_count: number }[],
    selDate: string,
  ) => {
    const dom = document.getElementById(domId)
    if (!dom) return

    if (chartsRef.current[domId]) {
      chartsRef.current[domId].dispose()
      delete chartsRef.current[domId]
    }

    // ── FIX: ถ้า dom ยังไม่มี height ให้รอ 1 frame ──
    if (dom.offsetHeight === 0) {
      requestAnimationFrame(() => drawPareto(domId, pareto, selDate))
      return
    }

    const chart = echarts.init(dom)
    chartsRef.current[domId] = chart

    if (!pareto.length) {
      chart.setOption({
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'No data', fill: '#ccc', fontSize: 13 } }]
      })
      return
    }

    const total  = pareto.reduce((a, b) => a + b.defect_count, 0)
    const sorted = [...pareto].sort((a, b) => b.defect_count - a.defect_count).slice(0, 5)
    const labels = sorted.map(p => p.defect_mode)
    const pcts   = sorted.map(p => +((p.defect_count / total) * 100).toFixed(3))

    chart.setOption({
      grid: { left: 44, right: 16, top: 28, bottom: 48 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#555', fontSize: 10, rotate: 15, interval: 0 } },
      yAxis: {
        type: 'value', name: '%',
        nameTextStyle: { fontSize: 10, color: '#aaa' },
        axisLabel: { formatter: '{value}%', color: '#aaa', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(0,0,0,.06)' } },
      },
      series: [{
        type: 'bar', data: pcts,
        barMaxWidth: 60,
        label: {
          show: true, position: 'top',
          formatter: (p: any) => p.value.toFixed(2) + '%',
          fontSize: 11, color: '#555', fontWeight: 600,
        },
        itemStyle: {
          color: (p: any) => DONUT_COLORS[p.dataIndex % DONUT_COLORS.length],
          borderRadius: [5, 5, 0, 0],
        },
      }],
    })

    // ── FIX: เพิ่ม ResizeObserver ──
    const ro = new ResizeObserver(() => { chart.resize() })
    ro.observe(dom)

    const origDispose = chart.dispose.bind(chart)
    chart.dispose = () => {
      ro.disconnect()
      origDispose()
    }
  }, [])

  // ── Redraw based on viewType ────────────────────────────────────────
  const redrawCharts = useCallback((
    aTr: DailyTrend[],
    bTr: DailyTrend[],
    aPareto: any[],
    bPareto: any[],
    d: string,
    m: string,
    vt: ViewType,
    corrNotes: CorrectionNote[] = [],
    ths: Record<ViewType, number> = { ...DEFAULT_TARGETS },
  ) => {
    const th = ths[vt]
    const canClick = (vt === 'All' && m === '') ? handleOverTargetClick : undefined

    if (vt === 'after') {
      drawTrend('c-trend-main', aTr, th, d, m, 'After brazing', corrNotes, undefined, false)
      drawPareto('c-pareto-main', aPareto, d)
    } else if (vt === 'before') {
      drawTrend('c-trend-main', bTr, th, d, m, 'Before brazing', corrNotes, undefined, false)
      drawPareto('c-pareto-main', bPareto, d)
    } else {
      const merged = mergeTrends(aTr, bTr)
      const mergedPareto: Record<string, number> = {}
      ;[...aPareto, ...bPareto].forEach(p => {
        mergedPareto[p.defect_mode] = (mergedPareto[p.defect_mode] || 0) + p.defect_count
      })
      const mergedParetoArr = Object.entries(mergedPareto)
        .map(([defect_mode, defect_count]) => ({ defect_mode, defect_count }))
        .sort((a, b) => b.defect_count - a.defect_count)

      drawTrend('c-trend-main', merged, th, d, m, 'After + Before', corrNotes, canClick, true)
      drawPareto('c-pareto-main', mergedParetoArr, d)
    }
  }, [drawTrend, drawPareto, handleOverTargetClick])

  useEffect(() => { redrawChartsRef.current = redrawCharts }, [redrawCharts])

  // ── FIX: loadData และ loadDataWithStatus นิยามด้วย useCallback ──────
  // ── เพื่อให้ stable reference ใช้ใน useEffect ได้ถูกต้อง ──────────
  const loadData = useCallback(async (date?: string, mode?: string, type?: string) => {
    const d  = date !== undefined ? date : selectedDateRef.current
    const m  = mode !== undefined ? mode : defectModeRef.current
    const dt = type !== undefined ? type : defectTypeRef.current

    try {
      const afterP = new URLSearchParams({
        date_from: d, date_to: d,
        ...(m ? { defect_mode: m } : {}),
        defect_type: 'After Day',
      })
      const beforeP = new URLSearchParams({
        date_from: d, date_to: d,
        ...(m ? { defect_mode: m } : {}),
        defect_type: 'Before Day',
      })

      const { from: tFrom, to: tTo } = getRange(d, 29)
      const tAfter = new URLSearchParams({
        date_from: tFrom, date_to: tTo,
        ...(m ? { defect_mode: m } : {}),
        defect_type: 'After Day',
      })
      const tBefore = new URLSearchParams({
        date_from: tFrom, date_to: tTo,
        ...(m ? { defect_mode: m } : {}),
        defect_type: 'Before Day',
      })
      const tAfterAll  = new URLSearchParams({ date_from: tFrom, date_to: tTo, defect_type: 'After Day' })
      const tBeforeAll = new URLSearchParams({ date_from: tFrom, date_to: tTo, defect_type: 'Before Day' })

      const [
        afterRes, beforeRes,
        aTrRaw, bTrRaw,
        aTrAllRaw, bTrAllRaw,
        corrHistRaw, corrTodayRaw,
      ] = await Promise.all([
        fetch(`${API}/analyze/daily-monitoring?${afterP}`).then(r  => r.json()),
        fetch(`${API}/analyze/daily-monitoring?${beforeP}`).then(r => r.json()),
        fetch(`${API}/analyze/daily-trend?${tAfter}`).then(r       => r.json()),
        fetch(`${API}/analyze/daily-trend?${tBefore}`).then(r      => r.json()),
        fetch(`${API}/analyze/daily-trend?${tAfterAll}`).then(r    => r.json()),
        fetch(`${API}/analyze/daily-trend?${tBeforeAll}`).then(r   => r.json()),
        fetch(`${API}/correction/history`).then(r                  => r.json()).catch(() => []),
        fetch(`${API}/correction/today`).then(r                    => r.json()).catch(() => ({})),
      ])

      const aTr    = Array.isArray(aTrRaw)    ? aTrRaw    : []
      const bTr    = Array.isArray(bTrRaw)    ? bTrRaw    : []
      const aTrAll = Array.isArray(aTrAllRaw) ? aTrAllRaw : []
      const bTrAll = Array.isArray(bTrAllRaw) ? bTrAllRaw : []

      const notes: CorrectionNote[] = Array.isArray(corrHistRaw) ? corrHistRaw : []
      setCorrectionNotes(notes)
      correctionNotesRef.current = notes
      setTodayOverTarget(!!corrTodayRaw?.over_target)
      setTodayNoteRequired(!!corrTodayRaw?.note_required)

      setAfterData(afterRes)
      setBeforeData(beforeRes)
      afterTrendRef.current  = aTr
      beforeTrendRef.current = bTr

      const aPareto = buildParetoFromTrend(aTrAll, d)
      const bPareto = buildParetoFromTrend(bTrAll, d)
      aParetoRef.current = aPareto
      bParetoRef.current = bPareto

      // ── FIX: เปลี่ยนจาก setTimeout 50ms เป็น requestAnimationFrame
      // เพื่อรับประกันว่า DOM render แล้วก่อน ECharts init ──
      requestAnimationFrame(() => {
        redrawChartsRef.current(aTr, bTr, aPareto, bPareto, d, m, viewTypeRef.current, correctionNotesRef.current, thresholdsRef.current)
      })
    } catch (e) { console.log('API not connected', e) }
  }, []) // eslint-disable-line

  // ── FIX: loadDataWithStatus นิยามด้วย useCallback ──────────────────
  // ── และวางไว้หลัง loadData แต่ก่อน useEffect ที่เรียกใช้ ──────────
  const loadDataWithStatus = useCallback(async (...args: Parameters<typeof loadData>) => {
    setIsLoading(true)
    try {
      await loadData(...args)
    } finally {
      setLastUpdated(new Date())
      setIsLoading(false)
    }
  }, [loadData])

  // ── Master data fetch ───────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/defect-modes`).then(r => r.json()).then(setDefectModes).catch(() => {})
    fetch(`${API}/options/lines`).then(r => r.json()).then(d => setLineOpts(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`${API}/options/defect-modes`).then(r => r.json()).then(d => setTypeOpts(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // ── WebSocket ───────────────────────────────────────────────────────
  const wsRef          = useRef<WebSocket | null>(null)
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── FIX: ใส่ loadDataWithStatus ใน deps เพื่อได้ stable ref ────────
  useEffect(() => {
    const WS_URL = API.replace(/^http/, 'ws') + '/ws'
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen    = () => console.log('[WS] connected')
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'defect_inserted' || msg.type === 'data_updated') {
            if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current)
            wsDebounceRef.current = setTimeout(() => loadDataWithStatus(), 800)
          }
        } catch {}
      }
      ws.onclose = () => {
        wsReconnectRef.current = setTimeout(connect, 5_000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    const fallback = setInterval(() => loadDataWithStatus(), 60_000)
    return () => {
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (wsDebounceRef.current)  clearTimeout(wsDebounceRef.current)
      wsRef.current?.close()
      wsRef.current = null
      clearInterval(fallback)
    }
  }, [loadDataWithStatus])

  // ── FIX: auto-load เมื่อ filter เปลี่ยน ────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      loadDataWithStatus(selectedDate, defectMode, defectType)
    }, 150)
    return () => clearTimeout(timer)
  }, [selectedDate, defectMode, defectType, loadDataWithStatus])

  // ── Correction note popup auto-open ────────────────────────────────
  useEffect(() => {
    if (todayNoteRequired) {
      setCorrEntries([newEntry()])
      setExistingEntries([])
      setShowCorrPopup(true)
    }
  }, [todayNoteRequired]) // eslint-disable-line

  // ── Redraw on viewType / thresholds change ──────────────────────────
  useEffect(() => {
    const d = selectedDateRef.current
    const m = defectModeRef.current
    requestAnimationFrame(() => {
      redrawCharts(
        afterTrendRef.current, beforeTrendRef.current,
        aParetoRef.current, bParetoRef.current,
        d, m, viewType, correctionNotesRef.current, thresholdsRef.current,
      )
    })
  }, [viewType, thresholds, redrawCharts])

  // ── submitCorrection ────────────────────────────────────────────────
  const submitCorrection = async () => {
    const toSubmit = corrEntries.filter(e => e.type || e.line || e.changing)
    if (toSubmit.length === 0 && existingEntries.length === 0) { setCorrMsg('กรุณากรอกข้อมูลอย่างน้อย 1 แถว'); return }
    for (const e of toSubmit) {
      if (!e.type)     { setCorrMsg('กรุณาเลือก Type ให้ครบทุกแถว'); return }
      if (!e.line)     { setCorrMsg('กรุณาเลือก Line ให้ครบทุกแถว'); return }
      if (!e.changing) { setCorrMsg('กรุณากรอก Changing Point ให้ครบทุกแถว'); return }
    }
    const allEntries = [...existingEntries, ...toSubmit]
    if (allEntries.length === 0) { setCorrMsg('No data for recording'); return }
    setCorrMsg('')
    setCorrSubmitting(true)
    const changingPoint = allEntries.map(e => `${e.type}[${e.line}]: ${e.changing}`).join('\n')
    const firstEntry = allEntries[0]

    try {
      const r = await fetch(`${API}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line:           firstEntry.line,
          defect_type:    firstEntry.type,
          changing_point: changingPoint,
          note_date:      corrTargetDate || selectedDateRef.current,
        }),
      })
      if (r.ok) {
        setCorrEntries([newEntry()])
        setExistingEntries([])
        setCorrMsg('')
        setCorrTargetDate(''); setCorrTargetMode('')
        setShowCorrPopup(false)
        setTodayNoteRequired(false)
        await loadDataWithStatus(selectedDateRef.current, defectModeRef.current, defectTypeRef.current)
      } else {
        const d = await r.json()
        setCorrMsg(typeof d.detail === 'string' ? d.detail : 'Failed save')
      }
    } catch { setCorrMsg('เชื่อมต่อ API ไม่ได้') }
    finally { setCorrSubmitting(false) }
  }

  const formatRatio  = (v?: number) => v != null ? `${v.toFixed(2)} %` : '—'
  const formatCost   = (v?: number) => v != null ? v.toLocaleString() : '—'
  const modeOptions  = Array.from(new Set(defectModes.map(d => d.defect_mode)))
  const currentThreshold = thresholds[viewType]

  // ── JSX ─────────────────────────────────────────────────────────────
  return (
    <div className="dm-page">
      <div className="dfp-header-bar">
        <div className="dfp-header-left">
          <h1 className="dfp-title">Daily Monitoring</h1>
          <span className="dfp-breadcrumb">Dashboard &gt; Daily Monitoring</span>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ── Correction Note Popup ── */}
      {showCorrPopup && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'slideDown .2s ease',
        }}>
          <div style={{
            background: '#fff', borderRadius: 20,
            padding: '28px 32px', width: 680, maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'auto',
            boxShadow: '0 24px 72px rgba(0,0,0,.25)',
            display: 'flex', flexDirection: 'column', gap: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#E65100', fontFamily: 'Sarabun,sans-serif' }}>Correction Note</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  Date <b style={{ color: '#C0001A' }}>{corrTargetDate || selectedDate}</b>
                </div>
              </div>
            </div>

            {existingEntries.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Last</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#faf9f6' }}>
                      {['Type', 'Line', 'Changing Point', ''].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#777', borderBottom: '1px solid rgba(0,0,0,.08)', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {existingEntries.map((e, i) => (
                      <tr key={e.id} style={{ borderBottom: '1px solid rgba(0,0,0,.05)' }}>
                        {e.editing ? (
                          <>
                            <td style={{ padding: '6px 6px' }}>
                              <select value={e.type} onChange={ev => setExistingEntries(prev => prev.map((x, xi) => xi === i ? { ...x, type: ev.target.value } : x))}
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }}>
                                <option value="">— Type —</option>
                                {typeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '6px 6px' }}>
                              <select value={e.line} onChange={ev => setExistingEntries(prev => prev.map((x, xi) => xi === i ? { ...x, line: ev.target.value } : x))}
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }}>
                                <option value="">— Line —</option>
                                {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '6px 6px' }}>
                              <input value={e.changing} onChange={ev => setExistingEntries(prev => prev.map((x, xi) => xi === i ? { ...x, changing: ev.target.value } : x))}
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }} />
                            </td>
                            <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setExistingEntries(prev => prev.map((x, xi) => xi === i ? { ...x, editing: false } : x))}
                                style={{ padding: '4px 10px', borderRadius: 6, background: '#e8f5e9', color: '#2E7D32', border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', fontWeight: 600 }}>✓</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '7px 10px', color: '#555' }}>{e.type}</td>
                            <td style={{ padding: '7px 10px', color: '#555' }}>{e.line}</td>
                            <td style={{ padding: '7px 10px', color: '#333', fontWeight: 500 }}>{e.changing}</td>
                            <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setExistingEntries(prev => prev.map((x, xi) => xi === i ? { ...x, editing: true } : x))}
                                style={{ padding: '4px 10px', borderRadius: 6, background: '#fff3e0', color: '#E65100', border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', fontWeight: 600, marginRight: 4 }}>Edit</button>
                              <button onClick={() => setExistingEntries(prev => prev.filter((_, xi) => xi !== i))}
                                style={{ padding: '4px 8px', borderRadius: 6, background: '#fff0f0', color: '#C0001A', border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', fontWeight: 600 }}>✕</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#E65100', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>New</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#fff8f0' }}>
                    {['#', 'Type', 'Line', 'Changing Point', ''].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#E65100', borderBottom: '1.5px solid rgba(255,152,0,.2)', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corrEntries.map((e, i) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid rgba(0,0,0,.05)' }}>
                      <td style={{ padding: '6px 10px', color: '#bbb', fontSize: 11, width: 24 }}>{existingEntries.length + i + 1}</td>
                      <td style={{ padding: '6px 6px' }}>
                        <select value={e.type} onChange={ev => setCorrEntries(prev => prev.map((x, xi) => xi === i ? { ...x, type: ev.target.value } : x))}
                          style={{ padding: '6px 8px', borderRadius: 7, border: e.type ? '1.5px solid #FF9800' : '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }}>
                          <option value=""> Type </option>
                          {typeOpts.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 6px' }}>
                        <select value={e.line} onChange={ev => setCorrEntries(prev => prev.map((x, xi) => xi === i ? { ...x, line: ev.target.value } : x))}
                          style={{ padding: '6px 8px', borderRadius: 7, border: e.line ? '1.5px solid #FF9800' : '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }}>
                          <option value=""> Line </option>
                          {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 6px' }}>
                        <input value={e.changing} onChange={ev => setCorrEntries(prev => prev.map((x, xi) => xi === i ? { ...x, changing: ev.target.value } : x))}
                          placeholder="Detail"
                          style={{ padding: '6px 8px', borderRadius: 7, border: e.changing ? '1.5px solid #FF9800' : '1px solid rgba(0,0,0,.15)', fontSize: 12, fontFamily: 'Sarabun,sans-serif', width: '100%', outline: 'none' }} />
                      </td>
                      <td style={{ padding: '6px 6px', width: 32 }}>
                        {corrEntries.length > 1 && (
                          <button onClick={() => setCorrEntries(prev => prev.filter((_, xi) => xi !== i))}
                            style={{ background: 'none', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: 15, padding: 2, borderRadius: 4 }}
                            onMouseOver={e => (e.currentTarget.style.color = '#C0001A')}
                            onMouseOut={e => (e.currentTarget.style.color = '#ddd')}
                          >✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                onClick={() => setCorrEntries(prev => [...prev, newEntry()])}
                style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, border: '1.5px dashed rgba(255,152,0,.4)', background: 'transparent', color: '#FF9800', fontSize: 12, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add
              </button>

              {corrEntries.some(e => e.type || e.line || e.changing) && (
                <div style={{ marginTop: 10, background: '#fff8f0', borderRadius: 8, padding: '8px 12px', border: '1px solid rgba(255,152,0,.2)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#FF9800', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Preview</div>
                  {[...existingEntries, ...corrEntries.filter(e => e.type || e.line || e.changing)].map((e) => (
                    <div key={e.id} style={{ fontSize: 12, color: '#444', lineHeight: 1.9 }}>
                      <span style={{ fontWeight: 700, color: '#C0001A' }}>{e.type || '?'}</span>
                      <span style={{ color: '#888' }}>[</span>
                      <span style={{ fontWeight: 700 }}>{e.line || '?'}</span>
                      <span style={{ color: '#888' }}>]: </span>
                      <span>{e.changing || '?'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {corrMsg && (
              <div style={{ marginBottom: 10, fontSize: 13, color: '#C0001A', fontFamily: 'Sarabun,sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span> {corrMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              {!todayNoteRequired && (
                <button
                  onClick={() => { setShowCorrPopup(false); setCorrMsg(''); setCorrTargetDate(''); setCorrTargetMode('') }}
                  style={{ padding: '10px 22px', borderRadius: 10, border: '1px solid rgba(0,0,0,.13)', background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', color: '#666' }}
                >Close</button>
              )}
              <button
                onClick={submitCorrection} disabled={corrSubmitting}
                style={{ padding: '10px 32px', borderRadius: 10, background: corrSubmitting ? '#ffb347' : '#FF9800', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: corrSubmitting ? 'not-allowed' : 'pointer', fontFamily: 'Sarabun,sans-serif', boxShadow: '0 2px 8px rgba(255,152,0,.3)' }}
              >
                {corrSubmitting ? 'Loading..' : 'SAVE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ BODY ══ */}
      <div className="dm-body">

        {todayNoteRequired && !showCorrPopup && (
          <div style={{ marginBottom: 8, background: 'linear-gradient(135deg,#fff3e0,#ffe0b2)', border: '1.5px solid #FF9800', borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown .3s ease' }}>
            <span style={{ fontSize: 22 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#E65100' }}>Today is OVER TARGET! — Please Enter Correction Note</div>
              <div style={{ fontSize: 12, color: '#BF360C', marginTop: 2 }}>Please enter Correction Note before recording next defect</div>
            </div>
            <button
              onClick={() => {
                const today2 = selectedDateRef.current
                const existing = correctionNotesRef.current.find(n => n.note_date === today2)
                if (existing?.changing_point) setExistingEntries(parseChangingPoint(existing.changing_point))
                else setExistingEntries([])
                setCorrEntries([newEntry()])
                setShowCorrPopup(true)
              }}
              style={{ padding: '8px 20px', borderRadius: 9, background: '#FF9800', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', whiteSpace: 'nowrap', flexShrink: 0 }}
            >กรอกเลย →</button>
          </div>
        )}

        {todayOverTarget && !todayNoteRequired && (
          <div style={{ marginBottom: 8, background: 'linear-gradient(135deg,#e8f5e9,#c8e6c9)', border: '1.5px solid #4CAF50', borderRadius: 12, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, animation: 'slideDown .3s ease' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1B5E20' }}>Correction Note saved</div>
              <div style={{ fontSize: 12, color: '#2E7D32', marginTop: 2 }}>Today is over target — correction note already recorded, shown on graph.</div>
            </div>
            <button
              onClick={() => {
                const today2 = selectedDateRef.current
                const existing = correctionNotesRef.current.find(n => n.note_date === today2)
                if (existing?.changing_point) setExistingEntries(parseChangingPoint(existing.changing_point))
                else setExistingEntries([])
                setCorrEntries([newEntry()])
                setShowCorrPopup(true)
              }}
              style={{ padding: '6px 16px', borderRadius: 9, background: 'transparent', color: '#2E7D32', border: '1.5px solid #4CAF50', fontSize: 12, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', whiteSpace: 'nowrap', flexShrink: 0 }}
            >ดู / แก้ไข</button>
          </div>
        )}

        {/* ── Filter Bar ── */}
        <div className="dm-filter-bar">
          <div className="dm-filter-group">
            <span className="dm-filter-label">Type</span>
            <div className="dm-type-toggle">
              {([
                { value: 'All',    label: 'Both'   },
                { value: 'after',  label: 'After'  },
                { value: 'before', label: 'Before' },
              ] as { value: ViewType; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  className={`dm-type-btn${viewType === opt.value ? ' active' : ''}`}
                  onClick={() => setViewTypeSync(opt.value)}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          <div className="dm-filter-group dm-filter-mode">
            <span className="dm-filter-label">Defect Mode</span>
            <div className="dm-select-wrap">
              <select
                className="dm-select"
                value={defectMode}
                onChange={e => setDefectMode(e.target.value)}
              >
                <option value="">All Defect Mode</option>
                {modeOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, pointerEvents: 'none' }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>

          <div className="dm-filter-group dm-filter-date">
            <span className="dm-filter-label">Date</span>
            <div className="dm-date-nav">
              <button className="dm-nav-btn" onClick={() => {
                const d = new Date(selectedDate); d.setDate(d.getDate() - 1)
                setSelectedDate(d.toISOString().slice(0, 10))
              }}>‹</button>
              <input
                type="date"
                className="dm-date-input"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
              />
              <button className="dm-nav-btn" onClick={() => {
                const d = new Date(selectedDate); d.setDate(d.getDate() + 1)
                setSelectedDate(d.toISOString().slice(0, 10))
              }}>›</button>
            </div>
          </div>
        </div>

        {/* ── Show area ── */}
        <div className="dm-show">
          <div className="dm-cards-row">
            <DmMetricCard
              label="Defect Ratio" sub="Month"
              value={formatRatio(viewType === 'after' ? afterData?.month.ratio : viewType === 'before' ? beforeData?.month.ratio : combineRatio(afterData?.month.ratio, beforeData?.month.ratio, afterData?.month.volume_count, beforeData?.month.volume_count, afterData?.month.defect_count, beforeData?.month.defect_count))}
              threshold={currentThreshold}
              rawValue={viewType === 'after' ? afterData?.month.ratio : viewType === 'before' ? beforeData?.month.ratio : combineRatio(afterData?.month.ratio, beforeData?.month.ratio, afterData?.month.volume_count, beforeData?.month.volume_count, afterData?.month.defect_count, beforeData?.month.defect_count)}
            />
            <DmMetricCard
              label="Cost Total" sub="Month"
              value={formatCost(viewType === 'after' ? afterData?.month.cost_total : viewType === 'before' ? beforeData?.month.cost_total : (afterData?.month.cost_total ?? 0) + (beforeData?.month.cost_total ?? 0))}
              isCost
            />
            <DmMetricCard
              label="Defect Ratio" sub="Date"
              value={formatRatio(viewType === 'after' ? afterData?.selected.ratio : viewType === 'before' ? beforeData?.selected.ratio : combineRatio(afterData?.selected.ratio, beforeData?.selected.ratio, afterData?.selected.volume_count, beforeData?.selected.volume_count, afterData?.selected.defect_count, beforeData?.selected.defect_count))}
              threshold={currentThreshold}
              rawValue={viewType === 'after' ? afterData?.selected.ratio : viewType === 'before' ? beforeData?.selected.ratio : combineRatio(afterData?.selected.ratio, beforeData?.selected.ratio, afterData?.selected.volume_count, beforeData?.selected.volume_count, afterData?.selected.defect_count, beforeData?.selected.defect_count)}
            />
            <DmMetricCard
              label="Estimate Cost" sub="Date"
              value={formatCost(viewType === 'after' ? afterData?.selected.cost_estimate : viewType === 'before' ? beforeData?.selected.cost_estimate : (afterData?.selected.cost_estimate ?? 0) + (beforeData?.selected.cost_estimate ?? 0))}
              isCost
            />
          </div>

          <div className="dm-charts-row">
            <div className="dm-chart-card dm-trend-card" style={{ overflow: 'visible' }}>
              <div className="dm-chart-header">
                <span className="dm-chart-title">Defect Trend</span>
                <div className="dm-chart-header-right">
                  {correctionNotes.length > 0 && (
                    <span className="dm-corr-badge">⚠ Correction ({correctionNotes.length})</span>
                  )}
                  <span className="dm-legend-target">
                    <span className="dm-legend-dash" />
                    Target ({currentThreshold}%)
                  </span>
                  <span className="dm-chart-sub">
                    {new Date(selectedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
              {/* FIX: เพิ่ม height: 100% บน wrapper div เพื่อให้ ECharts มี dimension จริง */}
              <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
                <div id="c-trend-main" style={{ position: 'absolute', inset: 0 }} />
              </div>
            </div>

            <div className="dm-chart-card dm-pareto-card">
              <div className="dm-chart-header">
                <span className="dm-chart-title">Pareto <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>Top 5</span></span>
                <span className="dm-chart-sub">
                  {new Date(selectedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
              </div>
              {/* FIX: เพิ่ม position: relative + absolute child ให้ ECharts มี size จริง */}
              <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
                <div id="c-pareto-main" style={{ position: 'absolute', inset: 0 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function combineRatio(
  ratioA?: number, ratioB?: number,
  volA?: number,   volB?: number,
  defA?: number,   defB?: number,
): number | undefined {
  if (ratioA == null && ratioB == null) return undefined
  const totalDef = (defA ?? 0) + (defB ?? 0)
  const totalVol = Math.max(volA ?? 0, volB ?? 0)
  if (!totalVol) return 0
  return +((totalDef / totalVol) * 100).toFixed(4)
}

function DmMetricCard({
  label, sub, value, threshold, rawValue, isCost = false,
}: {
  label: string; sub: string; value: string; threshold?: number; rawValue?: number; isCost?: boolean
}) {
  const isOver = !isCost && threshold != null && rawValue != null && rawValue >= threshold
  return (
    <div className="dm-metric-card">
      <div className="dm-metric-label">{label}</div>
      <div className="dm-metric-sub-label">{sub}</div>
      <div className="dm-metric-value">{value}</div>
      {!isCost && threshold != null && (
        <div className={`dm-metric-badge${isOver ? ' over' : ' ok'}`}>
          {isOver ? 'Over Target' : 'In Control'}
        </div>
      )}
    </div>
  )
}