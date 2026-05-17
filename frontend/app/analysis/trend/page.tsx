'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import * as echarts from 'echarts'
import { API, COLORS, DONUT_COLORS } from '../../shared'
import { useSharedFilters, loadCachedOpts, saveCachedOpts, emptyFilters, consumeTabNav } from '../useSharedFilters'
import type { Filters, DatePreset } from '../useSharedFilters'

// ── Theme colors ─────────────────────────────────────────────────────
const T = {
  primary:    '#3B5BDB',
  primaryBg:  '#EEF2FF',
  danger:     '#C92A2A',
  success:    '#2F9E44',
  border:     '#DEE2E6',
  bg:         '#F1F3F5',
  card:       '#FFFFFF',
  text:       '#212529',
  textMuted:  '#868E96',
  textLight:  '#ADB5BD',
  shiftA:     '#3B5BDB',
  shiftB:     '#74C0FC',
  dayColor:   '#3B5BDB',
  nightColor: '#91A7FF',
  warning:    '#E67700',
}
const CHART_COLORS = ['#3B5BDB','#5C7CFA','#748FFC','#91A7FF','#BAC8FF','#364FC7','#4263EB']

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

function buildPeriodList(preset:DatePreset, s:string, e:string): string[] {
  const today=new Date(), fmt=(d:Date)=>d.toISOString().slice(0,10)
  if (preset==='this_year') return Array.from({length:today.getMonth()+1},(_,i)=>`${today.getFullYear()}-${String(i+1).padStart(2,'0')}`)
  if (preset==='this_month') { const y=today.getFullYear(),m=today.getMonth(),ms=String(m+1).padStart(2,'0'),days=new Date(y,m+1,0).getDate(); return Array.from({length:days},(_,i)=>`${y}-${ms}-${String(i+1).padStart(2,'0')}`) }
  if (preset==='this_week') return Array.from({length:7},(_,i)=>{const d=new Date(today);d.setDate(today.getDate()-6+i);return fmt(d)})
  if (preset==='custom'&&s&&e) { const ps:string[]=[],cur=new Date(s),end=new Date(e); while(cur<=end){ps.push(fmt(cur));cur.setDate(cur.getDate()+1)} return ps }
  return []
}

function fillPeriods(periods:string[], apiData:any[]): any[] {
  const map:Record<string,any>={}; apiData.forEach(r=>{const k=r.prod_date??r.date??r.period;if(k)map[k]=r})
  return periods.map(p=>map[p]??{prod_date:p,by_mode:{},volume:0,ratio:0})
}

