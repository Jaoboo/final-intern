'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Suspense } from 'react'
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

function shiftParam(f: Filters): string {
  if (f.shiftA && f.shiftB) return ''
  if (f.shiftA) return 'A'
  if (f.shiftB) return 'B'
  return ''
}

function getRange(preset: DatePreset, s: string, e: string): { start: string; end: string } {
  const today = new Date(), fmt = (d: Date) => d.toISOString().slice(0,10)
  if (preset==='custom')     return {start:s, end:e}
  if (preset==='this_year')  return {start:`${today.getFullYear()}-01-01`, end:fmt(today)}
  if (preset==='this_month') { const y=today.getFullYear(),m=String(today.getMonth()+1).padStart(2,'0'); return {start:`${y}-${m}-01`,end:fmt(today)} }
  if (preset==='this_week')  { const day=today.getDay(),diff=today.getDate()-day+(day===0?-6:1); return {start:fmt(new Date(today.getFullYear(),today.getMonth(),diff)),end:fmt(today)} }
  return {start:'',end:''}
}

function getDateLabel(preset: DatePreset, s: string, e: string): string {
  const today=new Date(), mn=today.toLocaleString('en-US',{month:'short'})
  if (preset==='this_month') return `${mn} ${today.getFullYear()}`
  if (preset==='this_year')  return `Year ${today.getFullYear()}`
  if (preset==='this_week')  return 'This Week'
  if (preset==='custom'&&s&&e) return `${s} – ${e}`
  return 'Select Date'
}

