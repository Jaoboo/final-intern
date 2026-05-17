'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SquareCheckBig } from 'lucide-react'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { API, getTokenPayload } from '../../shared'

// ══════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════
interface TSDRow {
  id:        string
  date:      string
  scrapCode: string
  item:      string
  price:     string
  quantity:  string
  unit:      'EA' | 'KG' | ''
  total:     number
}
interface ToastMsg {
  id:      number
  message: string
  type:    'error' | 'warn' | 'info'
}

// ── Fix ②: type สำหรับ detail array จาก API error ──
type DetailItem = { msg?: string; [key: string]: unknown }

// ══════════════════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════════════════
const SCRAP_CODES    = ['31', '35', '37', '39']
const UNITS: ('EA' | 'KG')[] = ['EA', 'KG']
const MAX_VISIBLE_ROWS = 10

const EXCEL_COL_MAP: Record<string, keyof TSDRow> = {
  date: 'date', 'scan date': 'date',
  'scrap code': 'scrapCode', scrapcode: 'scrapCode', scrap: 'scrapCode',
  item: 'item', price: 'price',
  quantity: 'quantity', qty: 'quantity',
  unit: 'unit',
  'total actual': 'total', total: 'total', totalactual: 'total',
}

// ══════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════
function newRow(): TSDRow {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    date: '', scrapCode: '', item: '', price: '', quantity: '', unit: '', total: 0,
  }
}

function calcTotal(price: string, quantity: string): number {
  const p = parseFloat(price), q = parseFloat(quantity)
  if (isNaN(p) || isNaN(q)) return 0
  return parseFloat((p * q).toFixed(2))
}

function excelSerialToDate(serial: number): string {
  const unixMs = (Math.floor(serial) - 25569) * 86400000
  const d = new Date(unixMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

function toDateInputVal(raw: unknown): string {
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return ''
    return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth()+1).padStart(2,'0')}-${String(raw.getUTCDate()).padStart(2,'0')}`
  }
  if (typeof raw === 'number' && raw > 25569 && raw < 73050) return excelSerialToDate(raw)
  if (typeof raw === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return ''
}

function fmt1(val: string): string {
  const n = parseFloat(val)
  return isNaN(n) ? '' : n.toFixed(1)
}

// ══════════════════════════════════════════════════════
//  File Parsing — ExcelJS (.xlsx/.xls) + PapaParse (.csv)
// ══════════════════════════════════════════════════════

/** แปลง ExcelJS cell value → raw value ที่ใช้ได้ */
function cellToRaw(cellValue: ExcelJS.CellValue): unknown {
  if (cellValue === null || cellValue === undefined) return ''
  if (cellValue instanceof Date) return cellValue
  if (typeof cellValue === 'object') {
    // RichText
    if ('richText' in cellValue) {
      return (cellValue as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
    }
    // Formula result
    if ('result' in cellValue) {
      const r = (cellValue as ExcelJS.CellFormulaValue).result
      return r instanceof Date ? r : r ?? ''
    }
    // Hyperlink
    if ('text' in cellValue) {
      return String((cellValue as ExcelJS.CellHyperlinkValue).text)
    }
  }
  return cellValue
}

async function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  // อ่าน header จาก row แรก
  const headerRow = worksheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellToRaw(cell.value) ?? '').trim()
  })

  const rows: Record<string, unknown>[] = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return // ข้าม header
    const rowData: Record<string, unknown> = {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) rowData[header] = cellToRaw(cell.value)
    })
    // ข้าม row ที่ว่างทั้งหมด
    const hasData = Object.values(rowData).some(v => v !== '' && v !== null && v !== undefined)
    if (hasData) rows.push(rowData)
  })

  return rows
}

async function parseCsvFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    })
  })
}

// ══════════════════════════════════════════════════════
//  Icons
// ══════════════════════════════════════════════════════
const IconX = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)
const IconUpload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)
const IconClearAll = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconUser = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
)

// ══════════════════════════════════════════════════════
//  Toast
// ══════════════════════════════════════════════════════
function ToastContainer({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{ position:'fixed', top:20, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:8, pointerEvents:'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display:'flex', alignItems:'flex-start', gap:10,
          padding:'12px 14px', background:'#fff',
          border:`1px solid ${t.type === 'warn' ? 'rgba(245,166,35,.30)' : 'rgba(239,83,83,.30)'}`,
          borderLeft:`4px solid ${t.type === 'warn' ? '#F5A623' : '#EF5353'}`,
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.13)',
          minWidth:280, maxWidth:420, pointerEvents:'all',
          animation:'toastIn .22s ease', whiteSpace:'pre-line',
        }}>
          <span style={{ color: t.type === 'warn' ? '#F5A623' : '#EF5353', flexShrink:0, marginTop:1 }}><IconAlert /></span>
          <span style={{ flex:1, fontSize:13, fontWeight:600, color: t.type === 'warn' ? '#b45309' : '#dc2626', lineHeight:1.5 }}>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', padding:'2px 4px', borderRadius:4, display:'flex', alignItems:'center' }}>
            <IconX />
          </button>
        </div>
      ))}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(24px);}to{opacity:1;transform:translateX(0);}}`}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  Cell styles
