'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SquareCheckBig, FilePlusCorner } from 'lucide-react'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { API, getTokenPayload, authHeaders } from '../../shared'

// ══════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════
interface UploadedFile {
  id:      string
  name:    string
  size:    number
  rows:    Record<string, unknown>[]
  headers: string[]
}
interface ToastMsg {
  id:      number
  message: string
  type:    'error' | 'warn' | 'info'
}

// ══════════════════════════════════════════════════════
//  Column mapping — header names → FormVolumeBody fields
// ══════════════════════════════════════════════════════
const COL_MAP: Record<string, string> = {
  'model':           'model_name',
  'model name':      'model_name',
  'model_name':      'model_name',
  'modelname':       'model_name',
  'line':            'line',
  'line no':         'line',
  'line no.':        'line',
  'lineno':          'line',
  'quantity':        'quantity',
  'qty':             'quantity',
  'จำนวน':           'quantity',
  'shift':           'shift',
  'production date': 'production_date',
  'prod date':       'production_date',
  'prod_date':       'production_date',
  'productiondate':  'production_date',
  'วันผลิต':          'production_date',
  'production time': 'production_time',
  'prod time':       'production_time',
  'prod_time':       'production_time',
  'productiontime':  'production_time',
  'เวลาผลิต':         'production_time',
  'part no':         'part_no',
  'part no.':        'part_no',
  'part_no':         'part_no',
  'partno':          'part_no',
  'core no':         'core_no',
  'core no.':        'core_no',
  'core_no':         'core_no',
  'coreno':          'core_no',
  'work tag':        'work_tag',
  'work_tag':        'work_tag',
  'worktag':         'work_tag',
  'group':           'group',
  'name':            'name',
  'operator':        'name',
  'operator name':   'name',
}

function normalizeKey(h: string): string {
  return h.toLowerCase().replace(/\s+/g, ' ').trim()
}

function mapHeaders(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const h of headers) {
    const mapped = COL_MAP[normalizeKey(h)]
    if (mapped) result[h] = mapped
  }
  return result
}

// ══════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function excelSerialToDateStr(serial: number): string {
  const unixMs = (Math.floor(serial) - 25569) * 86400000
  const d = new Date(unixMs)
  return `${String(d.getUTCDate()).padStart(2,'0')}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${d.getUTCFullYear()}`
}
function excelSerialToTimeStr(serial: number): string {
  const totalSec = Math.round(serial * 86400)
  return `${String(Math.floor(totalSec/3600)).padStart(2,'0')}:${String(Math.floor((totalSec%3600)/60)).padStart(2,'0')}:${String(totalSec%60).padStart(2,'0')}`
}
function looksLikeDateSerial(v: number) { const n = Math.floor(v); return n >= 32874 && n <= 73050 }
function colIsTime(h: string) { const l = h.toLowerCase(); return ['time','เวลา','tm','hour'].some(k=>l.includes(k)) && !['date','วัน','dt'].some(k=>l.includes(k)) }
function colIsDate(h: string) { return ['date','วัน','dt'].some(k=>h.toLowerCase().includes(k)) }

function formatCell(header: string, value: unknown): string {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return ''
    const dd=String(value.getDate()).padStart(2,'0'), mm=String(value.getMonth()+1).padStart(2,'0'), yyyy=value.getFullYear()
    if (colIsTime(header)) return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}:${String(value.getSeconds()).padStart(2,'0')}`
    return `${dd}-${mm}-${yyyy}`
  }
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return excelSerialToTimeStr(value)
    if (looksLikeDateSerial(value)) {
      const datePart = Math.floor(value), timePart = value - datePart
      if (colIsTime(header)) return excelSerialToTimeStr(timePart)
      if (colIsDate(header))  return excelSerialToDateStr(datePart)
      if (timePart < 1e-9) return excelSerialToDateStr(datePart)
      return `${excelSerialToDateStr(datePart)} ${excelSerialToTimeStr(timePart)}`
    }
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        const dd=String(d.getUTCDate()).padStart(2,'0'), mm=String(d.getUTCMonth()+1).padStart(2,'0'), yyyy=d.getUTCFullYear()
        if (colIsTime(header)) return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}`
        return `${dd}-${mm}-${yyyy}`
      }
    } catch { /* ignore */ }
  }
  return String(value ?? '')
}

