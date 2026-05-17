'use client'

import { useEffect, useRef, useState } from 'react'

// ── API Base ───────────────────────────────────────────────────────
const API = 'http://localhost:8000'

// ── Types ──────────────────────────────────────────────────────────
interface DefectRow {
  no:                number
  db_id:             number
  name:              string
  date_day:          string
  time:              string
  shift_group:       string
  line:              string
  model_qr:          string
  defect_qr:         string
  defect_mode:       string
  defect_code:       string
  defect_by_process: string
  defect_type:       string
  part_no:           string
  core_no:           string
  model:             string
  production_date:   string
  production_time:   string
  work_tag:          string
  ph_top:            string
  die_list_ph_top:   string
  ph_btm:            string
  die_list_ph_btm:   string
  th_top:            string
  th_btm:            string
}

interface DefectFilters {
  dateType:   'scan' | 'production'
  dateFrom:   string
  dateTo:     string
  shift:      string
  name:       string
  defectMode: string
  model:      string
  coreNo:     string
  line:       string
}

// ── Helpers ────────────────────────────────────────────────────────
const fmtProdDate = (raw: string) => {
  if (!raw || raw.length < 6) return raw
  return `${raw.slice(0,2)}/${raw.slice(2,4)}/20${raw.slice(4,6)}`
}
const fmtIsoDate = (raw: string) => {
  if (!raw) return raw
  const parts = raw.slice(0,10).split('-')
  if (parts.length !== 3) return raw
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
const fmtProdTime = (raw: string) => {
  if (!raw || raw.length < 6) return raw
  return `${raw.slice(0,2)}:${raw.slice(2,4)}:${raw.slice(4,6)}`
}

function emptyFilters(): DefectFilters {
  return { dateType:'scan', dateFrom:'', dateTo:'', shift:'', name:'', defectMode:'', model:'', coreNo:'', line:'' }
}

const getTodayStr = () => {
  const now   = new Date()
  const day   = now.getDate()
  const month = now.toLocaleString('en-US', { month: 'short' })
  const year  = now.getFullYear()
  const hh    = String(now.getHours()).padStart(2, '0')
  const mm    = String(now.getMinutes()).padStart(2, '0')
  const h     = now.getHours() * 60 + now.getMinutes()
  const shift = h >= 7 * 60 + 30 && h <= 19 * 60 + 50 ? 'Day' : 'Night'
  return `${day} ${month} ${year} ${hh}:${mm} - ${shift}`
}

// ── Column definitions ─────────────────────────────────────────────
const COLS: { key: keyof DefectRow; label: string }[] = [
  { key: 'no',                label: 'No.'               },
  { key: 'name',              label: 'Name'              },
  { key: 'date_day',          label: 'Date'              },
  { key: 'time',              label: 'Time'              },
  { key: 'shift_group',       label: 'Shift'             },
  { key: 'line',              label: 'Line'              },
  { key: 'model_qr',          label: 'Side QR (Model)'   },
  { key: 'defect_qr',         label: 'Defect item'       },
  { key: 'defect_mode',       label: 'Defect mode'       },
  { key: 'defect_code',       label: 'Defect code'       },
  { key: 'defect_by_process', label: 'Process'           },
  { key: 'defect_type',       label: 'Type'              },
  { key: 'part_no',           label: 'Part no.'          },
  { key: 'core_no',           label: 'Core no.'          },
  { key: 'model',             label: 'Model'             },
  { key: 'production_date',   label: 'Production date'   },
  { key: 'production_time',   label: 'Production time'   },
  { key: 'work_tag',          label: 'Work tag'          },
  { key: 'ph_top',            label: 'P/H Top'           },
  { key: 'die_list_ph_top',   label: 'Die list (P/H Top)'},
  { key: 'ph_btm',            label: 'P/H Btm'           },
  { key: 'die_list_ph_btm',   label: 'Die list (P/H Btm)'},
  { key: 'th_top',            label: 'T/H Top'           },
  { key: 'th_btm',            label: 'T/H Btm'           },
]

// ── Icons ──────────────────────────────────────────────────────────
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconFilter = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
  </svg>
)
const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