// ══════════════════════════════════════════════════════
const cellInput: React.CSSProperties = {
  width:'100%', border:'1px solid #e5e7eb', borderRadius:6,
  padding:'6px 8px', fontSize:12.5, fontFamily:'inherit',
  color:'#111827', background:'#fff', outline:'none',
}
const cellSelect: React.CSSProperties = {
  ...cellInput, cursor:'pointer', appearance:'none', WebkitAppearance:'none',
  paddingRight:24,
  backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239ca3af' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat:'no-repeat', backgroundPosition:'right 8px center',
}
const thS: React.CSSProperties = {
  padding:'10px 12px', textAlign:'left', fontSize:12, fontWeight:600, color:'#6b7280',
  background:'#f9fafb', borderBottom:'1px solid #f3f4f6',
  position:'sticky', top:0, zIndex:2, whiteSpace:'nowrap',
}
const tdS: React.CSSProperties = {
  padding:'6px 8px', borderTop:'1px solid #f9fafb', verticalAlign:'middle',
}

// ══════════════════════════════════════════════════════
//  Page
// ══════════════════════════════════════════════════════
export default function TSDFormPage() {
  const [shift,         setShift]         = useState<'A'|'B'>('A')

  // ── Fix ①: ใช้ lazy initializer แทน useEffect + setState ──
  const [operatorName] = useState<string>(() => getTokenPayload()?.full_name ?? '')
  const [workNumber]   = useState<string>(() => getTokenPayload()?.sub ?? '')

  const [rows,          setRows]          = useState<TSDRow[]>([newRow()])
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [submitLoading, setSubmitLoading] = useState(false)
  const [showSuccess,   setShowSuccess]   = useState(false)
  const [successCount,  setSuccessCount]  = useState(0)
  const [toasts,        setToasts]        = useState<ToastMsg[]>([])
  const [todayStr,      setTodayStr]      = useState('')

  const toastCounter = useRef(0)
  const toastTimers  = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // ── Fix ③: เก็บ shift string ลงตัวแปรก่อน ไม่ใช้ expression เปล่า ──
    const update = () => {
      const now   = new Date()
      const day   = now.getDate()
      const month = now.toLocaleString('en-US', { month: 'short' })
      const year  = now.getFullYear()
      const hh    = String(now.getHours()).padStart(2, '0')
      const mm    = String(now.getMinutes()).padStart(2, '0')
      const h     = now.getHours() * 60 + now.getMinutes()
      const shiftLabel = h >= 7 * 60 + 30 && h <= 19 * 60 + 50 ? 'Day' : 'Night'
      setTodayStr(`${day} ${month} ${year} ${hh}:${mm} - ${shiftLabel}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Toast ──────────────────────────────────────────
  const showToast = useCallback((message: string, type: ToastMsg['type'] = 'error') => {
    setToasts(prev => {
      const existing = prev.find(t => t.message === message)
      if (existing) {
        const old = toastTimers.current.get(existing.id)
        if (old) clearTimeout(old)
        const nt = setTimeout(() => setToasts(p => p.filter(t => t.id !== existing.id)), 5000)
        toastTimers.current.set(existing.id, nt)
        return prev
      }
      const id = ++toastCounter.current
      toastTimers.current.set(id, setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000))
      return [...prev, { id, message, type }]
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    const t = toastTimers.current.get(id)
    if (t) { clearTimeout(t); toastTimers.current.delete(id) }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Row helpers ────────────────────────────────────
  const updateRow = (id: string, field: keyof TSDRow, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: value }
      updated.total = calcTotal(
        field === 'price'    ? value : r.price,
        field === 'quantity' ? value : r.quantity,
      )
      return updated
    }))
  }

  const addRow         = () => setRows(prev => [...prev, newRow()])
  const clearAll       = () => { setRows([newRow()]); setSelectedIds(new Set()) }
  const toggleSelect   = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  const toggleSelectAll = () =>
    setSelectedIds(selectedIds.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))
  const deleteSelected = () => {
    setRows(prev => { const next = prev.filter(r => !selectedIds.has(r.id)); return next.length === 0 ? [newRow()] : next })
    setSelectedIds(new Set())
  }

  // ── File upload — ExcelJS + PapaParse ─────────────
  const handleFileUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      showToast('รองรับเฉพาะไฟล์ .xlsx, .xls, .csv')
      return
    }

    try {
      let json: Record<string, unknown>[]

      if (ext === 'csv') {
        json = await parseCsvFile(file)
      } else {
        json = await parseExcelFile(file)
      }

      if (json.length === 0) { showToast('ไฟล์ไม่มีข้อมูล'); return }

      const rawHeaders = Object.keys(json[0])
      const colMap: Record<string, keyof TSDRow> = {}
      for (const h of rawHeaders) {
        const key = h.toLowerCase().replace(/\s+/g, ' ').trim()
        if (EXCEL_COL_MAP[key]) colMap[h] = EXCEL_COL_MAP[key]
      }

      const imported: TSDRow[] = json.map(rawRow => {
        const r = newRow()
        for (const [excelCol, field] of Object.entries(colMap)) {
          const val = rawRow[excelCol]
          if (field === 'date')           r.date      = toDateInputVal(val)
          else if (field === 'scrapCode') r.scrapCode = String(val ?? '').trim()
          else if (field === 'item')      r.item      = String(val ?? '').trim()
          else if (field === 'price')     r.price     = isNaN(parseFloat(String(val))) ? '' : String(parseFloat(String(val)))
          else if (field === 'quantity')  r.quantity  = isNaN(parseFloat(String(val))) ? '' : String(parseFloat(String(val)))
          else if (field === 'unit')      {
            const u = String(val ?? '').toUpperCase().trim()
            r.unit = (u === 'EA' || u === 'KG') ? u : ''
          }
        }
        r.total = calcTotal(r.price, r.quantity)
        return r
      })

      setRows(prev => {
        const cleaned = prev.filter(r => r.date || r.scrapCode || r.item || r.price || r.quantity || r.unit)
        return [...cleaned, ...imported]
      })
    } catch (err) {
      console.error(err)
      showToast('ไม่สามารถอ่านไฟล์ได้')
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Submit ────────────────────────────────────────
  const handleSubmit = async () => {
    if (!workNumber) {
      showToast('ไม่พบ work_number กรุณาเข้าสู่ระบบใหม่')
      return
    }

    const validRows = rows.filter(r => r.scrapCode && r.item)
    if (validRows.length === 0) {
      showToast('กรุณากรอก Scrap code และ Item อย่างน้อย 1 แถว')
      return
    }

    setSubmitLoading(true)
    const errors: string[] = []
    let successCnt = 0

    for (const row of validRows) {
      try {
        const body = {
          work_number: workNumber,
          shift:       shift,
          date_day:    row.date || null,
          scrap_code:  row.scrapCode,
          item:        row.item,
          price:       parseFloat(row.price)    || 0,
          quantity:    parseFloat(row.quantity) || 0,
          unit:        row.unit || 'EA',
        }
        const r = await fetch(`${API}/form/tsd`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        })
        if (r.ok) {
          successCnt++
        } else {
          const d = await r.json().catch(() => ({}))
          // ── Fix ②: ใช้ DetailItem แทน any ──
          const detail = typeof d.detail === 'string'
            ? d.detail
            : Array.isArray(d.detail)
              ? d.detail.map((e: DetailItem) => e.msg ?? JSON.stringify(e)).join(', ')
              : `HTTP ${r.status}`
          errors.push(`"${row.item}": ${detail}`)
        }
      } catch {
        errors.push(`"${row.item}": connection error`)
      }
    }

    setSubmitLoading(false)

    if (errors.length > 0 && successCnt === 0) {
      showToast(`บันทึกไม่สำเร็จ:\n${errors.join('\n')}`, 'error')
    } else if (errors.length > 0) {
      showToast(`บันทึกสำเร็จ ${successCnt} รายการ\nล้มเหลว ${errors.length} รายการ:\n${errors.join('\n')}`, 'warn')
      setRows([newRow()])
      setSelectedIds(new Set())
      setSuccessCount(successCnt)
      setShowSuccess(true)
    } else {
      setSuccessCount(successCnt)
      setShowSuccess(true)
      setRows([newRow()])
      setSelectedIds(new Set())
    }
  }

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  // ══════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════
  return (
    <div className="page active dfp-page">

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header bar ── */}
      <div className="dfp-header-bar" style={{ background: 'transparent', borderBottom: 'none', paddingBottom: 0 }}>
        <div className="dfp-header-left">
          <h1 className="dfp-title">TSD-Defect Expense</h1>
          <span className="dfp-breadcrumb">Recorded form &gt; TSD-Defect expense</span>
        </div>
        <button className="dfp-submit-btn" onClick={handleSubmit} disabled={submitLoading}>
          <SquareCheckBig size={16} />
          {submitLoading ? 'Saving…' : 'Submit'}
        </button>
      </div>

      <div className="dfp-body">

        {/* ══ Info card ══ */}
        <div className="dfp-card dfp-info-card">

          <div className="dfp-info-field">
            <label className="dfp-info-label">Operator Name</label>
            <div className="dfp-select-wrap">
              <span className="dfp-input-icon"><IconUser /></span>
              <span style={{
                flex: 1, padding: '8px 0', fontSize: 13,
                fontFamily: 'inherit',
                color: operatorName ? '#111827' : '#9ca3af',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {operatorName || 'ไม่พบข้อมูล — กรุณา Login ใหม่'}
              </span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>

          <div className="dfp-info-field">
            <label className="dfp-info-label">Shift</label>
            <div className="dfp-shift-toggle">
              {(['A', 'B'] as const).map(s => (
                <button key={s} type="button" className={`dfp-shift-btn${shift === s ? ' active' : ''}`} onClick={() => setShift(s)}>
                  <span className="dfp-shift-dot" />{s}
                </button>
              ))}
            </div>
          </div>

          <div className="dfp-info-field" style={{ alignItems: 'flex-end' }}>
            <label className="dfp-info-label">Date (Real time)</label>
            <div className="dfp-date-display">{todayStr}</div>
          </div>

        </div>

        {/* ══ Table card ══ */}
        <div className="dfp-card dfp-table-card" style={{ flex: 749 }}>

          <div className="dfp-table-header">
            <div className="dfp-step-label">
              <span className="dfp-step-num">1.</span>
              Enter TSD-Defect Expense
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'#1462FF', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}
              >
                <IconUpload /> Upload Excel
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display:'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
              />

              <button
                onClick={clearAll}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
              >
                <IconClearAll /> Clear All
              </button>

              <button
                className={`dfp-delete-btn${selectedIds.size === 0 ? ' disabled' : ''}`}
                onClick={deleteSelected}
                disabled={selectedIds.size === 0}
                title="Delete selected rows"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{
            flex:1, minHeight:0, overflowX:'auto',
            overflowY: rows.length > MAX_VISIBLE_ROWS ? 'auto' : 'hidden',
            maxHeight: rows.length > MAX_VISIBLE_ROWS ? `${MAX_VISIBLE_ROWS * 44 + 42}px` : 'none',
            scrollbarWidth:'thin', scrollbarColor:'rgba(20,98,255,.2) transparent',
          }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5, whiteSpace:'nowrap' }}>
              <thead>
                <tr>
                  <th style={thS}>
                    <input type="checkbox" style={{ width:14, height:14, accentColor:'#1462FF', cursor:'pointer' }}
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onChange={toggleSelectAll} />
                  </th>
                  {['Date','Scrap code','Item','Price','Quantity','Unit','Total Actual'].map(h => (
                    <th key={h} style={thS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} style={{ background: selectedIds.has(row.id) ? '#eef3ff' : 'transparent' }}>
                    <td style={tdS}>
                      <input type="checkbox" style={{ width:14, height:14, accentColor:'#1462FF', cursor:'pointer' }}
                        checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} />
                    </td>
                    <td style={{ ...tdS, minWidth:140 }}>
                      <input type="date" style={{ ...cellInput, paddingRight:28, minWidth:130 }}
                        value={row.date} onChange={e => updateRow(row.id, 'date', e.target.value)} />
                    </td>
                    <td style={{ ...tdS, minWidth:110 }}>
                      <select style={cellSelect} value={row.scrapCode} onChange={e => updateRow(row.id, 'scrapCode', e.target.value)}>
                        <option value=""></option>
                        {SCRAP_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdS, minWidth:160 }}>
                      <input style={cellInput} type="text" placeholder="Scan or type item"
                        value={row.item} onChange={e => updateRow(row.id, 'item', e.target.value)} />
                    </td>
                    <td style={{ ...tdS, minWidth:90 }}>
                      <input style={{ ...cellInput, textAlign:'right' }} type="number" min="0" step="0.1" placeholder="0.0"
                        value={row.price}
                        onChange={e => updateRow(row.id, 'price', e.target.value)}
                        onBlur={e => updateRow(row.id, 'price', fmt1(e.target.value))} />
                    </td>
                    <td style={{ ...tdS, minWidth:90 }}>
                      <input style={{ ...cellInput, textAlign:'right' }} type="number" min="0"
                        step={row.unit === 'EA' ? '1' : '0.1'} placeholder="0.0"
                        value={row.quantity}
                        onChange={e => updateRow(row.id, 'quantity', e.target.value)}
                        onBlur={e => updateRow(row.id, 'quantity', row.unit === 'EA' ? String(Math.round(parseFloat(e.target.value)) || '') : fmt1(e.target.value))} />
                    </td>
                    <td style={{ ...tdS, minWidth:80 }}>
                      <select style={cellSelect} value={row.unit} onChange={e => updateRow(row.id, 'unit', e.target.value)}>
                        <option value=""></option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdS, minWidth:110, textAlign:'right', fontWeight:600, color: row.total > 0 ? '#111827' : '#d1d5db', paddingRight:16 }}>
                      {row.total > 0 ? row.total.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px 12px', borderTop:'1px solid #f3f4f6', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <button onClick={addRow} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', background:'rgba(20,98,255,.07)', border:'1px solid rgba(20,98,255,.25)', borderRadius:8, color:'#1462FF', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'background .15s' }}>
                + Add Row
              </button>
              <span style={{ fontSize:13, color:'#9ca3af', fontWeight:500 }}>
                Total {rows.length} {rows.length === 1 ? 'Row' : 'Rows'}
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
              <span style={{ fontSize:13, color:'#6b7280', fontWeight:500 }}>Total Actual (THB)</span>
              <span style={{ fontSize:18, fontWeight:800, color:'#1462FF', letterSpacing:'-0.5px' }}>
                {grandTotal.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Success overlay ── */}
      {showSuccess && (
        <div className="dfp-overlay">
          <div className="dfp-success-box">
            <div className="dfp-success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1462FF" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="dfp-success-title">บันทึกข้อมูลสำเร็จ</div>
            <div className="dfp-success-sub">บันทึก TSD-Defect Expense {successCount} รายการเรียบร้อยแล้ว</div>
            <button className="dfp-success-ok" onClick={() => setShowSuccess(false)}>OK</button>
          </div>
        </div>
      )}

    </div>
  )
}