// ══════════════════════════════════════════════════════
//  File Parsing — ExcelJS + PapaParse
// ══════════════════════════════════════════════════════
function cellToRaw(cellValue: ExcelJS.CellValue): unknown {
  if (cellValue === null || cellValue === undefined) return ''
  if (cellValue instanceof Date) return cellValue
  if (typeof cellValue === 'object') {
    if ('richText' in cellValue) {
      return (cellValue as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
    }
    if ('result' in cellValue) {
      const r = (cellValue as ExcelJS.CellFormulaValue).result
      return r instanceof Date ? r : r ?? ''
    }
    if ('text' in cellValue) {
      return String((cellValue as ExcelJS.CellHyperlinkValue).text)
    }
  }
  return cellValue
}

async function parseExcelFile(file: File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) return { rows: [], headers: [] }

  const headerRow = worksheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellToRaw(cell.value) ?? '').trim()
  })

  const rows: Record<string, unknown>[] = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const rowData: Record<string, unknown> = {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) rowData[header] = cellToRaw(cell.value)
    })
    const hasData = Object.values(rowData).some(v => v !== '' && v !== null && v !== undefined)
    if (hasData) rows.push(rowData)
  })

  return { rows, headers: headers.filter(Boolean) }
}

async function parseCsvFile(file: File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        resolve({ rows: results.data, headers })
      },
      error: (err) => reject(err),
    })
  })
}

async function parseFile(file: File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'csv') return parseCsvFile(file)
  return parseExcelFile(file)
}