// ── Date Picker Popover ──────────────────────────────────────────── //
function DatePickerPopover({ filters, onChange, onClose }: {
  filters: Filters
  onChange: (f: Filters) => void
  onClose: () => void
}) {
  const presets: {value:DatePreset;label:string}[] = [
    {value:'this_year',label:'This Year'},
    {value:'this_month',label:'This Month'},
    {value:'this_week',label:'This Week'},
    {value:'custom',label:'Custom Range'},
  ]
  return (
    <>
      <div style={{ position:'fixed', inset:0, zIndex:199 }} onClick={onClose} />
      <div style={{ position:'absolute', top:'100%', left:0, marginTop:4, zIndex:200, background:'#fff', border:`1px solid ${T.border}`, borderRadius:9, boxShadow:'0 6px 20px rgba(0,0,0,.11)', padding:8, minWidth:170 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          {presets.map(p => (
            <button key={p.value} onClick={()=>onChange({...filters,datePreset:p.value})}
              style={{ padding:'6px 9px', borderRadius:6, border:'none', textAlign:'left', background:filters.datePreset===p.value?T.primaryBg:'transparent', color:filters.datePreset===p.value?T.primary:T.text, fontWeight:filters.datePreset===p.value?700:400, fontSize:12.5, cursor:'pointer', fontFamily:'Sarabun,sans-serif' }}>
              {p.label}
            </button>
          ))}
        </div>
        {filters.datePreset==='custom' && (
          <div style={{ display:'flex', flexDirection:'column', gap:5, paddingTop:7, marginTop:5, borderTop:`1px solid ${T.border}` }}>
            {(['Start','End'] as const).map(lbl => (
              <div key={lbl} style={{ display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ fontSize:10, color:T.textMuted, width:26 }}>{lbl}</span>
                <input type="date"
                  value={lbl==='Start'?filters.startDate:filters.endDate}
                  onChange={e=>onChange({...filters,[lbl==='Start'?'startDate':'endDate']:e.target.value})}
                  style={{ flex:1, padding:'4px 6px', border:`1px solid ${T.border}`, borderRadius:5, fontSize:11, fontFamily:'Sarabun,sans-serif', outline:'none', color:T.text }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── Breakdown Card ───────────────────────────────────────────────── //
interface BreakdownSection { total_defect:number; by_mode:{defect_mode:string;defect_count:number}[]; by_part:{part_no:string;defect_count:number}[] }

function SankeyCard({ title, data, color }: { title:string; data:BreakdownSection|null; color:string }) {
  const maxMode=data?.by_mode[0]?.defect_count||1, maxPart=data?.by_part[0]?.defect_count||1
  return (
    <div style={{ background:T.card, borderRadius:8, border:`1px solid ${T.border}`, padding:'12px 14px', minHeight:180 }}>
      <div style={{ fontSize:12.5, fontWeight:700, color:T.text, marginBottom:8 }}>{title}</div>
      {!data||data.total_defect===0 ? <div style={{ color:T.textLight, textAlign:'center', paddingTop:28, fontSize:12 }}>No data</div> : (
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:color+'14', border:`1.5px solid ${color}35`, borderRadius:7, padding:'6px 10px', minWidth:64, alignSelf:'center' }}>
            <div style={{ fontSize:9, color:T.textMuted, marginBottom:1 }}>Total</div>
            <div style={{ fontSize:15, fontWeight:700, color }}>{data.total_defect.toLocaleString()}</div>
          </div>
          <div style={{ flex:'0 0 16px', height:1, background:`linear-gradient(90deg,${color}30,${color})` }} />
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:2 }}>
            <div style={{ fontSize:9, color:T.textMuted, fontWeight:600, marginBottom:1 }}>Defect mode</div>
            {data.by_mode.slice(0,4).map((m,i) => (
              <div key={i} style={{ position:'relative', height:18 }}>
                <div style={{ height:18, borderRadius:3, background:color+'14', width:`${Math.max(25,(m.defect_count/maxMode)*100)}%`, border:`1px solid ${color}25` }} />
                <div style={{ position:'absolute', top:2, left:6, fontSize:9.5, color:'#444', whiteSpace:'nowrap', overflow:'hidden', maxWidth:'90%' }}>{m.defect_mode} <span style={{ color:T.textLight }}>{m.defect_count}</span></div>
              </div>
            ))}
          </div>
          <div style={{ flex:'0 0 16px', height:1, background:`linear-gradient(90deg,${color},${color}30)` }} />
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:2 }}>
            <div style={{ fontSize:9, color:T.textMuted, fontWeight:600, marginBottom:1 }}>P/H Top</div>
            {data.by_part.slice(0,4).map((p,i) => (
              <div key={i} style={{ position:'relative', height:18 }}>
                <div style={{ height:18, borderRadius:3, background:color+'0D', width:`${Math.max(25,(p.defect_count/maxPart)*100)}%`, border:`1px solid ${color}18` }} />
                <div style={{ position:'absolute', top:2, left:6, fontSize:9.5, color:'#444', whiteSpace:'nowrap', overflow:'visible', maxWidth:'90%' }}>{p.part_no} <span style={{ color:T.textLight }}>{p.defect_count}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Inner Page (needs Suspense boundary for useSearchParams) ────── //
function CategoryPageInner() {
  const { filters, setFilters, updateFilter, navigateTo, pathname } = useSharedFilters()

  // ── Track whether this mount came from a tab-switch (suppress loading spinner) ──
  const suppressLoadingRef = useRef(consumeTabNav())

  const [loading,        setLoading]        = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [breakdown,      setBreakdown]      = useState<any>(null)

  const [modelOpts,      setModelOpts]      = useState<string[]>([])
  const [lineOpts,       setLineOpts]       = useState<string[]>([])
  const [defectModeOpts, setDefectModeOpts] = useState<string[]>([])

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null)

  // Load options — use cache to avoid re-fetching on tab switch
  useEffect(() => {
    const cached = loadCachedOpts()
    if (cached) {
      setModelOpts(cached.models); setLineOpts(cached.lines); setDefectModeOpts(cached.defectModes)
      return
    }
    Promise.all([
      fetch(`${API}/options/models`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/options/lines`).then(r=>r.json()).catch(()=>[]),
      fetch(`${API}/options/defect-modes`).then(r=>r.json()).catch(()=>[]),
    ]).then(([m,l,d]) => {
      const models=Array.isArray(m)?m:[], lines=Array.isArray(l)?l:[], defectModes=Array.isArray(d)?d:[]
      setModelOpts(models); setLineOpts(lines); setDefectModeOpts(defectModes)
      saveCachedOpts({ models, lines, defectModes })
    })
  }, [])

  const fetchData = useCallback(async (f: Filters) => {
    // After the first real fetch, always show the spinner normally
    const suppress = suppressLoadingRef.current
    suppressLoadingRef.current = false

    if (!suppress) setLoading(true)
    try {
      const {start,end} = getRange(f.datePreset, f.startDate, f.endDate)
      const p = new URLSearchParams()
      if (start) p.set('date_from', start); if (end) p.set('date_to', end)
      const sh = shiftParam(f); if (sh) p.set('shift', sh)
      if (f.model) p.set('model', f.model); if (f.defectMode) p.set('defect_mode', f.defectMode); if (f.line) p.set('line', f.line)
      const bd = await fetch(`${API}/analyze/breakdown?${p}`).then(r=>r.json()).catch(()=>null)
      setBreakdown(bd&&typeof bd==='object'?bd:null)
    } finally { if (!suppress) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!suppressLoadingRef.current) {
      fetchData(filters)
    }
    // Tab-nav: breakdown already in state; nothing to do
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
    <div style={{ background:T.bg, display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════ */}
      <div style={{ height:50, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 22px' }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.text, lineHeight:1.2 }}>Analysis</div>
          <div style={{ fontSize:10, color:T.textMuted }}>Analysis &gt; Catalog</div>
        </div>
        <div style={{ display:'flex', gap:2, background:'#E9ECEF', borderRadius:7, padding:3 }}>
          {([
            { label:'Summarize', href:'/analysis/trend'    },
            { label:'Catalog',   href:'/analysis/category' },
          ]).map(v => {
            const active = pathname === v.href
            return (
              <button key={v.href} onClick={()=>navigateTo(v.href)}
                style={{ padding:'5px 16px', borderRadius:5, border:'none', cursor:'pointer', background:active?T.primary:'transparent', color:active?'#fff':T.textMuted, fontWeight:600, fontSize:12, fontFamily:'Sarabun,sans-serif', boxShadow:active?`0 1px 5px ${T.primary}44`:'none', transition:'all .15s' }}>
                {v.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ══ FILTER BAR ══════════════════════════════════════════════ */}
      <div style={{ flexShrink:0, margin:'0 22px 10px', background:T.card, borderRadius:8, border:`1px solid ${T.border}`, padding:'8px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'nowrap', minWidth:0 }}>

          {/* Date */}
          <div style={{ display:'flex', flexDirection:'column', gap:3, position:'relative', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ fontSize:10.5, fontWeight:600, color:T.text }}>Date</span>
              <span style={{ fontSize:9, color:T.textMuted }}>prod. date</span>
            </div>
            <button onClick={()=>setShowDatePicker(v=>!v)}
              style={{ display:'flex', alignItems:'center', gap:5, height:28, padding:'0 9px', background:'#fff', border:`1px solid ${T.border}`, borderRadius:5, fontSize:11.5, color:T.text, fontWeight:500, cursor:'pointer', fontFamily:'Sarabun,sans-serif', whiteSpace:'nowrap' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {getDateLabel(filters.datePreset, filters.startDate, filters.endDate)}
            </button>
            {showDatePicker && (
              <DatePickerPopover
                filters={filters}
                onChange={handleDateChange}
                onClose={()=>setShowDatePicker(false)}
              />
            )}
          </div>

          <div style={{ width:1, height:28, background:T.border, flexShrink:0 }} />

          {/* Shift */}
          <div style={{ display:'flex', flexDirection:'column', gap:3, flexShrink:0 }}>
            <span style={{ fontSize:10.5, fontWeight:600, color:T.text }}>Shift</span>
            <div style={{ display:'flex', gap:3 }}>
              {(['A','B'] as const).map(s => {
                const on = s==='A' ? filters.shiftA : filters.shiftB
                return (
                  <button key={s} onClick={()=>handleUpdateFilter(s==='A'?'shiftA':'shiftB', !on)}
                    style={{ height:28, width:32, borderRadius:5, border:`1.5px solid ${on?T.primary:T.border}`, background:on?T.primary:'#fff', color:on?'#fff':T.textMuted, fontWeight:700, fontSize:11.5, cursor:'pointer', fontFamily:'Sarabun,sans-serif', transition:'all .15s' }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ width:1, height:28, background:T.border, flexShrink:0 }} />

          {/* Line / Model / Defect Mode */}
          {([
            {label:'Line',        val:filters.line,       key:'line',       opts:lineOpts,       w:90 },
            {label:'Model',       val:filters.model,      key:'model',      opts:modelOpts,      w:110},
            {label:'Defect Mode', val:filters.defectMode, key:'defectMode', opts:defectModeOpts, w:130},
          ] as const).map(({label:lbl2, val, key, opts, w}) => (
            <div key={key} style={{ display:'flex', flexDirection:'column', gap:3, flexShrink:0 }}>
              <span style={{ fontSize:10.5, fontWeight:600, color:T.text }}>{lbl2}</span>
              <div style={{ display:'flex', alignItems:'center', border:`1px solid ${T.border}`, borderRadius:5, padding:'0 7px', height:28, background:'#fff', width:w }}>
                <select value={val} onChange={e=>handleUpdateFilter(key as keyof Filters, e.target.value)}
                  style={{ border:'none', outline:'none', fontSize:11.5, color:val?T.text:T.textMuted, background:'transparent', fontFamily:'Sarabun,sans-serif', flex:1, cursor:'pointer', width:'100%' }}>
                  <option value="">All</option>
                  {opts.map(o=><option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          ))}

          <div style={{ flex:1 }} />

          {/* Reload */}
          <button onClick={()=>fetchData(filters)} disabled={loading} title="Reload"
            style={{ height:28, width:28, display:'flex', alignItems:'center', justifyContent:'center', background:'#fff', border:`1px solid ${T.border}`, borderRadius:5, cursor:'pointer', color:T.textMuted, flexShrink:0, opacity:loading?.6:1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.18-8.93"/>
            </svg>
          </button>

          {/* Reset */}
          <button onClick={handleReset}
            style={{ height:28, padding:'0 11px', display:'flex', alignItems:'center', gap:4, background:'#fff', border:`1px solid ${T.danger}55`, borderRadius:5, cursor:'pointer', color:T.danger, fontWeight:700, fontSize:11.5, fontFamily:'Sarabun,sans-serif', flexShrink:0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            reset
          </button>

          {/* Spinner — hidden during tab-switch, shown during real fetches only */}
          {loading && <div style={{ width:14, height:14, border:`2px solid ${T.border}`, borderTop:`2px solid ${T.primary}`, borderRadius:'50%', animation:'az-spin .7s linear infinite', flexShrink:0 }} />}
        </div>
      </div>

      {/* ══ CONTENT ══════════════════════════════════════════════════ */}
      <div style={{ flex:1, minHeight:0, padding:'0 22px 12px', overflowY:'auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <SankeyCard title="Tank Top" data={breakdown?.tank_top} color="#C0001A" />
          <SankeyCard title="Tank Btm" data={breakdown?.tank_btm} color="#E67700" />
          <SankeyCard title="P/H Top"  data={breakdown?.ph_top}  color="#1971C2" />
          <SankeyCard title="P/H Btm"  data={breakdown?.ph_btm}  color="#6741D9" />
        </div>
      </div>

      <style>{`@keyframes az-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Suspense wrapper required for useSearchParams ────────────────── //
export default function AnalysisCategoryPage() {
  return (
    <Suspense>
      <CategoryPageInner />
    </Suspense>
  )
}