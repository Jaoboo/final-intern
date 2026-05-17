'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { SquareCheckBig } from 'lucide-react'

const API = 'http://localhost:8000'

// ══════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════
interface QRData {
  line?: string
  part_no?: string
  core_no?: string
  model?: string
  date?: string
  time?: string
  work_tag?: string
  ph_top?: string
  die_list_ph_top?: string
  ph_btm?: string
  die_list_ph_btm?: string
  th_top?: string
  th_btm?: string
  [key: string]: any
}

interface QREntry {
  raw: string
  data: QRData
}

interface DefectInfo {
  defect_item: string
  defect_mode: string
  defect_code: string
  defect_by_process: string
  defect_type: string
}

interface DefectRow {
  id: string
  qrEntry: QREntry
  defectInfo: DefectInfo
  defectRaw: string
}

interface ToastMsg {
  id: number
  message: string
  type: 'error' | 'warn' | 'info'
}

// ══════════════════════════════════════════════════════
//  Helper: decode JWT payload (no library needed)
// ══════════════════════════════════════════════════════
function getTokenPayload(): { full_name?: string; role?: string; department?: string } | null {
  try {
    const token = document.cookie
      .split('; ')
      .find(r => r.startsWith('access_token='))
      ?.split('=')[1]
    if (!token) return null
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

function getToken() {
  return document.cookie
    .split('; ')
    .find(r => r.startsWith('access_token='))
    ?.split('=')[1] ?? ''
}

// ══════════════════════════════════════════════════════
//  Icons
// ══════════════════════════════════════════════════════
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconQR = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="5" height="5" rx="1" /><rect x="16" y="3" width="5" height="5" rx="1" />
    <rect x="3" y="16" width="5" height="5" rx="1" />
    <path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" />
    <path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" />
    <path d="M16 12h1" /><path d="M21 12v.01" />
  </svg>
)
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)
const IconUser = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
)

// ══════════════════════════════════════════════════════
//  Toast Component
// ══════════════════════════════════════════════════════
function ToastContainer({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', top: 20, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 14px', background: '#fff',
          border: '1px solid rgba(239,83,83,.30)', borderLeft: '4px solid #EF5353',
          borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.13)',
          minWidth: 280, maxWidth: 420, pointerEvents: 'all',
          animation: 'toastIn .22s ease', whiteSpace: 'pre-line',
        }}>
          <span style={{ color: '#EF5353', flexShrink: 0, marginTop: 1 }}><IconAlert /></span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#dc2626', lineHeight: 1.5 }}>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{
            background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer',
            padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center',
            flexShrink: 0, marginLeft: 4,
          }}><IconX /></button>
        </div>
      ))}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  )
}