// ══════════════════════════════════════════════════════
//  Icons
// ══════════════════════════════════════════════════════
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconFileSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
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
      {toasts.map(t => {
        const isWarn = t.type === 'warn'
        const isInfo = t.type === 'info'
        const borderColor = isWarn ? 'rgba(245,166,35,.30)' : isInfo ? 'rgba(109,184,232,.30)' : 'rgba(239,83,83,.30)'
        const accentColor = isWarn ? '#F5A623' : isInfo ? '#6DB8E8' : '#EF5353'
        const textColor   = isWarn ? '#b45309' : isInfo ? '#0369a1' : '#dc2626'
        return (
          <div key={t.id} style={{
            display:'flex', alignItems:'flex-start', gap:10,
            padding:'12px 14px', background:'#fff',
            border:`1px solid ${borderColor}`, borderLeft:`4px solid ${accentColor}`,
            borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.13)',
            minWidth:280, maxWidth:420, pointerEvents:'all',
            animation:'toastIn .22s ease', whiteSpace:'pre-line',
          }}>
            <span style={{ color:accentColor, flexShrink:0, marginTop:1 }}><IconAlert /></span>
            <span style={{ flex:1, fontSize:13, fontWeight:600, color:textColor, lineHeight:1.5 }}>{t.message}</span>
            <button onClick={() => onDismiss(t.id)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', padding:'2px 4px', borderRadius:4, display:'flex', alignItems:'center' }}>
              <IconX />
            </button>
          </div>
        )
      })}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(24px);}to{opacity:1;transform:translateX(0);}}`}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  Submit Progress Bar
// ══════════════════════════════════════════════════════
function SubmitProgress({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'32px 40px', textAlign:'center', minWidth:300, boxShadow:'0 8px 40px rgba(0,0,0,.15)' }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:6, color:'#111827' }}>กำลังบันทึกข้อมูล…</div>
        <div style={{ fontSize:13, color:'#9ca3af', marginBottom:20 }}>{current} / {total} rows</div>
        <div style={{ height:8, background:'#f0f0f0', borderRadius:99, overflow:'hidden', marginBottom:10 }}>
          <div style={{ height:'100%', borderRadius:99, background:'#1462FF', width:`${pct}%`, transition:'width .2s ease' }} />
        </div>
        <div style={{ fontSize:12, color:'#6b7280' }}>{pct}%</div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  Column mapping warning badge
// ══════════════════════════════════════════════════════
function MappingBadge({ headers, headerMap }: { headers: string[]; headerMap: Record<string,string> }) {
  const mapped   = Object.keys(headerMap)
  const unmapped = headers.filter(h => !mapped.includes(h))
  const required = ['model_name', 'line', 'quantity', 'shift', 'production_date']
  const mappedFields = Object.values(headerMap)
  const missingRequired = required.filter(f => !mappedFields.includes(f))

  if (missingRequired.length === 0 && unmapped.length === 0) return null

  return (
    <div style={{
      margin:'0 20px 12px',
      background: missingRequired.length > 0 ? '#FEF3C7' : '#EFF6FF',
      border:`1px solid ${missingRequired.length > 0 ? '#FCD34D' : '#BFDBFE'}`,
      borderRadius:8, padding:'10px 14px', fontSize:12,
    }}>
      {missingRequired.length > 0 && (
        <div style={{ color:'#92400E', fontWeight:600, marginBottom:4 }}>
          ⚠ Column ที่ต้องมีแต่ยังไม่พบ: <span style={{ fontFamily:'monospace' }}>{missingRequired.join(', ')}</span>
        </div>
      )}
      {unmapped.length > 0 && (
        <div style={{ color:'#1e40af' }}>
          Column ที่ไม่รู้จัก (จะถูกข้าม): <span style={{ fontFamily:'monospace' }}>{unmapped.join(', ')}</span>
        </div>
      )}
      <div style={{ color:'#6b7280', marginTop:4 }}>
        Column ที่ map ได้: <span style={{ color:'#059669', fontWeight:600 }}>{mapped.join(', ') || '-'}</span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  Lazy initializer — อ่าน token ครั้งเดียวตอน mount
// ══════════════════════════════════════════════════════
function initOperatorName(): string {
  const payload = getTokenPayload()
  return payload?.full_name ?? ''
}

// ══════════════════════════════════════════════════════
//  Page
// ══════════════════════════════════════════════════════
export default function VolumeFormPage() {
  const [shift,          setShift]          = useState<'A'|'B'>('A')
  const [operatorName]                      = useState<string>(initOperatorName)
  const [uploadedFile,   setUploadedFile]   = useState<UploadedFile | null>(null)
  const [dragging,       setDragging]       = useState(false)
  const [parsing,        setParsing]        = useState(false)
  const [submitLoading,  setSubmitLoading]  = useState(false)
  const [submitProgress, setSubmitProgress] = useState({ current: 0, total: 0 })
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set())
  const [showSuccess,    setShowSuccess]    = useState(false)
  const [successCount,   setSuccessCount]   = useState(0)
  const [toasts,         setToasts]         = useState<ToastMsg[]>([])
  const [todayStr,       setTodayStr]       = useState('')
  const [headerMap,      setHeaderMap]      = useState<Record<string,string>>({})

  const toastCounter = useRef(0)
  const toastTimers  = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const update = () => {
      const now        = new Date()
      const day        = now.getDate()
      const month      = now.toLocaleString('en-US', { month: 'short' })
      const year       = now.getFullYear()
      const hh         = String(now.getHours()).padStart(2, '0')
      const mm         = String(now.getMinutes()).padStart(2, '0')
      const h          = now.getHours() * 60 + now.getMinutes()
      const shiftLabel = h >= 7 * 60 + 30 && h <= 19 * 60 + 50 ? 'Day' : 'Night'
      setTodayStr(`${day} ${month} ${year} ${hh}:${mm} - ${shiftLabel}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Toast ──
  const showToast = useCallback((message: string, type: ToastMsg['type'] = 'error') => {
    setToasts(prev => {
      const existing = prev.find(t => t.message === message)
      if (existing) {
        const old = toastTimers.current.get(existing.id)
        if (old) clearTimeout(old)
        const nt = setTimeout(() => setToasts(p => p.filter(t => t.id !== existing.id)), 6000)
        toastTimers.current.set(existing.id, nt)
        return prev
      }
      const id = ++toastCounter.current
      toastTimers.current.set(id, setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 6000))
      return [...prev, { id, message, type }]
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    const t = toastTimers.current.get(id)
    if (t) { clearTimeout(t); toastTimers.current.delete(id) }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── File handling ──
  const handleFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      showToast('รองรับเฉพาะไฟล์ .xlsx, .xls, .csv เท่านั้น')
      return
    }
    setParsing(true)
    try {
      const { rows, headers } = await parseFile(file)
      if (rows.length === 0) { showToast('ไฟล์ไม่มีข้อมูล'); return }
      const hMap = mapHeaders(headers)
      setHeaderMap(hMap)
      setUploadedFile({ id:`${Date.now()}`, name:file.name, size:file.size, rows, headers })
      setSelectedIds(new Set())

      const required = ['model_name', 'line', 'quantity', 'shift', 'production_date']
      const mappedFields = Object.values(hMap)
      const missing = required.filter(f => !mappedFields.includes(f))
      if (missing.length > 0) {
        showToast(`ไม่พบ column: ${missing.join(', ')}\nกรุณาตรวจสอบชื่อ column ในไฟล์`, 'warn')
      } else {
        showToast(`โหลดสำเร็จ ${rows.length} rows — พบ column ครบถ้วน`, 'info')
      }
    } catch (err) {
      console.error(err)
      showToast('ไม่สามารถอ่านไฟล์ได้')
    } finally {
      setParsing(false)
    }
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const removeFile = () => { setUploadedFile(null); setSelectedIds(new Set()); setHeaderMap({}) }

  // ── Row selection ──
  // ── Fix: เปลี่ยน ternary expression เป็น if/else statement ──
  const toggleSelect = (idx: number) =>
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(idx)) {
        n.delete(idx)
      } else {
        n.add(idx)
      }
      return n
    })

  const toggleSelectAll = () => {
    if (!uploadedFile) return
    setSelectedIds(selectedIds.size === uploadedFile.rows.length
      ? new Set()
      : new Set(uploadedFile.rows.map((_, i) => i)))
  }

  const deleteSelected = () => {
    if (!uploadedFile) return
    const newRows = uploadedFile.rows.filter((_, i) => !selectedIds.has(i))
    if (newRows.length === 0) { setUploadedFile(null); setSelectedIds(new Set()); setHeaderMap({}); return }
    setUploadedFile({ ...uploadedFile, rows: newRows })
    setSelectedIds(new Set())
  }

  // ── Build body จาก row ──
  function buildBody(row: Record<string,unknown>): Record<string,unknown> {
    const body: Record<string,unknown> = {
      name:             operatorName || '',
      shift:            shift,
      line:             '',
      part_no:          '',
      core_no:          '',
      model_name:       '',
      production_date:  '',
      production_time:  '',
      work_tag:         '',
      group:            '',
      quantity:         0,
      ph_top:           '',
      die_list_ph_top:  '',
      ph_btm:           '',
      die_list_ph_btm:  '',
      th_top:           '',
      th_btm:           '',
      date_day:         new Date().toISOString().slice(0,10),
      time:             new Date().toISOString(),
    }

    for (const [excelCol, fieldName] of Object.entries(headerMap)) {
      const raw = row[excelCol]
      if (fieldName === 'quantity') {
        body['quantity'] = parseInt(String(raw ?? '0'), 10) || 0
      } else if (fieldName === 'shift') {
        const s = formatCell(excelCol, raw).trim().toUpperCase()
        body['shift'] = s.startsWith('A') ? 'A' : s.startsWith('B') ? 'B' : shift
      } else {
        body[fieldName] = formatCell(excelCol, raw)
      }
    }

    return body
  }

  // ── Submit ──
  const handleSubmit = async () => {
    if (!operatorName) { showToast('ไม่พบชื่อ Operator กรุณาเข้าสู่ระบบใหม่'); return }
    if (!uploadedFile) { showToast('กรุณาอัพโหลดไฟล์ก่อน'); return }
    if (uploadedFile.rows.length === 0) { showToast('ไม่มีข้อมูลในไฟล์'); return }

    const required = ['model_name', 'line', 'quantity', 'shift', 'production_date']
    const mappedFields = Object.values(headerMap)
    const missing = required.filter(f => !mappedFields.includes(f))
    if (missing.length > 0) {
      showToast(`ไม่พบ column ที่จำเป็น: ${missing.join(', ')}\nกรุณาตรวจสอบชื่อ column ในไฟล์`, 'error')
      return
    }

    const rowsToSubmit = uploadedFile.rows
    setSubmitLoading(true)
    setSubmitProgress({ current: 0, total: rowsToSubmit.length })

    let successCnt  = 0
    const errors: string[] = []

    for (let i = 0; i < rowsToSubmit.length; i++) {
      const body = buildBody(rowsToSubmit[i])
      try {
        const r = await fetch(`${API}/form/volume`, {
          method:  'POST',
          headers: authHeaders(),
          body:    JSON.stringify(body),
        })
        if (r.ok) {
          successCnt++
        } else {
          const d = await r.json().catch(() => ({})) as { detail?: string }
          errors.push(`Row ${i+1}: ${d.detail ?? `HTTP ${r.status}`}`)
        }
      } catch {
        errors.push(`Row ${i+1}: connection error`)
      }
      setSubmitProgress({ current: i + 1, total: rowsToSubmit.length })
    }

    setSubmitLoading(false)

    if (errors.length > 0 && successCnt === 0) {
      showToast(`บันทึกไม่สำเร็จ:\n${errors.slice(0,5).join('\n')}${errors.length>5?`\n…และอีก ${errors.length-5} รายการ`:''}`, 'error')
    } else if (errors.length > 0) {
      showToast(`บันทึกสำเร็จ ${successCnt} rows\nล้มเหลว ${errors.length} rows:\n${errors.slice(0,3).join('\n')}`, 'warn')
      setSuccessCount(successCnt)
      setShowSuccess(true)
      setUploadedFile(null); setSelectedIds(new Set()); setHeaderMap({})
    } else {
      setSuccessCount(successCnt)
      setShowSuccess(true)
      setUploadedFile(null); setSelectedIds(new Set()); setHeaderMap({})
    }
  }

  // ══════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════
  return (
    <div className="page active dfp-page">

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {submitLoading && <SubmitProgress current={submitProgress.current} total={submitProgress.total} />}

      {/* ── Header bar ── */}
      <div className="dfp-header-bar" style={{ background: 'transparent', borderBottom: 'none', paddingBottom: 0 }}>
        <div className="dfp-header-left">
          <h1 className="dfp-title">Volume Form</h1>
          <span className="dfp-breadcrumb">Recorded form &gt; Volume Form</span>
        </div>
        <button className="dfp-submit-btn" onClick={handleSubmit} disabled={submitLoading || !uploadedFile}>
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
                flex:1, padding:'8px 0', fontSize:13, fontFamily:'inherit',
                color: operatorName ? '#111827' : '#9ca3af',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>
                {operatorName || 'ไม่พบข้อมูล — กรุณา Login ใหม่'}
              </span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>

          <div className="dfp-info-field">
            <label className="dfp-info-label">Default Shift <span style={{ fontSize:10, color:'#9ca3af', fontWeight:400 }}>(ถ้าไม่มีใน file)</span></label>
            <div className="dfp-shift-toggle">
              {(['A', 'B'] as const).map(s => (
                <button key={s} type="button" className={`dfp-shift-btn${shift === s ? ' active' : ''}`} onClick={() => setShift(s)}>
                  <span className="dfp-shift-dot" />{s}
                </button>
              ))}
            </div>
          </div>

          <div className="dfp-info-field" style={{ alignItems:'flex-end' }}>
            <label className="dfp-info-label">Date (Real time)</label>
            <div className="dfp-date-display">{todayStr}</div>
          </div>

        </div>

        {/* ══ Upload card ══ */}
        <div className="dfp-card dfp-table-card" style={{ flex:749 }}>

          <div className="dfp-table-header">
            <div className="dfp-step-label">
              <span className="dfp-step-num">1.</span>
              Upload Volume File
              <span style={{ fontSize:11.5, fontWeight:400, color:'#9ca3af' }}>(.xlsx / .xls / .csv)</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {uploadedFile && (
                <span style={{ fontSize:11, color:'#6b7280' }}>
                  {uploadedFile.rows.length} rows
                  {selectedIds.size > 0 && <span style={{ color:'#1462FF', marginLeft:6 }}>· {selectedIds.size} selected</span>}
                </span>
              )}
              <button className={`dfp-delete-btn${!uploadedFile ? ' disabled' : ''}`} onClick={removeFile} disabled={!uploadedFile} title="Delete file">
                <IconTrash />
              </button>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={onInputChange} />

          {uploadedFile && <MappingBadge headers={uploadedFile.headers} headerMap={headerMap} />}

          {/* Drop zone */}
          {!uploadedFile && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex:1, margin:'0 20px 20px',
                border:`2px dashed ${dragging ? '#1462FF' : '#91bdff'}`,
                borderRadius:12,
                background: dragging ? 'rgba(20,98,255,.04)' : '#fafafa',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                gap:12, cursor:'pointer', transition:'border-color .15s, background .15s',
              }}
            >
              <div style={{
                width:64, height:64,
                background: dragging ? 'rgba(20,98,255,.12)' : 'rgba(20,98,255,.07)',
                borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                color:'#1462FF', transition:'background .15s',
              }}>
                <FilePlusCorner size={50} />
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#1462FF' }}>
                  {parsing ? 'Reading file…' : 'Click here to upload file'}
                </div>
                <div style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>
                  or drag &amp; drop .xlsx / .xls / .csv
                </div>
              </div>
              <div style={{ fontSize:11, color:'#bbb', textAlign:'center', padding:'0 24px' }}>
                Column ที่รองรับ: <span style={{ fontFamily:'monospace', color:'#9ca3af' }}>Model, Line, Quantity, Shift, Production Date, Production Time, Part No, Core No, …</span>
              </div>
            </div>
          )}

          {/* Table after upload */}
          {uploadedFile && (
            <>
              <div style={{
                display:'flex', alignItems:'center', gap:10, padding:'8px 20px',
                background:'rgba(20,98,255,.04)', borderBottom:'1px solid #f0f5ff', flexShrink:0,
              }}>
                <div style={{ width:32, height:32, background:'rgba(20,98,255,.10)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#1462FF', flexShrink:0 }}>
                  <IconFileSmall />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {uploadedFile.name}
                  </div>
                  <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>
                    {uploadedFile.rows.length} rows · {formatBytes(uploadedFile.size)}
                    {selectedIds.size > 0 && <span style={{ color:'#1462FF', marginLeft:8 }}>· {selectedIds.size} selected</span>}
                  </div>
                </div>
                <button
                  onClick={deleteSelected}
                  disabled={selectedIds.size === 0}
                  style={{
                    display:'flex', alignItems:'center', gap:5, padding:'5px 12px',
                    background: selectedIds.size === 0 ? 'transparent' : 'rgba(239,83,83,.08)',
                    border:`1px solid ${selectedIds.size === 0 ? '#e5e7eb' : 'rgba(239,83,83,.30)'}`,
                    borderRadius:8, color: selectedIds.size === 0 ? '#d1d5db' : '#EF5353',
                    fontSize:12, fontWeight:700, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                    fontFamily:'inherit', transition:'all .12s', flexShrink:0,
                  }}
                >
                  <IconX />
                  Remove{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </button>
              </div>

              <div className="dfp-table-wrap">
                <table className="dfp-table">
                  <thead>
                    <tr>
                      <th className="dfp-th dfp-th-check">
                        <input type="checkbox" className="dfp-checkbox"
                          checked={uploadedFile.rows.length > 0 && selectedIds.size === uploadedFile.rows.length}
                          onChange={toggleSelectAll} />
                      </th>
                      <th className="dfp-th" style={{ color:'#9ca3af', width:52 }}>#</th>
                      {uploadedFile.headers.map(h => (
                        <th key={h} className="dfp-th">
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            {h}
                            {headerMap[h] && (
                              <span style={{ fontSize:9, background:'#d1fae5', color:'#065f46', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>
                                ✓ {headerMap[h]}
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadedFile.rows.map((row, idx) => (
                      <tr key={idx} className={selectedIds.has(idx) ? 'dfp-row-selected' : ''}>
                        <td className="dfp-td dfp-td-check">
                          <input type="checkbox" className="dfp-checkbox" checked={selectedIds.has(idx)} onChange={() => toggleSelect(idx)} />
                        </td>
                        <td className="dfp-td" style={{ color:'#9ca3af', fontSize:11.5 }}>{idx + 1}</td>
                        {uploadedFile.headers.map(h => (
                          <td key={h} className="dfp-td" style={{ maxWidth:200, overflow:'hidden', textOverflow:'ellipsis' }}>
                            {formatCell(h, row[h])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
            <div className="dfp-success-sub">บันทึก Volume Form {successCount} rows เรียบร้อยแล้ว</div>
            <button className="dfp-success-ok" onClick={() => setShowSuccess(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}