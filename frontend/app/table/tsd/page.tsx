'use client'

import { useEffect, useState } from 'react'

// ── API Base ───────────────────────────────────────────────────────
const API = 'http://localhost:8000'

// ── Types ──────────────────────────────────────────────────────────
interface TSDFilters {
  dateFrom:  string
  dateTo:    string
  shift:     string
  dename:    string
  scrapCode: string
  item:      string
}

// ── Helpers ────────────────────────────────────────────────────────
const fmtIsoDate = (raw: string) => {
  if (!raw) return raw
  const parts = String(raw).slice(0,10).split('-')
  if (parts.length !== 3) return raw
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function emptyFilters(): TSDFilters {
  return { dateFrom:'', dateTo:'', shift:'', dename:'', scrapCode:'', item:'' }
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
const COLS: { key: string; label: string }[] = [
  { key: 'no',              label: 'No.'             },
  { key: 'date_day',        label: 'Date'            },
  { key: 'shift_group',     label: 'Shift'           },
  { key: 'department name', label: 'Department Name' },
  { key: 'scrap_code',      label: 'Scrap code'      },
  { key: 'item',            label: 'Item'            },
  { key: 'price',           label: 'Price'           },
  { key: 'quantity',        label: 'Quantity'        },
  { key: 'unit',            label: 'Unit'            },
  { key: 'Total actual',    label: 'Total Actual'    },
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
  panel: { position:'fixed' as const, top:130, right:28, width:360, background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, boxShadow:'0 8px 30px rgba(0,0,0,.10)', zIndex:300, display:'flex', flexDirection:'column' as const },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px 10px', flexShrink:0 },
  title:  { fontSize:14, fontWeight:700, color:'#000' },
  close:  { background:'none', border:'none', color:'#9ca3af', fontSize:16, cursor:'pointer', padding:'2px 6px', borderRadius:6, lineHeight:1, fontFamily:'Sarabun,sans-serif' },
  body:   { padding:'0 14px 12px', display:'flex', flexDirection:'column' as const, gap:8 },
  group:  { background:'#fff', border:'1px solid #D9D9D9', borderRadius:10, padding:'10px 12px', display:'flex', flexDirection:'column' as const, gap:8 },
  row:    { display:'flex', alignItems:'center', gap:10, minHeight:32 },
  label:  { fontSize:12.5, fontWeight:600, color:'#1462FF', width:82, flexShrink:0 },
  select: { flex:1, height:32, padding:'0 8px', border:'1px solid #D9D9D9', borderRadius:7, fontSize:12.5, background:'#fff', color:'#111827', outline:'none', fontFamily:'Sarabun,sans-serif', cursor:'pointer', minWidth:0 } as React.CSSProperties,
  dateInput: { flex:1, height:32, padding:'0 8px', border:'1px solid #D9D9D9', borderRadius:7, fontSize:12, fontFamily:'Sarabun,sans-serif', color:'#111827', background:'#fff', outline:'none', minWidth:0 } as React.CSSProperties,
  footer: { display:'flex', gap:8, padding:'10px 14px', borderTop:'1px solid #f3f4f6', flexShrink:0 },
  applyBtn: { flex:1, height:36, background:'#1462FF', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'Sarabun,sans-serif' },
  resetBtn: { flex:1, height:36, background:'none', color:'#9ca3af', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, cursor:'pointer', fontFamily:'Sarabun,sans-serif' },
}

// ── Filter Panel Component ─────────────────────────────────────────
function FilterPanel({ open, onClose, filters, setFilters, nameOpts, scrapCodeOpts, itemOpts, onApply, onReset }: {
  open: boolean; onClose: () => void
  filters: TSDFilters; setFilters: (f: TSDFilters) => void
  nameOpts: string[]; scrapCodeOpts: string[]; itemOpts: string[]
  onApply: () => void; onReset: () => void
}) {
  if (!open) return null
  const set = (patch: Partial<TSDFilters>) => setFilters({ ...filters, ...patch })
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
              <span style={fpStyle.label}>Department</span>
              <select style={fpStyle.select} value={filters.dename} onChange={e => set({ dename:e.target.value })}>
                <option value="">All</option>
                {nameOpts.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div style={fpStyle.group}>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Scrap code</span>
              <select style={fpStyle.select} value={filters.scrapCode} onChange={e => set({ scrapCode:e.target.value })}>
                <option value="">All</option>
                {scrapCodeOpts.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={fpStyle.row}>
              <span style={fpStyle.label}>Item</span>
              <select style={fpStyle.select} value={filters.item} onChange={e => set({ item:e.target.value })}>
                <option value="">All</option>
                {itemOpts.map(it => <option key={it} value={it}>{it}</option>)}
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
export default function TSDTablePage() {
  const [rows,      setRows]      = useState<Record<string,any>[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [filters,   setFilters]   = useState<TSDFilters>(emptyFilters())
  const [applied,   setApplied]   = useState<TSDFilters>(emptyFilters())
  const [fpOpen,    setFpOpen]    = useState(false)
  // confirmNo = display no (แถวที่ n), confirmId = _id จริงใน backend
  const [confirmNo, setConfirmNo] = useState<number|null>(null)
  const [confirmId, setConfirmId] = useState<number|null>(null)
  const [deleting,  setDeleting]  = useState(false)
  const [todayStr,  setTodayStr]  = useState('')

  const [nameOpts,      setNameOpts]      = useState<string[]>([])
  const [scrapCodeOpts, setScrapCodeOpts] = useState<string[]>([])
  const [itemOpts,      setItemOpts]      = useState<string[]>([])

  const ns = (arr: string[]) =>
    arr.sort((a,b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' }))

  useEffect(() => {
    setTodayStr(getTodayStr())
    const t = setInterval(() => setTodayStr(getTodayStr()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const get = (url: string) => fetch(url).then(r => r.json()).catch(() => [])
    Promise.all([
      get(`${API}/options/tsd-scrap-codes`),
      get(`${API}/options/tsd-items`),
    ]).then(([scrapCodes, items]) => {
      setScrapCodeOpts(Array.isArray(scrapCodes) ? ns(scrapCodes) : [])
      setItemOpts(Array.isArray(items)           ? ns(items)      : [])
    })
    // department options — ดึงจาก records แล้ว extract ทีหลัง
  }, [])

  const fetchData = async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/records/tsd-defect`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setRows(data)
      // สร้าง department options จากข้อมูลจริง
      const depts = [...new Set(data.map((d: any) => d['department name']).filter(Boolean))] as string[]
      setNameOpts(ns(depts))
    } catch (e: any) { setError('Cannot load data: ' + e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  // ลบ record — ใช้ _id (backend real id) ผ่าน DELETE /records/tsd-defect/{id}
  const handleDelete = async () => {
    if (confirmId === null) return
    setDeleting(true)
    try {
      const r = await fetch(`${API}/records/tsd-defect/${confirmId}`, { method:'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await fetchData()
    } catch (e: any) {
      alert('ลบไม่สำเร็จ: ' + e.message)
    } finally {
      setDeleting(false)
      setConfirmNo(null)
      setConfirmId(null)
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    if (q && !Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))) return false
    const f = applied
    const dateVal = String(r.date_day ?? '')
    if (f.dateFrom && dateVal < f.dateFrom) return false
    if (f.dateTo   && dateVal > f.dateTo)   return false
    if (f.shift     && !String(r.shift_group ?? '').startsWith(f.shift+'/')) return false
    if (f.dename    && String(r['department name'] ?? '') !== f.dename)      return false
    if (f.scrapCode && String(r.scrap_code ?? '') !== f.scrapCode)           return false
    if (f.item      && String(r.item       ?? '') !== f.item)                return false
    return true
  })

  const badgeCount = Object.values(applied).filter(Boolean).length

  return (
    <div className="dfp-page" style={{ height:'100vh', display:'flex', flexDirection:'column', overflow:'hidden', background:'#F8FAFC' }}>

      {confirmNo !== null && (
        <ConfirmDialog
          rowNo={confirmNo}
          onCancel={() => !deleting && (setConfirmNo(null), setConfirmId(null))}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}

      <div className="dfp-header-bar" style={{ background: 'transparent', borderBottom: 'none', paddingBottom: 0 }}>
        <div className="dfp-header-left">
          <h1 className="dfp-title">TSD-Defect Expense Table</h1>
          <span className="dfp-breadcrumb">Data Table &gt; TSD-Defect Expense Table</span>
        </div>
      </div>

      <div className="dfp-body">

        {/* Info card */}
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
              <button onClick={fetchData} style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 12px', background:'none', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, cursor:'pointer', fontFamily:"'Sarabun',sans-serif" }}>
                <IconRefresh />
              </button>
            </div>
          </div>
          <div className="dfp-info-field dfp-info-date" style={{ marginLeft:'auto' }}>
            <label className="dfp-info-label" style={{ marginLeft:'auto' }}>Date (Real time)</label>
            <div className="dfp-date-display">{todayStr}</div>
          </div>
        </div>

        {/* Table card */}
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
                        title={String(row[c.key] ?? '')}>
                        {c.key === 'date_day' ? fmtIsoDate(String(row[c.key] ?? ''))
                          : String(row[c.key] ?? '—')}
                      </td>
                    ))}
                    <td style={{ padding:'9px 14px', borderBottom:'1px solid #f0f0f0' }}>
                      {/* เก็บทั้ง display no และ _id จริงสำหรับ DELETE */}
                      <button
                        onClick={() => { setConfirmNo(row.no); setConfirmId(row._id ?? row.no) }}
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
          nameOpts={nameOpts} scrapCodeOpts={scrapCodeOpts} itemOpts={itemOpts}
          onApply={() => setApplied({ ...filters })}
          onReset={() => { setFilters(emptyFilters()); setApplied(emptyFilters()) }}
        />

      </div>
    </div>
  )
}