// ══════════════════════════════════════════════════════
//  Main Page
// ══════════════════════════════════════════════════════
export default function DefectFormPage() {

  // ── Operator from JWT ──────────────────────────────
  const [operatorName, setOperatorName] = useState('')

  useEffect(() => {
    const payload = getTokenPayload()
    if (payload?.full_name) {
      setOperatorName(payload.full_name)
    }
  }, [])

  // ── Header state ───────────────────────────────────
  const [shift, setShift] = useState<'A' | 'B'>('A')
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const day = now.getDate()
      const month = now.toLocaleString('en-US', { month: 'short' })
      const year = now.getFullYear()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      const h = now.getHours() * 60 + now.getMinutes()
      const shift = h >= 7 * 60 + 30 && h <= 19 * 60 + 50 ? 'Day' : 'Night'
      setTodayStr(`${day} ${month} ${year} ${hh}:${mm} - ${shift}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Step 1: Side-Plate QR ──────────────────────────
  const [qrInput, setQrInput] = useState('')
  const [qrList, setQrList] = useState<QREntry[]>([])
  const [qrLoading, setQrLoading] = useState(false)
  const qrInputRef = useRef<HTMLInputElement>(null)

  // ── Step 2: Defect item ────────────────────────────
  const [defectInput, setDefectInput] = useState('')
  const [defectInfo, setDefectInfo] = useState<DefectInfo | null>(null)
  const [defectLoading, setDefectLoading] = useState(false)
  const defectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const defectInputRef = useRef<HTMLInputElement>(null)

  // ── Step 3: Table rows ─────────────────────────────
  const [rows, setRows] = useState<DefectRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Submit state ───────────────────────────────────
  const [submitLoading, setSubmitLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  // ── Toast ──────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const toastCounter = useRef(0)
  const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const showToast = useCallback((message: string, type: ToastMsg['type'] = 'error') => {
    setToasts(prev => {
      const existing = prev.find(t => t.message === message)
      if (existing) {
        const old = toastTimers.current.get(existing.id)
        if (old) clearTimeout(old)
        const timer = setTimeout(() => setToasts(p => p.filter(t => t.id !== existing.id)), 5000)
        toastTimers.current.set(existing.id, timer)
        return prev
      }
      const id = ++toastCounter.current
      const timer = setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000)
      toastTimers.current.set(id, timer)
      return [...prev, { id, message, type }]
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id)
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id) }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── Counters ───────────────────────────────────────
  const totalScanned = new Set(rows.map(r => r.qrEntry.raw)).size
  const uniqueDefectItems = new Set(rows.map(r => r.defectInfo.defect_item)).size
  const defectItemLabel = uniqueDefectItems <= 1 ? 'item' : 'items'
  const totalScannedLabel = totalScanned <= 1 ? 'item' : 'items'

  // ══ Step 1: QR scan ═══════════════════════════════
  const handleQRScan = async () => {
    const val = qrInput.trim()
    if (!val) return
    if (qrList.some(e => e.raw === val)) {
      showToast('QR นี้ถูกเพิ่มในชุดนี้แล้ว')
      setQrInput('')
      return
    }
    setQrLoading(true)
    try {
      const r = await fetch(`${API}/lookup/qr/${val}`)
      const d = await r.json()
      if (!r.ok) {
        showToast(d.detail || 'QR ไม่ถูกต้อง')
      } else {
        const newEntry: QREntry = { raw: val, data: d as QRData }
        const newList = [...qrList, newEntry]
        setQrList(newList)
        setQrInput('')
        qrInputRef.current?.focus()
        if (defectInfo) commitBatchToTableWith(newList, defectInfo, defectInput)
      }
    } catch {
      showToast('เชื่อมต่อ API ไม่ได้')
    } finally {
      setQrLoading(false)
    }
  }

  const handleQrChange = (val: string) => {
    setQrInput(val)
    if (val.length === 32) setTimeout(() => handleQRScanDirect(val), 50)
  }

  const handleQRScanDirect = async (val: string) => {
    if (qrList.some(e => e.raw === val)) {
      showToast('QR นี้ถูกเพิ่มในชุดนี้แล้ว')
      setQrInput('')
      return
    }
    setQrLoading(true)
    try {
      const r = await fetch(`${API}/lookup/qr/${val}`)
      const d = await r.json()
      if (!r.ok) {
        showToast(d.detail || 'QR ไม่ถูกต้อง')
      } else {
        const newEntry: QREntry = { raw: val, data: d as QRData }
        const newList = [...qrList, newEntry]
        setQrList(newList)
        setQrInput('')
        qrInputRef.current?.focus()
        if (defectInfo) commitBatchToTableWith(newList, defectInfo, defectInput)
      }
    } catch {
      showToast('เชื่อมต่อ API ไม่ได้')
    } finally {
      setQrLoading(false)
    }
  }

  const removeQR = (raw: string) => setQrList(prev => prev.filter(e => e.raw !== raw))

  const clearBatch = () => {
    setQrList([])
    setQrInput('')
    setDefectInput('')
    setDefectInfo(null)
  }

  // ══ Step 2: Defect lookup ═════════════════════════
  const handleDefectChange = (val: string) => {
    setDefectInput(val)
    setDefectInfo(null)
    if (defectTimerRef.current) clearTimeout(defectTimerRef.current)
    if (!val.trim()) return
    defectTimerRef.current = setTimeout(() => lookupDefect(val), 300)
  }

  const lookupDefect = async (val: string) => {
    setDefectLoading(true)
    try {
      const r = await fetch(`${API}/lookup/defect/${val}`)
      const d = await r.json()
      if (r.ok) {
        const info = d as DefectInfo
        setDefectInfo(info)
        if (qrList.length > 0) commitBatchToTableWith(qrList, info, val)
      } else {
        showToast(d.detail || 'ไม่พบ Defect code นี้')
      }
    } catch {
      showToast('เชื่อมต่อ API ไม่ได้')
    } finally {
      setDefectLoading(false)
    }
  }

  const commitBatchToTableWith = (batchQr: QREntry[], info: DefectInfo, defectRawVal: string) => {
    if (batchQr.length === 0 || !info) return
    setRows(prev => {
      const existingKeys = new Set(prev.map(r => `${r.qrEntry.raw}|${r.defectInfo.defect_code}`))
      const newRows: DefectRow[] = []
      const dupLabels: string[] = []
      for (const qrEntry of batchQr) {
        const key = `${qrEntry.raw}|${info.defect_code}`
        if (existingKeys.has(key)) {
          dupLabels.push(`QR: ${qrEntry.raw.slice(0, 18)}… / Defect: ${info.defect_item}${info.defect_mode ? ' – ' + info.defect_mode : ''}`)
        } else {
          newRows.push({ id: `${Date.now()}-${Math.random()}`, qrEntry, defectInfo: info, defectRaw: defectRawVal })
        }
      }
      if (dupLabels.length > 0) {
        const msg = dupLabels.length === 1
          ? `คุณบันทึก QR และ Defect นี้ไปแล้ว:\n${dupLabels[0]}`
          : `คุณบันทึก QR และ Defect เหล่านี้ไปแล้ว (${dupLabels.length} รายการ):\n${dupLabels.join('\n')}`
        setTimeout(() => showToast(msg), 0)
      }
      return newRows.length > 0 ? [...prev, ...newRows] : prev
    })
    setQrList([])
    setQrInput('')
    setDefectInput('')
    setDefectInfo(null)
    qrInputRef.current?.focus()
  }

  const handleDefectEnter = () => {
    if (!defectInput.trim()) return
    if (qrList.length === 0) { showToast('กรุณา Scan Side Plate QR Code ก่อน (Step 1)'); return }
    if (defectTimerRef.current) clearTimeout(defectTimerRef.current)
    lookupDefect(defectInput.trim())
  }

  // ══ Table selection / delete ══════════════════════
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleSelectAll = () =>
    setSelectedIds(selectedIds.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))

  const deleteSelected = () => {
    setRows(prev => prev.filter(r => !selectedIds.has(r.id)))
    setSelectedIds(new Set())
  }

  // ══ Submit ════════════════════════════════════════
  const handleSubmit = async () => {
    if (!operatorName) { showToast('ไม่พบชื่อ Operator กรุณาเข้าสู่ระบบใหม่'); return }
    if (!shift) { showToast('กรุณาเลือก Shift'); return }
    if (rows.length === 0) { showToast('ยังไม่มีข้อมูลในตาราง'); return }
    setSubmitLoading(true)
    try {
      const results = await Promise.all(
        rows.map(row => {
          const { qrEntry, defectInfo } = row
          const body = {
            name: operatorName,
            line: qrEntry.data.line || 'L1',
            part_no: qrEntry.data.part_no,
            core_no: qrEntry.data.core_no || '00',
            model_name: qrEntry.data.model,
            production_date: qrEntry.data.date,
            production_time: qrEntry.data.time,
            work_tag: qrEntry.data.work_tag || '0000',
            group: 'A',
            shift,
            ph_top: qrEntry.data.ph_top,
            die_list_ph_top: qrEntry.data.die_list_ph_top || 'F',
            ph_btm: qrEntry.data.ph_btm,
            die_list_ph_btm: qrEntry.data.die_list_ph_btm || 'F',
            th_top: qrEntry.data.th_top,
            th_btm: qrEntry.data.th_btm,
            defect_item: defectInfo.defect_item,
            defect_mode: defectInfo.defect_mode,
            defect_code: defectInfo.defect_code,
            defect_by_process: defectInfo.defect_by_process,
            defect_type: defectInfo.defect_type,
            model_qr: qrEntry.raw,
            defect_qr: row.defectRaw,
            date_day: new Date().toISOString().slice(0, 10),
            time: new Date().toISOString(),
          }
          return fetch(`${API}/form/defect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify(body),
          }).then(r => r.json().then(d => ({ ok: r.ok, data: d, row })))
        })
      )
      const inserted = results.filter(r => r.ok && !r.data.skipped).length
      const skipped = results.filter(r => !r.ok || r.data.skipped)
      if (inserted === 0 && skipped.length > 0) {
        const lines = skipped.map(r => {
          const model = r.row.qrEntry.data.model || r.row.qrEntry.raw.slice(0, 18)
          const s = r.data.skipped_qrs?.[0]
          const reason = s ? `บันทึกแล้วเมื่อ ${s.scan_date} ${s.scan_time} Shift ${s.shift} โดย ${s.name}` : (typeof r.data.detail === 'string' ? r.data.detail : 'ไม่สามารถบันทึกได้')
          return `• ${model} — ${reason}`
        })
        showToast(`QR ซ้ำในระบบแล้ว:\n${lines.join('\n')}`)
        return
      }
      setShowSuccess(true)
      setRows([])
      setSelectedIds(new Set())
      setQrList([])
      setQrInput('')
      setDefectInput('')
      setDefectInfo(null)
      if (skipped.length > 0) {
        const lines = skipped.map(r => {
          const model = r.row.qrEntry.data.model || r.row.qrEntry.raw.slice(0, 18)
          const s = r.data.skipped_qrs?.[0]
          const reason = s ? `ซ้ำ: ${s.scan_date} ${s.scan_time} โดย ${s.name}` : (typeof r.data.detail === 'string' ? r.data.detail : '?')
          return `• ${model} — ${reason}`
        })
        showToast(`บันทึก ${inserted} รายการ / ข้าม ${skipped.length} รายการ:\n${lines.join('\n')}`, 'warn')
      }
    } catch {
      showToast('เชื่อมต่อ API ไม่ได้')
    } finally {
      setSubmitLoading(false)
    }
  }

  // ══════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════
  return (
    <div className="dfp-page page active">

      {/* Toast */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Header bar ── */}
      <div className="dfp-header-bar" style={{ background: 'transparent', borderBottom: 'none', paddingBottom: 0 }}>
        <div className="dfp-header-left">
          <h1 className="dfp-title">Defect Form</h1>
          <span className="dfp-breadcrumb">Recorded form &gt; Defect Form</span>
        </div>
        <button className="dfp-submit-btn" onClick={handleSubmit} disabled={submitLoading}>
          <SquareCheckBig size={16} />
          {submitLoading ? 'Saving…' : 'Submit'}
        </button>
      </div>

      <div className="dfp-body">

        {/* ══ Info card ══ */}
        <div className="dfp-card dfp-info-card">

          {/* Operator Name — read-only, filled from JWT */}
          <div className="dfp-info-field">
            <label className="dfp-info-label">Operator Name</label>
            <div className="dfp-select-wrap">
              <span className="dfp-input-icon"><IconUser /></span>
              <span style={{
                flex: 1, padding: '8px 0', fontSize: 13,
                fontFamily: 'var(--font-sarabun), Sarabun, sans-serif',
                color: operatorName ? '#111827' : '#9ca3af',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {operatorName || 'ไม่พบข้อมูล — กรุณา Login ใหม่'}
              </span>
              {/* Lock icon */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          </div>

          {/* Shift */}
          <div className="dfp-info-field">
            <label className="dfp-info-label">Shift</label>
            <div className="dfp-shift-toggle">
              {(['A', 'B'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`dfp-shift-btn${shift === s ? ' active' : ''}`}
                  onClick={() => setShift(s)}
                >
                  <span className="dfp-shift-dot" />{s}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div className="dfp-info-field dfp-info-date" style={{ alignItems: 'flex-end' }}>
            <label className="dfp-info-label">Date (Real time)</label>
            <div className="dfp-date-display">{todayStr}</div>
          </div>

        </div>

        {/* ══ Scan row ══ */}
        <div className="dfp-scan-row">

          {/* Step 1 */}
          <div className="dfp-card dfp-scan-card">
            <div className="dfp-step-label">
              <span className="dfp-step-num">1.</span>
              Scan Side Plate QR Code
              <span className="dfp-step-hint">(can scan multiple)</span>
            </div>
            <button className="dfp-scan-btn" onClick={() => qrInputRef.current?.focus()}>
              <IconQR />
              Click Here For Scan QR Codes
            </button>
            <input
              ref={qrInputRef}
              className="dfp-hidden-input"
              value={qrInput}
              onChange={e => handleQrChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleQRScan() }}
              placeholder={qrLoading ? 'Looking up…' : 'Scan or type QR then Enter'}
              disabled={qrLoading}
            />
            <div className="dfp-scanned-box">
              <div className="dfp-scanned-header">
                <span className="dfp-scanned-label">
                  Scanned{qrList.length > 0 && <span className="dfp-batch-count"> · {qrList.length}</span>}
                </span>
                {qrList.length > 0 && <button className="dfp-clear-all-btn" onClick={clearBatch}>Clear All</button>}
              </div>
              <div className="dfp-scanned-list" style={{ overflowY: qrList.length > 3 ? 'auto' : 'hidden' }}>
                {qrList.length === 0 && <div className="dfp-empty-hint">No QR scanned yet</div>}
                {qrList.map(entry => (
                  <div key={entry.raw} className="dfp-scanned-chip">
                    <div className="dfp-chip-info">
                      <span className="dfp-chip-model">{entry.data.model || '—'}-</span>
                      <span className="dfp-chip-raw">{entry.raw.slice(0, 32)}</span>
                    </div>
                    <button className="dfp-chip-del" onClick={() => removeQR(entry.raw)}><IconX /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="dfp-card dfp-scan-card">
            <div className="dfp-step-label">
              <span className="dfp-step-num">2.</span>
              Scan Defect item
              <span className="dfp-info-icon" title="Defect applies to all QRs in current batch">ℹ</span>
            </div>
            <button
              className={`dfp-scan-btn${qrList.length === 0 ? ' dfp-scan-btn-disabled' : ''}`}
              onClick={() => {
                if (qrList.length === 0) { showToast('กรุณา Scan Side Plate QR Code ก่อน (Step 1)'); return }
                defectInputRef.current?.focus()
              }}
            >
              <IconQR />
              Click Here For Scan QR Codes
            </button>
            <input
              ref={defectInputRef}
              className="dfp-hidden-input"
              value={defectInput}
              onChange={e => handleDefectChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDefectEnter() }}
              placeholder={qrList.length === 0 ? 'Scan Side Plate QR first' : defectLoading ? 'Looking up…' : 'Scan or type defect then Enter'}
              disabled={defectLoading || qrList.length === 0}
            />
            <div className="dfp-scanned-box">
              <div className="dfp-scanned-header">
                <span className="dfp-scanned-label">Scanned</span>
                {defectInfo && (
                  <button className="dfp-clear-all-btn" onClick={() => { setDefectInput(''); setDefectInfo(null) }}>Clear</button>
                )}
              </div>
              <div className="dfp-scanned-list" style={{ overflowY: defectInfo ? 'auto' : 'hidden' }}>
                {!defectInfo && (
                  <div className="dfp-empty-hint">
                    {qrList.length === 0 ? 'Complete Step 1 first' : 'No defect scanned yet'}
                  </div>
                )}
                {defectInfo && (
                  <div className="dfp-defect-result">
                    <div className="dfp-defect-main">
                      {defectInfo.defect_item}
                      {defectInfo.defect_mode && (
                        <><span className="dfp-defect-dash"> – </span><span className="dfp-defect-mode-badge">{defectInfo.defect_mode}</span></>
                      )}
                    </div>
                    <div className="dfp-commit-hint dfp-commit-hint-auto">✓ Auto-added to table</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Summary card */}
          <div className="dfp-card dfp-summary-card">
            <div className="dfp-summary-row">
              <span className="dfp-summary-label">Total Scanned</span>
              <span className="dfp-summary-count">{totalScanned}</span>
              <span className="dfp-summary-unit">{totalScannedLabel}</span>
            </div>
            <div className="dfp-summary-divider" />
            <div className="dfp-summary-row">
              <span className="dfp-summary-label">Defect Item</span>
              <span className="dfp-summary-count dfp-summary-green">{uniqueDefectItems}</span>
              <span className="dfp-summary-unit">{defectItemLabel}</span>
            </div>
          </div>
        </div>

        {/* ══ Step 3: Table ══ */}
        <div className="dfp-card dfp-table-card">
          <div className="dfp-table-header">
            <div className="dfp-step-label">
              <span className="dfp-step-num">3.</span>
              Defect Items List
            </div>
            <button
              className={`dfp-delete-btn${selectedIds.size === 0 ? ' disabled' : ''}`}
              onClick={deleteSelected}
              disabled={selectedIds.size === 0}
              title="Delete selected rows"
            >
              <IconTrash />
            </button>
          </div>

          <div className="dfp-table-wrap">
            <table className="dfp-table">
              <thead>
                <tr>
                  <th className="dfp-th dfp-th-check">
                    <input type="checkbox" className="dfp-checkbox"
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onChange={toggleSelectAll} />
                  </th>
                  <th className="dfp-th">Side plate QR code</th>
                  <th className="dfp-th">Model</th>
                  <th className="dfp-th">Defect Item</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="dfp-td-empty">
                      No data yet — scan QR codes and defect items above
                    </td>
                  </tr>
                )}
                {rows.map(row => (
                  <tr key={row.id} className={selectedIds.has(row.id) ? 'dfp-row-selected' : ''}>
                    <td className="dfp-td dfp-td-check">
                      <input type="checkbox" className="dfp-checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)} />
                    </td>
                    <td className="dfp-td dfp-td-qr" title={row.qrEntry.raw}>{row.qrEntry.raw}</td>
                    <td className="dfp-td">{row.qrEntry.data.model || '—'}</td>
                    <td className="dfp-td dfp-td-defect">
                      <span className="dfp-col-defect-item">{row.defectInfo.defect_item}</span>
                      {row.defectInfo.defect_mode && (
                        <><span className="dfp-col-defect-dash"> – </span><span className="dfp-col-defect-mode">{row.defectInfo.defect_mode}</span></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── Success overlay ── */}
      {showSuccess && (
        <div className="dfp-overlay">
          <div className="dfp-success-box">
            <div className="dfp-success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1462FF" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="dfp-success-title">บันทึกข้อมูลสำเร็จ</div>
            <div className="dfp-success-sub">ข้อมูล Defect Form ถูกส่งเรียบร้อยแล้ว</div>
            <button className="dfp-success-ok" onClick={() => setShowSuccess(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}