function groupByMonth(data:any[]): any[] {
  const mm:Record<string,{volume:number;defect:number}>={}
  data.forEach(r=>{const month=(r.prod_date??r.date??'').slice(0,7);if(!month)return;if(!mm[month])mm[month]={volume:0,defect:0};mm[month].volume+=r.volume??0;mm[month].defect+=Math.round((r.ratio??0)/100*(r.volume??0))})
  return Object.entries(mm).sort(([a],[b])=>a.localeCompare(b)).map(([month,v])=>({prod_date:month,by_mode:{},volume:v.volume,ratio:v.volume?+((v.defect/v.volume)*100).toFixed(4):0}))
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

// ─── Inner Page ───────────────────────────────────────────────────── //
function TrendPageInner() {
  const { filters, setFilters, updateFilter, navigateTo, pathname } = useSharedFilters()

  // ── Track whether this mount came from a tab-switch (suppress loading spinner) ──
  const suppressLoadingRef = useRef(consumeTabNav())

  const [loading,        setLoading]        = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)

  const [modelOpts,      setModelOpts]      = useState<string[]>([])
  const [lineOpts,       setLineOpts]       = useState<string[]>([])
  const [defectModeOpts, setDefectModeOpts] = useState<string[]>([])

  const [dailyRatio,      setDailyRatio]      = useState<any[]>([])
  const [byShiftDaily,    setByShiftDaily]    = useState<any[]>([])
  const [byDaynightDaily, setByDaynightDaily] = useState<any[]>([])
  const [byModel,         setByModel]         = useState<any[]>([])
  const [byCoreNo,        setByCoreNo]        = useState<any[]>([])
  const [tableRows,       setTableRows]       = useState<any[]>([])
  const [tablePage,       setTablePage]       = useState(1)
  const TABLE_PAGE_SIZE = 8

  const chartsRef      = useRef<Record<string, echarts.ECharts>>({})
  const [activePreset, setActivePreset] = useState<DatePreset>('this_month')
  const [activeStart,  setActiveStart]  = useState('')
  const [activeEnd,    setActiveEnd]    = useState('')
  const fetchTimerRef  = useRef<ReturnType<typeof setTimeout>|null>(null)

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
    setActivePreset(f.datePreset); setActiveStart(f.startDate); setActiveEnd(f.endDate)
    try {
      const {start,end} = getRange(f.datePreset, f.startDate, f.endDate)
      const p = new URLSearchParams()
      if (start) p.set('date_from', start); if (end) p.set('date_to', end)
      const sh = shiftParam(f); if (sh) p.set('shift', sh)
      if (f.model) p.set('model', f.model); if (f.defectMode) p.set('defect_mode', f.defectMode); if (f.line) p.set('line', f.line)
      p.set('date_preset', f.datePreset); p.set('date_type', 'production')
      const qs = `?${p}`
      const [dr,az] = await Promise.all([
        fetch(`${API}/analyze/daily-ratio${qs}`).then(r=>r.json()).catch(()=>[]),
        fetch(`${API}/analyze${qs}`).then(r=>r.json()).catch(()=>({})),
      ])
      setDailyRatio(Array.isArray(dr)?dr:[])
      if (az&&typeof az==='object') {
        setByShiftDaily(Array.isArray(az.by_shift_daily)?az.by_shift_daily:[])
        setByDaynightDaily(Array.isArray(az.by_daynight_daily)?az.by_daynight_daily:[])
        setByModel(Array.isArray(az.by_model)?az.by_model:[])
        setByCoreNo(Array.isArray(az.by_core_no)?az.by_core_no:[])
        setTableRows(Array.isArray(az.table)?az.table:[])
      }
      setTablePage(1)
    } finally { if (!suppress) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!suppressLoadingRef.current) {
      fetchData(filters)
    } else {
      // Tab-nav: data already in state from previous visit; just re-sync active preset
      setActivePreset(filters.datePreset)
      setActiveStart(filters.startDate)
      setActiveEnd(filters.endDate)
    }
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

  const draw = useCallback((id: string, option: any) => {
    const dom = document.getElementById(id); if (!dom) return
    if (chartsRef.current[id]) chartsRef.current[id].dispose()
    const chart = echarts.init(dom); chartsRef.current[id] = chart; chart.setOption(option)
  }, [])

  useEffect(() => {
    setTimeout(() => {
      const preset = activePreset, isYear = preset==='this_year'
      const sourceData = isYear ? groupByMonth(dailyRatio) : dailyRatio
      const periods = buildPeriodList(preset, activeStart, activeEnd)
      const filledData = fillPeriods(periods, sourceData)
      const dates   = filledData.map((r:any) => r.prod_date??r.date)
      const volumes = filledData.map((r:any) => r.volume??0)
      const ratios  = filledData.map((r:any) => r.ratio??0)
      const needZoom = preset==='custom' && dates.length>20
      const fmtDay = (d:string) => { const p=d.split('-'); return p.length>=3?`${parseInt(p[2])}`:d }

      draw('c-ratio', {
        grid:{left:44,right:14,top:24,bottom:needZoom?48:28},
        tooltip:{trigger:'axis',axisPointer:{type:'cross'},formatter:(params:any[])=>{const idx=params[0]?.dataIndex;return `<div style="font-size:11px;font-weight:600;margin-bottom:2px">${params[0]?.axisValueLabel}</div><div>Ratio: <b style="color:${T.warning}">${ratios[idx]?.toFixed(4)}%</b></div><div style="color:${T.textLight};font-size:10px">Vol: ${volumes[idx]?.toLocaleString()}</div>`}},
        dataZoom:needZoom?[{type:'slider',bottom:2,height:14,start:0,end:Math.round(20/dates.length*100),fillerColor:'rgba(59,91,219,.08)',borderColor:T.border,handleStyle:{color:T.primary},textStyle:{color:T.textLight,fontSize:9}},{type:'inside'}]:undefined,
        xAxis:{type:'category',data:dates,axisLabel:{fontSize:9,color:T.textMuted,interval:'auto',formatter:(value:string,index:number)=>{if(isYear){const[,m]=value.split('-');return new Date(2000,parseInt(m)-1).toLocaleString('en',{month:'short'})}const parts=value.split('-');if(parts.length<3)return value;const day=parseInt(parts[2]),isFirst=parts[2]==='01'||index===0;if(isFirst){const mn=new Date(2000,parseInt(parts[1])-1).toLocaleString('en',{month:'short'});return`{hi|${day}}\n${mn}`}return String(day)},rich:{hi:{color:T.primary,fontWeight:700,fontSize:9,lineHeight:13}}},axisTick:{alignWithLabel:true}},
        yAxis:{type:'value',name:'Ratio%',nameTextStyle:{fontSize:9,color:T.textMuted},axisLabel:{fontSize:9,color:T.textMuted,formatter:'{value}%'},splitLine:{lineStyle:{color:'rgba(0,0,0,.05)'}}},
        series:[{name:'Ratio%',type:'bar',data:ratios.map((v:number)=>({value:v,itemStyle:{color:v>0.5?T.warning:'#91A7FF',borderRadius:[3,3,0,0]}})),label:{show:true,position:'top',fontSize:8,formatter:(p:any)=>p.value>0?p.value.toFixed(2)+'%':'',color:(p:any)=>p.value>0.2?T.warning:T.textMuted}}],
      })

      const shiftDates=Array.from(new Set(byShiftDaily.map((r:any)=>r.date))).sort() as string[]
      const shiftKeys=Array.from(new Set(byShiftDaily.map((r:any)=>r.shift))).sort() as string[]
      const needSZ=shiftDates.length>14
      draw('c-shift', {
        grid:{left:34,right:10,top:24,bottom:needSZ?44:24},
        tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:(params:any[])=>{let html=`<div style="font-size:11px;font-weight:600;margin-bottom:2px">${params[0]?.axisValueLabel}</div>`,total=0;params.forEach((p:any)=>{if(!p.value)return;total+=p.value;html+=`<div>${p.seriesName}: <b>${p.value}</b></div>`});return html+`<div style="border-top:1px solid #eee;margin-top:2px;font-weight:700">Total: ${total}</div>`}},
        legend:{data:shiftKeys,top:2,textStyle:{fontSize:9},formatter:(s:string)=>`Shift ${s}`},
        dataZoom:needSZ?[{type:'slider',bottom:2,height:14,start:0,end:Math.round(14/shiftDates.length*100),fillerColor:'rgba(59,91,219,.08)',borderColor:T.border,handleStyle:{color:T.primary},textStyle:{color:T.textLight,fontSize:9}},{type:'inside'}]:undefined,
        xAxis:{type:'category',data:shiftDates.map(fmtDay),axisLabel:{fontSize:9,color:T.textMuted},axisTick:{alignWithLabel:true}},
        yAxis:{type:'value',axisLabel:{color:T.textMuted,fontSize:9},splitLine:{lineStyle:{color:'rgba(0,0,0,.05)'}}},
        series:shiftKeys.map((s,si)=>({name:s,type:'bar',stack:'shift',data:shiftDates.map(date=>{const r=byShiftDaily.find((d:any)=>d.date===date&&d.shift===s);return r?r.defect_count:0}),itemStyle:{color:si===0?T.shiftA:T.shiftB},label:{show:true,position:'inside',fontSize:8,color:'#fff',formatter:(p:any)=>p.value>0?p.value:''}})),
      })

      const dnDates=Array.from(new Set(byDaynightDaily.map((r:any)=>r.date))).sort() as string[]
      const dnKeys=Array.from(new Set(byDaynightDaily.map((r:any)=>r.group))).sort() as string[]
      const needDZ=dnDates.length>14
      draw('c-daynight', {
        grid:{left:34,right:10,top:24,bottom:needDZ?44:24},
        tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:(params:any[])=>{let html=`<div style="font-size:11px;font-weight:600;margin-bottom:2px">${params[0]?.axisValueLabel}</div>`,total=0;params.forEach((p:any)=>{if(!p.value)return;total+=p.value;html+=`<div>${p.seriesName}: <b>${p.value}</b></div>`});return html+`<div style="border-top:1px solid #eee;margin-top:2px;font-weight:700">Total: ${total}</div>`}},
        legend:{data:dnKeys,top:2,textStyle:{fontSize:9}},
        dataZoom:needDZ?[{type:'slider',bottom:2,height:14,start:0,end:Math.round(14/dnDates.length*100),fillerColor:'rgba(59,91,219,.08)',borderColor:T.border,handleStyle:{color:T.primary},textStyle:{color:T.textLight,fontSize:9}},{type:'inside'}]:undefined,
        xAxis:{type:'category',data:dnDates.map(fmtDay),axisLabel:{fontSize:9,color:T.textMuted},axisTick:{alignWithLabel:true}},
        yAxis:{type:'value',axisLabel:{color:T.textMuted,fontSize:9},splitLine:{lineStyle:{color:'rgba(0,0,0,.05)'}}},
        series:dnKeys.map((k,ki)=>({name:k,type:'bar',stack:'dn',data:dnDates.map(date=>{const r=byDaynightDaily.find((d:any)=>d.date===date&&d.group===k);return r?r.defect_count:0}),itemStyle:{color:ki===0?T.dayColor:T.nightColor},label:{show:true,position:'inside',fontSize:8,color:'#fff',formatter:(p:any)=>p.value>0?p.value:''}})),
      })

      const mNames=byModel.map(r=>r.model_name), mDefect=byModel.map(r=>r.defect_count??0)
      const needMZ=mNames.length>5
      draw('c-model', {
        grid:{left:34,right:10,top:24,bottom:needMZ?44:24},
        dataZoom:needMZ?[{type:'slider',bottom:2,height:14,start:0,end:Math.round(5/mNames.length*100),fillerColor:'rgba(59,91,219,.08)',borderColor:T.border,handleStyle:{color:T.primary},textStyle:{color:T.textLight,fontSize:9}},{type:'inside'}]:undefined,
        tooltip:{trigger:'axis',formatter:(params:any[])=>{return `<b>${params[0]?.axisValueLabel}</b><br/>Defect: ${params[0]?.value}`}},
        xAxis:{type:'category',data:mNames,axisLabel:{color:T.textMuted,fontSize:9,rotate:12}},
        yAxis:{type:'value',axisLabel:{color:T.textMuted,fontSize:9},splitLine:{lineStyle:{color:'rgba(0,0,0,.05)'}}},
        series:[{type:'bar',data:mDefect,itemStyle:{color:(p:any)=>CHART_COLORS[p.dataIndex%CHART_COLORS.length],borderRadius:[3,3,0,0]},label:{show:true,position:'top',fontSize:8,color:T.textMuted}}],
      })

      draw('c-coreno', {
        grid:{left:58,right:44,top:10,bottom:18},
        tooltip:{trigger:'axis'},
        xAxis:{type:'value',axisLabel:{color:T.textMuted,fontSize:9},splitLine:{lineStyle:{color:'rgba(0,0,0,.05)'}}},
        yAxis:{type:'category',data:byCoreNo.slice(0,8).map(r=>`Core ${r.core_no}`),axisLabel:{color:T.textMuted,fontSize:9}},
        series:[{type:'bar',data:byCoreNo.slice(0,8).map(r=>r.defect_count),itemStyle:{color:T.primary,borderRadius:[0,3,3,0]},label:{show:true,position:'right',fontSize:9,color:T.textMuted,formatter:(p:any)=>p.value>=1000?(p.value/1000).toFixed(1)+'K':String(p.value)}}],
      })
    }, 60)
  }, [dailyRatio, byShiftDaily, byDaynightDaily, byModel, byCoreNo, activePreset, activeStart, activeEnd, draw])

  const totalPages = Math.max(1, Math.ceil(tableRows.length/TABLE_PAGE_SIZE))
  const safePage   = Math.min(tablePage, totalPages)
  const pageRows   = tableRows.slice((safePage-1)*TABLE_PAGE_SIZE, safePage*TABLE_PAGE_SIZE)
  const from       = tableRows.length===0 ? 0 : (safePage-1)*TABLE_PAGE_SIZE+1
  const to         = Math.min(safePage*TABLE_PAGE_SIZE, tableRows.length)

  const card = { background:T.card, borderRadius:8, border:`1px solid ${T.border}`, boxShadow:'0 1px 2px rgba(0,0,0,.04)', padding:'8px 11px', overflow:'visible' as const }
  const lbl  = { fontSize:11.5, fontWeight:700 as const, color:T.text, marginBottom:4, flexShrink:0 as const }

  return (
    <div style={{ background:T.bg, display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════ */}
      <div style={{ height:50, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 22px' }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:T.text, lineHeight:1.2 }}>Analysis</div>
          <div style={{ fontSize:10, color:T.textMuted }}>Analysis &gt; Summarize</div>
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
      <div style={{ flex:1, minHeight:0, padding:'0 22px 12px', overflow:'hidden' }}>
        <div style={{ height:'100%', display:'grid', gridTemplateRows:'1fr 1fr 1fr', gap:9 }}>

          {/* Row 1: Ratio | Shift */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9, minHeight:0 }}>
            <div style={{ ...card, display:'flex', flexDirection:'column' }}>
              <div style={lbl}>Defect Ratio</div>
              <div id="c-ratio" style={{ flex:1, minHeight:0, width:'100%' }} />
            </div>
            <div style={{ ...card, display:'flex', flexDirection:'column' }}>
              <div style={lbl}>Defect by shift</div>
              <div id="c-shift" style={{ flex:1, minHeight:0, width:'100%' }} />
            </div>
          </div>

          {/* Row 2: Day/Night | Model */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9, minHeight:0 }}>
            <div style={{ ...card, display:'flex', flexDirection:'column' }}>
              <div style={lbl}>Defect by day / night</div>
              <div id="c-daynight" style={{ flex:1, minHeight:0, width:'100%' }} />
            </div>
            <div style={{ ...card, display:'flex', flexDirection:'column' }}>
              <div style={lbl}>Defect total by Model</div>
              <div id="c-model" style={{ flex:1, minHeight:0, width:'100%' }} />
            </div>
          </div>

          {/* Row 3: Core No | Table */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9, minHeight:0 }}>
            <div style={{ ...card, display:'flex', flexDirection:'column' }}>
              <div style={lbl}>Defect total by Core no.</div>
              <div id="c-coreno" style={{ flex:1, minHeight:0, width:'100%' }} />
            </div>
            <div style={{ ...card, display:'flex', flexDirection:'column', overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4, flexShrink:0 }}>
                <div style={lbl}>Summary</div>
                <div style={{ fontSize:9.5, color:T.textLight }}>{tableRows.length>0?`${from}–${to} / ${tableRows.length}`:''}</div>
              </div>
              <div style={{ flex:1, overflowY:'auto', overflowX:'auto', minHeight:0, scrollbarWidth:'thin' as const }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, whiteSpace:'nowrap' }}>
                  <thead>
                    <tr style={{ background:'#F8F9FA' }}>
                      {['#','Model','Line','Defect'].map(h=>(
                        <th key={h} style={{ padding:'4px 7px', textAlign:'left', fontWeight:700, color:T.textMuted, borderBottom:`1px solid ${T.border}`, fontSize:10, position:'sticky', top:0, background:'#F8F9FA' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length===0 ? <tr><td colSpan={4} style={{ textAlign:'center', color:T.textLight, padding:16, fontSize:11 }}>No data</td></tr>
                    : pageRows.map((r,i)=>(
                      <tr key={i}>
                        <td style={{ padding:'4px 7px', borderBottom:'1px solid #F3F4F6', color:T.textLight, fontSize:9.5 }}>{from+i}</td>
                        <td style={{ padding:'4px 7px', borderBottom:'1px solid #F3F4F6', fontWeight:500 }}>{r.model_name}</td>
                        <td style={{ padding:'4px 7px', borderBottom:'1px solid #F3F4F6' }}>{r.line}</td>
                        <td style={{ padding:'4px 7px', borderBottom:'1px solid #F3F4F6', fontWeight:600 }}>{r.defect_count?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages>1 && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:3, paddingTop:4, flexShrink:0 }}>
                  <button onClick={()=>setTablePage(p=>Math.max(1,p-1))} disabled={safePage===1} style={{ padding:'1px 6px', borderRadius:4, border:`1px solid ${T.border}`, background:'#fff', color:safePage===1?T.textLight:T.text, cursor:safePage===1?'default':'pointer', fontSize:10.5 }}>‹</button>
                  <span style={{ fontSize:10, color:T.textMuted }}>{safePage} / {totalPages}</span>
                  <button onClick={()=>setTablePage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} style={{ padding:'1px 6px', borderRadius:4, border:`1px solid ${T.border}`, background:'#fff', color:safePage===totalPages?T.textLight:T.text, cursor:safePage===totalPages?'default':'pointer', fontSize:10.5 }}>›</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes az-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Suspense wrapper required for useSearchParams ────────────────── //
export default function AnalysisTrendPage() {
  return (
    <Suspense>
      <TrendPageInner />
    </Suspense>
  )
}