// ── Filter Panel styles ────────────────────────────────────────────
const fpStyle = {
  panel: {
    position: 'fixed' as const, top: 130, right: 28, width: 360,
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
    boxShadow: '0 8px 30px rgba(0,0,0,.10)', zIndex: 300,
    display: 'flex', flexDirection: 'column' as const,
  },
  header:    { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px 10px', flexShrink:0 },
  title:     { fontSize:14, fontWeight:700, color:'#000' },
  close:     { background:'none', border:'none', color:'#9ca3af', fontSize:16, cursor:'pointer', padding:'2px 6px', borderRadius:6, lineHeight:1, fontFamily:'Sarabun,sans-serif' },
  body:      { padding:'0 14px 12px', display:'flex', flexDirection:'column' as const, gap:8 },
  group:     { background:'#fff', border:'1px solid #D9D9D9', borderRadius:10, padding:'10px 12px', display:'flex', flexDirection:'column' as const, gap:8 },
  row:       { display:'flex', alignItems:'center', gap:10, minHeight:32 },
  label:     { fontSize:12.5, fontWeight:600, color:'#1462FF', width:82, flexShrink:0 },
  select:    { flex:1, height:32, padding:'0 8px', border:'1px solid #D9D9D9', borderRadius:7, fontSize:12.5, background:'#fff', color:'#111827', outline:'none', fontFamily:'Sarabun,sans-serif', cursor:'pointer', minWidth:0 } as React.CSSProperties,
  dateInput: { flex:1, height:32, padding:'0 8px', border:'1px solid #D9D9D9', borderRadius:7, fontSize:12, fontFamily:'Sarabun,sans-serif', color:'#111827', background:'#fff', outline:'none', minWidth:0 } as React.CSSProperties,
  footer:    { display:'flex', gap:8, padding:'10px 14px', borderTop:'1px solid #f3f4f6', flexShrink:0 },
  applyBtn:  { flex:1, height:36, background:'#1462FF', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'Sarabun,sans-serif' },
  resetBtn:  { flex:1, height:36, background:'none', color:'#9ca3af', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, cursor:'pointer', fontFamily:'Sarabun,sans-serif' },
}

// ── Filter Panel ──────────────────────────────────────────────────
function FilterPanel({ open, onClose, filters, setFilters, nameOpts, modeOpts, modelOpts, coreOpts, lineOpts, onApply, onReset }: {
  open: boolean; onClose: () => void
  filters: DefectFilters; setFilters: (f: DefectFilters) => void
  nameOpts: string[]; modeOpts: string[]; modelOpts: string[]
  coreOpts: string[]; lineOpts: string[]
  onApply: () => void; onReset: () => void
}) {
  if (!open) return null
  const set = (patch: Partial<DefectFilters>) => setFilters({ ...filters, ...patch })
  return (
    <>
      <div className="fp-backdrop" onClick={onClose} />
      <div style={fpStyle.panel}>
        <div style={fpStyle.header}>
          <span style={fpStyle.title}>Filter</span>
          <button style={fpStyle.close} onClick={onClose}>✕</button>
        </div>
        <div style={fpStyle.body}>
          <div style={fpStyle.group}>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                <span style={fpStyle.label}>Date</span>
                {(['scan','production'] as const).map(t => (
                  <label key={t} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#6b7280', cursor:'pointer' }}>
                    <input type="radio" checked={filters.dateType===t} onChange={() => set({ dateType:t })}
                      style={{ width:'auto', margin:0, accentColor:'#1462FF' }} />
                    {t.charAt(0).toUpperCase()+t.slice(1)}
                  </label>
                ))}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, paddingLeft:20 }}>
                <input type="date" style={fpStyle.dateInput} value={filters.dateFrom}
                  onChange={e => set({ dateFrom:e.target.value })} />
                <span style={{ color:'#d1d5db', fontSize:13, flexShrink:0 }}>—</span>
                <input type="date" style={fpStyle.dateInput} value={filters.dateTo}
                  onChange={e => set({ dateTo:e.target.value })} />
              </div>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Shift</span>
              <select style={fpStyle.select} value={filters.shift} onChange={e => set({ shift:e.target.value })}>
                <option value="">All</option>
                <option value="A">Shift A</option>
                <option value="B">Shift B</option>
              </select>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Name</span>
              <select style={fpStyle.select} value={filters.name} onChange={e => set({ name:e.target.value })}>
                <option value="">All</option>
                {nameOpts.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div style={fpStyle.group}>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Defect Mode</span>
              <select style={fpStyle.select} value={filters.defectMode} onChange={e => set({ defectMode:e.target.value })}>
                <option value="">All</option>
                {modeOpts.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Model</span>
              <select style={fpStyle.select} value={filters.model} onChange={e => set({ model:e.target.value })}>
                <option value="">All</option>
                {modelOpts.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Core no.</span>
              <select style={fpStyle.select} value={filters.coreNo} onChange={e => set({ coreNo:e.target.value })}>
                <option value="">All</option>
                {coreOpts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Line</span>
              <select style={fpStyle.select} value={filters.line} onChange={e => set({ line:e.target.value })}>
                <option value="">All</option>
                {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={fpStyle.footer}>
          <button style={fpStyle.applyBtn} onClick={() => { onApply(); onClose() }}>Add filter</button>
          <button style={fpStyle.resetBtn} onClick={() => { onReset(); onClose() }}>Reset</button>
        </div>
      </div>
    </>
  )
}

// ── Confirm Delete Dialog ──────────────────────────────────────────
function ConfirmDialog({ rowNo, onCancel, onConfirm, deleting }: {
  rowNo: number; onCancel: () => void; onConfirm: () => void; deleting: boolean
}) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'32px 40px', textAlign:'center', minWidth:280, boxShadow:'0 8px 40px rgba(0,0,0,.15)' }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>ยืนยันการลบ?</div>
        <div style={{ fontSize:13, color:'#999', marginBottom:24 }}>แถวที่ {rowNo} จะถูกลบออกจากฐานข้อมูล</div>
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <button onClick={onCancel} disabled={deleting}
            style={{ padding:'9px 24px', borderRadius:10, fontSize:13, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer', fontFamily:'Sarabun,sans-serif', opacity:deleting?0.5:1 }}>
            ยกเลิก
          </button>
          <button onClick={onConfirm} disabled={deleting}
            style={{ padding:'9px 24px', borderRadius:10, fontSize:13, background:'#C0001A', color:'#fff', border:'none', fontWeight:600, cursor:deleting?'not-allowed':'pointer', fontFamily:'Sarabun,sans-serif', opacity:deleting?0.6:1, minWidth:80 }}>
            {deleting ? 'กำลังลบ…' : 'ลบ'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────
export default function DefectTablePage() {
  const [rows,       setRows]       = useState<DefectRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [search,     setSearch]     = useState('')
  const [filters,    setFilters]    = useState<DefectFilters>(emptyFilters())
  const [applied,    setApplied]    = useState<DefectFilters>(emptyFilters())
  const [fpOpen,     setFpOpen]     = useState(false)
  const [confirmRow, setConfirmRow] = useState<{ displayNo: number; dbId: number } | null>(null)
  const [deleting,   setDeleting]   = useState(false)
  // ── แก้ set-state-in-effect: ใช้ lazy initializer (ไม่ต้อง effect สำหรับค่าเริ่มต้น) ──
  const [todayStr,   setTodayStr]   = useState<string>(getTodayStr)

  const [nameOpts,  setNameOpts]  = useState<string[]>([])
  const [modeOpts,  setModeOpts]  = useState<string[]>([])
  const [modelOpts, setModelOpts] = useState<string[]>([])
  const [coreOpts,  setCoreOpts]  = useState<string[]>([])
  const [lineOpts,  setLineOpts]  = useState<string[]>([])

  const fetchingRef = useRef(false)

  const ns = (arr: string[]) =>
    arr.sort((a,b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' }))

  // ── แก้ set-state-in-effect: ไม่ call setState synchronously ใน body ──
  // ใช้แค่ interval; ค่าเริ่มต้นมาจาก lazy initializer ข้างบนแล้ว
  useEffect(() => {
    const t = setInterval(() => setTodayStr(getTodayStr()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const get = (url: string): Promise<string[]> =>
      fetch(url).then(r => r.json() as Promise<string[]>).catch(() => [])
    Promise.all([
      get(`${API}/options/names`),
      get(`${API}/options/defect-modes`),
      get(`${API}/options/models`),
      get(`${API}/options/corenos`),
      get(`${API}/options/lines`),
    ]).then(([names, modes, models, cores, lines]) => {
      setNameOpts(Array.isArray(names)   ? ns(names)   : [])
      setModeOpts(Array.isArray(modes)   ? ns(modes)   : [])
      setModelOpts(Array.isArray(models) ? ns(models)  : [])
      setCoreOpts(Array.isArray(cores)   ? ns(cores)   : [])
      setLineOpts(Array.isArray(lines)   ? ns(lines)   : [])
    })
  }, [])

  const fetchData = async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API}/records/defect`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as DefectRow[]
      setRows(data)
    } catch (e: unknown) {
      setError('Cannot load data: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }

  useEffect(() => {
    const loadData = async () => {
      if (fetchingRef.current) return

      fetchingRef.current = true
      setLoading(true)
      setError('')

      try {
        const r = await fetch(`${API}/records/defect`)

        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`)
        }

        const data = (await r.json()) as DefectRow[]
        setRows(data)

      } catch (e: unknown) {
        setError(
          'Cannot load data: ' +
          (e instanceof Error ? e.message : String(e))
        )
      } finally {
        setLoading(false)
        fetchingRef.current = false
      }
    }

    void loadData()
  }, [])

  const handleDelete = async () => {
    if (!confirmRow) return
    setDeleting(true)
    try {
      const r = await fetch(`${API}/defect/${confirmRow.dbId}`, { method:'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await fetchData()
    } catch (e: unknown) {
      alert('ลบไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDeleting(false)
      setConfirmRow(null)
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    if (q && !Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))) return false
    const f = applied
    if (f.dateFrom || f.dateTo) {
      let dateVal = ''
      if (f.dateType === 'production') {
        const raw = r.production_date
        if (raw.length >= 6) dateVal = `20${raw.slice(4,6)}-${raw.slice(2,4)}-${raw.slice(0,2)}`
      } else {
        dateVal = r.date_day
      }
      if (f.dateFrom && dateVal < f.dateFrom) return false
      if (f.dateTo   && dateVal > f.dateTo)   return false
    }
    if (f.shift      && !r.shift_group.startsWith(f.shift+'/')) return false
    if (f.name       && r.name        !== f.name)       return false
    if (f.defectMode && r.defect_mode !== f.defectMode) return false
    if (f.model      && r.model       !== f.model)      return false
    if (f.coreNo     && r.core_no     !== f.coreNo)     return false
    if (f.line       && r.line        !== f.line)       return false
    return true
  })

  const badgeCount = Object.entries(applied).filter(([k,v]) => v && k !== 'dateType').length

  const formatCell = (key: keyof DefectRow, value: DefectRow[keyof DefectRow]): string => {
    const s = String(value ?? '')
    if (key === 'date_day')        return fmtIsoDate(s)
    if (key === 'production_date') return fmtProdDate(s)
    if (key === 'production_time') return fmtProdTime(s)
    return s || '—'
  }

  return (
    <div className="dfp-page" style={{ height:'100vh', display:'flex', flexDirection:'column', overflow:'hidden', background:'#F8FAFC' }}>

      {confirmRow !== null && (
        <ConfirmDialog
          rowNo={confirmRow.displayNo}
          onCancel={() => !deleting && setConfirmRow(null)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}

      <div className="dfp-header-bar" style={{ background:'transparent', borderBottom:'none', paddingBottom:0 }}>
        <div className="dfp-header-left">
          <h1 className="dfp-title">Defect Table</h1>
          <span className="dfp-breadcrumb">Data Table &gt; Defect Table</span>
        </div>
      </div>

      <div className="dfp-body">

        <div className="dfp-card dfp-info-card" style={{ flex:'none', height:90 }}>
          <div className="dfp-info-field">
            <label className="dfp-info-label">Search</label>
            <div className="dt-search-wrap">
              <IconSearch />
              <input className="dt-search" type="text" placeholder="Search..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="dfp-info-field" style={{ justifyContent:'flex-end' }}>
            <label className="dfp-info-label" style={{ visibility:'hidden' }}>_</label>
            <div style={{ display:'flex', gap:8 }}>
              <button className={`dt-filter-btn${badgeCount>0?' active':''}`} onClick={() => setFpOpen(true)}>
                <IconFilter />
                {badgeCount > 0 && <span className="dt-filter-badge">{badgeCount}</span>}
              </button>
              <button onClick={() => void fetchData()} style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 12px', background:'none', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, cursor:'pointer', fontFamily:"'Sarabun',sans-serif" }}>
                <IconRefresh />
              </button>
            </div>
          </div>
          <div className="dfp-info-field dfp-info-date" style={{ marginLeft:'auto' }}>
            <label className="dfp-info-label" style={{ marginLeft:'auto' }}>Date (Real time)</label>
            <div className="dfp-date-display">{todayStr}</div>
          </div>
        </div>

        <div className="dfp-card" style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'10px 16px 8px', borderBottom:'1px solid #f3f4f6', flexShrink:0 }}>
            <span style={{ fontSize:12, color:'#9ca3af' }}>{loading ? 'Loading…' : `${filtered.length} rows`}</span>
          </div>
          <div style={{ flex:1, overflowX:'auto', overflowY:'auto', minHeight:0, scrollbarWidth:'thin', scrollbarColor:'rgba(99,102,241,.2) transparent' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5, whiteSpace:'nowrap' }}>
              <thead>
                <tr>
                  {COLS.map(c => (
                    <th key={c.key} style={{ padding:'10px 14px', textAlign:'left', fontWeight:600, fontSize:12, color:'#6b7280', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', borderRight:'1px solid #e5e7eb', position:'sticky', top:0, zIndex:2, whiteSpace:'nowrap' }}>
                      {c.label}
                    </th>
                  ))}
                  <th style={{ padding:'10px 14px', fontWeight:600, fontSize:12, color:'#6b7280', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', position:'sticky', top:0, zIndex:2, width:70 }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLS.length+1} style={{ textAlign:'center', padding:48, color:'#d1d5db' }}>Loading…</td></tr>
                ) : error ? (
                  <tr><td colSpan={COLS.length+1} style={{ textAlign:'center', padding:48, color:'#C0001A' }}>{error}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={COLS.length+1} style={{ textAlign:'center', padding:48, color:'#d1d5db' }}>No records</td></tr>
                ) : filtered.map((row, i) => (
                  <tr key={i}
                    onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background='#f5f3ff'}
                    onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background=''}
                  >
                    {COLS.map(c => (
                      <td key={c.key} style={{ padding:'9px 14px', borderBottom:'1px solid #f0f0f0', borderRight:'1px solid #f0f0f0', color:'#374151' }}
                        title={String(row[c.key])}>
                        {formatCell(c.key, row[c.key])}
                      </td>
                    ))}
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid #f0f0f0' }}>
                      <button
                        onClick={() => setConfirmRow({ displayNo: row.no, dbId: row.db_id ?? row.no })}
                        className="dt-del-btn"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <FilterPanel
          open={fpOpen} onClose={() => setFpOpen(false)}
          filters={filters} setFilters={setFilters}
          nameOpts={nameOpts} modeOpts={modeOpts} modelOpts={modelOpts}
          coreOpts={coreOpts} lineOpts={lineOpts}
          onApply={() => setApplied({ ...filters })}
          onReset={() => { setFilters(emptyFilters()); setApplied(emptyFilters()) }}
        />

      </div>
    </div>
  )
}