'use client'

import dynamic from 'next/dynamic'
import { useState, useRef, useEffect } from 'react'

const PptxExporter = dynamic(() => import('./PptxExporter'), { ssr: false })
import { API, authHeaders, STATUS_OPTIONS } from '../shared'

// ── Types ──
interface ReportRow {
  id:                string
  modeName:          string
  assumptionDetail:  string
  assumptionPicture: string
  actionDetail:      string
  actionPicture:     string
  dueDateStart:      string
  dueDateEnd:        string
  pic:               string
  progress:          number
  status:            string
}

interface SubmittedReport {
  id:         string
  date:       string
  rows:       ReportRow[]
  pdfDataUrl?: string
}

// ── Helpers ──
const newRow = (): ReportRow => ({
  id:                crypto.randomUUID(),
  modeName:          '',
  assumptionDetail:  '',
  assumptionPicture: '',
  actionDetail:      '',
  actionPicture:     '',
  dueDateStart:      '',
  dueDateEnd:        '',
  pic:               '',
  progress:          0,
  status:            '',
})

function firstNameOnly(fullName: string): string {
  if (!fullName) return ''
  return fullName.trim().split(/\s+/)[0]
}

// ─── Design tokens ───────────────────────────────────────────────────────────
const T = {
  bg:         '#F8FAFC',
  surface:    '#FFFFFF',
  border:     '#E8ECF0',
  borderHover:'#C7D5E8',
  blue:       '#1462FF',
  blueSoft:   '#EEF4FF',
  blueHover:  '#0F4FD4',
  text:       '#111827',
  textSub:    '#6B7280',
  textMuted:  '#9CA3AF',
  rowEven:    '#FFFFFF',
  rowOdd:     '#F8FAFD',
  shadow:     '0 1px 3px rgba(20,98,255,.06), 0 1px 2px rgba(0,0,0,.04)',
  shadowMd:   '0 4px 16px rgba(20,98,255,.10), 0 2px 6px rgba(0,0,0,.06)',
  radius:     10,
}

// ─── Pizza Progress ──────────────────────────────────────────────────────────
const PizzaProgress = ({ value, onChange }: { value: number; onChange?: (v: number) => void }) => {
  const steps = [0, 25, 50, 75, 100]
  const size = 32, cx = 16, cy = 16, r = 13
  const slices: [number, number][] = [[0,25],[25,50],[50,75],[75,100]]
  const filledSlices = value / 25
  const toRad = (p: number) => (p / 100) * 2 * Math.PI - Math.PI / 2
  const slicePath = (s: number, e: number) => {
    const x1 = cx + r * Math.cos(toRad(s)), y1 = cy + r * Math.sin(toRad(s))
    const x2 = cx + r * Math.cos(toRad(e)), y2 = cy + r * Math.sin(toRad(e))
    return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${e-s>50?1:0} 1 ${x2},${y2} Z`
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ cursor: 'pointer', flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill={T.blueSoft} />
      {slices.map(([s, e], i) => (
        <path key={i} d={slicePath(s, e)}
          fill={i < filledSlices ? T.blue : 'transparent'}
          stroke="#fff" strokeWidth={1.5}
          onClick={() => { const next = steps[i+1]??100; onChange?.(value===next ? steps[i] : next) }} />
      ))}
      {slices.map(([s], i) => {
        const rad = (s/100)*2*Math.PI - Math.PI/2
        return <line key={i} x1={cx} y1={cy} x2={cx+r*Math.cos(rad)} y2={cy+r*Math.sin(rad)} stroke="#ffffff" strokeWidth={1.5} />
      })}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={1} />
    </svg>
  )
}

// ─── Status colors ───────────────────────────────────────────────────────────
const STATUS_COLOR_OVERRIDE: Record<string, string> = { 'Pending': '#9e9e9e' }
function resolveStatusColor(opt: { label: string; color: string }): string {
  return STATUS_COLOR_OVERRIDE[opt.label] ?? opt.color
}

// ─── Floating Status Picker ──────────────────────────────────────────────────
const StatusDot = ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => {
  const raw     = STATUS_OPTIONS.find(s => s.label === value) ?? STATUS_OPTIONS[0]
  const current = { ...raw, color: resolveStatusColor(raw) }
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0 as number | 'auto', bottom: 'auto' as number | 'auto', left: 0 })
  const triggerRef      = useRef<HTMLDivElement>(null)

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect      = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp    = spaceBelow < 220 && rect.top > 220
      setPos({ top: openUp ? 'auto' : rect.bottom + 6, bottom: openUp ? (window.innerHeight - rect.top + 6) : 'auto', left: rect.left })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <>
      <div ref={triggerRef} onClick={handleOpen} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '4px 10px', borderRadius: 20,
        background: current.color + '18', border: `1.5px solid ${current.color}44`,
        userSelect: 'none', width: '100%', justifyContent: 'center', transition: 'background .15s',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: current.color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: current.color, whiteSpace: 'nowrap' }}>{current.label}</span>
      </div>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={() => setOpen(false)} />
          <div style={{
            position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left,
            background: T.surface, borderRadius: 12, boxShadow: T.shadowMd,
            padding: 8, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 2,
            minWidth: 150, border: `1px solid ${T.border}`, maxHeight: 260, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.blue, letterSpacing: '.06em', textTransform: 'uppercase', padding: '4px 10px 6px' }}>Status</div>
            {STATUS_OPTIONS.map(opt => {
              const optColor = resolveStatusColor(opt)
              return (
                <button key={opt.label}
                  onMouseDown={e => { e.stopPropagation(); onChange?.(opt.label); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: value === opt.label ? optColor + '18' : 'none',
                    border: 'none', borderRadius: 8, padding: '7px 10px',
                    cursor: 'pointer', fontSize: 12, color: '#333',
                    fontWeight: value === opt.label ? 700 : 400,
                    fontFamily: 'Sarabun, sans-serif', textAlign: 'left',
                  }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: optColor, flexShrink: 0 }} />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// ─── Picture Cell ────────────────────────────────────────────────────────────
const PictureCell = ({ value, onUpload, onClear }: { value?: string; onUpload: (file: File) => void; onClear: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {value ? (
        <div style={{ position: 'relative' }}>
          <img src={value} style={{ width: 58, height: 50, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', display: 'block', border: `1px solid ${T.border}` }}
            onClick={() => inputRef.current?.click()} title="Click to change" />
          <button onClick={e => { e.stopPropagation(); onClear() }}
            style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#EF5350', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            title="Remove picture">✕</button>
        </div>
      ) : (
        <label style={{ cursor: 'pointer' }}>
          <div style={{ width: 58, height: 50, border: `1.5px dashed ${T.borderHover}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: T.textMuted, background: T.bg, transition: 'border-color .15s, background .15s' }}>+</div>
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
    </div>
  )
}

// ─── Auto-resize Textarea ────────────────────────────────────────────────────
const AutoTextarea = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(el.scrollHeight, 60) + 'px'
  }, [value])
  return (
    <textarea ref={ref} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={1}
      style={{ width: '100%', resize: 'none', padding: '5px 8px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 11, fontFamily: 'Sarabun,sans-serif', lineHeight: 1.5, overflow: 'hidden', boxSizing: 'border-box', minHeight: 46, background: T.bg, color: T.text, outline: 'none', transition: 'border-color .15s, box-shadow .15s' }}
      onFocus={e => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.boxShadow = `0 0 0 3px ${T.blue}18` }}
      onBlur={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = 'none' }}
    />
  )
}

// ─── Mode Dropdown ───────────────────────────────────────────────────────────
const DROPDOWN_APPROX_H = 260

const ModeDropdown = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0 as number | 'auto', bottom: 'auto' as number | 'auto', left: 0, width: 0 })
  const ref = useRef<HTMLDivElement>(null)

  const handleOpen = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const openUp = spaceBelow < DROPDOWN_APPROX_H && r.top > DROPDOWN_APPROX_H
      setPos({ top: openUp ? 'auto' : r.bottom + 4, bottom: openUp ? (window.innerHeight - r.top + 4) : 'auto', left: r.left, width: r.width })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <div onClick={handleOpen} style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'center', fontWeight: 700, fontSize: 13, color: value ? T.blue : T.textMuted, outline: 'none', fontFamily: 'Sarabun, sans-serif', cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <span>{value || '—'}</span>
        <span style={{ fontSize: 9, opacity: 0.45 }}>▼</span>
      </div>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: Math.max(pos.width, 140), background: T.surface, borderRadius: 10, boxShadow: T.shadowMd, padding: 6, zIndex: 9999, border: `1px solid ${T.border}`, maxHeight: 280, overflowY: 'auto' }}>
            <div style={{ padding: '4px 10px 6px', fontSize: 10, fontWeight: 700, color: T.blue, letterSpacing: '.06em', textTransform: 'uppercase' }}>Mode</div>
            <input value={value} placeholder="Custom…" onChange={e => onChange(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', marginBottom: 4, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontFamily: 'Sarabun,sans-serif', outline: 'none', boxSizing: 'border-box' }} />
            {options.map(opt => (
              <button key={opt} onMouseDown={e => { e.stopPropagation(); onChange(opt); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: value === opt ? T.blueSoft : 'none', border: 'none', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: value === opt ? T.blue : '#333', fontWeight: value === opt ? 700 : 400, fontFamily: 'Sarabun, sans-serif' }}>
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PIC Dropdown ────────────────────────────────────────────────────────────
const PicDropdown = ({ value, onChange, options = [] }: { value: string; onChange: (v: string) => void; options?: string[] }) => {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0 as number | 'auto', bottom: 'auto' as number | 'auto', left: 0, width: 0 })
  const ref = useRef<HTMLDivElement>(null)

  const handleOpen = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const openUp = spaceBelow < DROPDOWN_APPROX_H && r.top > DROPDOWN_APPROX_H
      setPos({ top: openUp ? 'auto' : r.bottom + 4, bottom: openUp ? (window.innerHeight - r.top + 4) : 'auto', left: r.left, width: r.width })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <div onClick={handleOpen} style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: 8, textAlign: 'center', fontSize: 12, padding: '6px 8px', color: value ? T.text : T.textMuted, cursor: 'pointer', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'Sarabun,sans-serif', transition: 'border-color .15s' }}>
        <span style={{ flex: 1 }}>{value || 'Select…'}</span>
        <span style={{ fontSize: 9, opacity: 0.45, flexShrink: 0 }}>▼</span>
      </div>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: Math.max(pos.width, 160), background: T.surface, borderRadius: 10, boxShadow: T.shadowMd, padding: 6, zIndex: 9999, border: `1px solid ${T.border}`, maxHeight: 280, overflowY: 'auto' }}>
            <div style={{ padding: '4px 10px 6px', fontSize: 10, fontWeight: 700, color: T.blue, letterSpacing: '.06em', textTransform: 'uppercase' }}>PIC</div>
            <input value={value} placeholder="Custom name…" onChange={e => onChange(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', marginBottom: 4, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontFamily: 'Sarabun,sans-serif', outline: 'none', boxSizing: 'border-box' }} />
            {options.map(opt => (
              <button key={opt} onMouseDown={e => { e.stopPropagation(); onChange(opt); setOpen(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: value === opt ? T.blueSoft : 'none', border: 'none', borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: value === opt ? T.blue : '#333', fontWeight: value === opt ? 700 : 400, fontFamily: 'Sarabun, sans-serif' }}>
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Merge map ───────────────────────────────────────────────────────────────
function getMergeMap(rows: ReportRow[]): Map<number, number> {
  const map = new Map<number, number>()
  let i = 0
  while (i < rows.length) {
    const mode = rows[i].modeName?.trim()
    if (!mode) { map.set(i, 1); i++ }
    else {
      let j = i + 1
      while (j < rows.length && rows[j].modeName?.trim() === mode) j++
      map.set(i, j - i); i = j
    }
  }
  return map
}

// ─── Reorder controls ────────────────────────────────────────────────────────
const ReorderControls = ({ isFirst, isLast, onUp, onDown }: { isFirst: boolean; isLast: boolean; onUp: () => void; onDown: () => void }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
    <button onClick={onUp} disabled={isFirst}
      style={{ background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer', color: isFirst ? '#e0e0e0' : T.textMuted, fontSize: 11, padding: '2px 6px', borderRadius: 4, lineHeight: 1, transition: 'color .15s' }}
      onMouseEnter={e => { if (!isFirst) (e.currentTarget as HTMLButtonElement).style.color = T.blue }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isFirst ? '#e0e0e0' : T.textMuted }}
    >▲</button>
    <button onClick={onDown} disabled={isLast}
      style={{ background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer', color: isLast ? '#e0e0e0' : T.textMuted, fontSize: 11, padding: '2px 6px', borderRadius: 4, lineHeight: 1, transition: 'color .15s' }}
      onMouseEnter={e => { if (!isLast) (e.currentTarget as HTMLButtonElement).style.color = T.blue }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isLast ? '#e0e0e0' : T.textMuted }}
    >▼</button>
  </div>
)

// ─── Submit Warning Modal ────────────────────────────────────────────────────
const SubmitModal = ({ onConfirm, onCancel, isExporting }: { onConfirm: () => void; onCancel: () => void; isExporting: boolean }) => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(17,24,39,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: T.surface, borderRadius: 16, padding: '32px 36px', maxWidth: 420, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: 16, border: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: T.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text, fontFamily: 'Sarabun,sans-serif' }}>Submit Report</div>
          <div style={{ fontSize: 12, color: T.textSub, fontFamily: 'Sarabun,sans-serif' }}>This action cannot be undone</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#444', lineHeight: 1.6, fontFamily: 'Sarabun,sans-serif', margin: 0, background: T.bg, borderRadius: 8, padding: '12px 14px', border: `1px solid ${T.border}` }}>
        หากกด <strong>Submit</strong> ไฟล์จะถูกบันทึกเป็น <strong>PDF</strong> คุณ<strong>จะไม่สามารถแก้ไขไฟล์นี้ได้อีก</strong>
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
        <button onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, fontSize: 13, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', color: T.textSub }}>ยกเลิก</button>
        <button onClick={onConfirm} disabled={isExporting} style={{ padding: '9px 22px', borderRadius: 8, background: isExporting ? '#93b4f7' : T.blue, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: isExporting ? 'not-allowed' : 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'background .2s' }}>
          {isExporting ? 'กำลังบันทึก…' : 'Submit & Export PDF'}
        </button>
      </div>
    </div>
  </div>
)

// ─── Save Toast ──────────────────────────────────────────────────────────────
const SaveToast = ({ visible }: { visible: boolean }) => (
  <div style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 9990, background: T.text, color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontFamily: 'Sarabun,sans-serif', boxShadow: T.shadowMd, display: 'flex', alignItems: 'center', gap: 8, opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(12px)', transition: 'opacity .25s, transform .25s', pointerEvents: 'none' }}>
  <span style={{ color: '#4ade80', fontSize: 16 }}>✓</span>
  บันทึกข้อมูล
</div>
)

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY   = 'defect_report_rows_v1'
const SUBMITTED_KEY = 'defect_report_submitted_v1'
const DEFAULT_MODES = ['Mode A', 'Mode B', 'Mode C', 'Mode D', 'Mode E']

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function ReportPage() {
  const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })

  // ── Fetch employees from API ──
  const [picOptions, setPicOptions] = useState<string[]>([])
  useEffect(() => {
    fetch(`${API}/users`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((data: { full_name: string }[]) => {
        setPicOptions(data.map(u => firstNameOnly(u.full_name)).filter(Boolean))
      })
      .catch(() => {})
  }, [])

  // ── State ──
  const [rows, setRows]         = useState<ReportRow[]>([newRow()])
  const [submitted, setSubmitted] = useState<SubmittedReport[]>([])

  useEffect(() => {
    try { const s = localStorage.getItem(STORAGE_KEY);   if (s) setRows(JSON.parse(s)) }     catch {}
    try { const s = localStorage.getItem(SUBMITTED_KEY); if (s) setSubmitted(JSON.parse(s)) } catch {}
  }, [])

  const [showSubmitModal, setShowSubmitModal]   = useState(false)
  const [isExporting, setIsExporting]           = useState(false)
  const [saveToastVisible, setSaveToastVisible] = useState(false)
  const [exportingPptx, setExportingPptx]       = useState(false)
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)) } catch {}
  }, [rows])

  // ── Handlers ──
  const handleSave = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)) } catch {}
    setSaveToastVisible(true)
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current)
    saveToastTimer.current = setTimeout(() => setSaveToastVisible(false), 2200)
  }

  const addRow    = () => setRows(prev => [...prev, newRow()])
  const resetRow  = (id: string) => setRows(prev => prev.map(r => r.id === id ? { ...newRow(), id: r.id } : r))
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id))
  const updateRow = (id: string, field: keyof Omit<ReportRow,'id'>, val: any) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))

  const handlePicUpload = (id: string, field: 'assumptionPicture' | 'actionPicture', file: File) => {
    const reader = new FileReader()
    reader.onload = e => updateRow(id, field, e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const moveRow = (idx: number, dir: -1 | 1) => {
    setRows(prev => {
      const next = [...prev], target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const deleteSubmitted = (id: string) => {
    const updated = submitted.filter(r => r.id !== id)
    setSubmitted(updated)
    try { localStorage.setItem(SUBMITTED_KEY, JSON.stringify(updated)) } catch {}
  }

  // ── Generate PDF ──
  const generatePdfBlob = async (): Promise<string> => {
    const imgCell = (src?: string) => src
      ? `<div style="width:90px;height:70px;display:flex;align-items:center;justify-content:center;margin:auto"><img src="${src}" style="max-width:90px;max-height:70px;object-fit:contain;display:block"/></div>`
      : `<span style="color:#999">—</span>`

    const pdfMergeMap = getMergeMap(rows)
    const bodyRows = rows.map((r, ri) => {
      const isMergeStart = pdfMergeMap.has(ri), span = pdfMergeMap.get(ri) ?? 1
      const modeCell = isMergeStart ? `<td class="mode-cell" rowspan="${span}">${r.modeName||'—'}</td>` : ''
      return `<tr>${modeCell}<td class="detail">${r.assumptionDetail||'—'}</td><td>${imgCell(r.assumptionPicture)}</td><td class="detail">${r.actionDetail||'—'}</td><td>${imgCell(r.actionPicture)}</td><td>${[r.dueDateStart,r.dueDateEnd].filter(Boolean).join('<br>–<br>')||'—'}</td><td>${r.pic||'—'}</td><td class="progress">${r.progress}%</td><td>${r.status}</td></tr>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${todayStr}</title>
<style>@page{size:A4 landscape;margin:14mm 12mm;}body{font-family:'Sarabun',sans-serif;font-size:10px;margin:0;color:#000;background:#fff;}h1{color:#000;font-size:16px;margin:0 0 2px;}.date{color:#333;font-size:10px;margin-bottom:12px;}table{width:100%;border-collapse:collapse;table-layout:fixed;}th{background:#f0f0f0;color:#000;font-size:9px;padding:5px 6px;border:1px solid #000;text-align:center;white-space:nowrap;}td{padding:5px 6px;border:1px solid #000;vertical-align:middle;font-size:9px;text-align:center;word-break:break-word;color:#000;}tr:nth-child(even) td{background:#f8f8f8;}.mode-cell{font-weight:700;color:#000;background:#e8e8e8 !important;}.progress{font-weight:700;color:#000;}.detail{text-align:left;}</style></head><body>
<h1>Report</h1><div class="date">${todayStr}</div>
<table><thead><tr><th rowspan="2">Mode</th><th colspan="2">Assumption</th><th colspan="2">Action</th><th rowspan="2">Due Date</th><th rowspan="2">PIC</th><th rowspan="2">Progress</th><th rowspan="2">Status</th></tr><tr><th>Detail</th><th>Picture</th><th>Detail</th><th>Picture</th></tr></thead><tbody>${bodyRows}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`

    const blob = new Blob([html], { type: 'text/html' })
    return URL.createObjectURL(blob)
  }

  // ── Submit handler ──
  const handleSubmitConfirm = async () => {
    setIsExporting(true)
    try {
      const pdfDataUrl = await generatePdfBlob()

      // บันทึกแต่ละแถวของ report ไป API
      for (const row of rows) {
        const reportData = {
          mode: row.modeName || '',
          assumption_detail: row.assumptionDetail || '',
          action_detail: row.actionDetail || '',
          date_day: new Date().toISOString().slice(0, 10),
          pic: row.pic || '',
          progress: row.progress || 0,
          status: row.status || 'Pending',
        }

        const response = await fetch(`${API}/report`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(reportData),
        })

        if (!response.ok) {
          throw new Error(`Failed to submit report: ${response.statusText}`)
        }
      }

      // บันทึกลง localStorage สำหรับแสดง submitted reports ใน UI
      const record: SubmittedReport = { id: crypto.randomUUID(), date: todayStr, rows: JSON.parse(JSON.stringify(rows)), pdfDataUrl }
      const newSubmitted = [...submitted, record]
      setSubmitted(newSubmitted)
      localStorage.setItem(SUBMITTED_KEY, JSON.stringify(newSubmitted))

      const fresh = [newRow()]
      setRows(fresh)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
      setShowSubmitModal(false)
    } catch (err) {
      console.error('Submit failed', err)
      alert('บันทึก report ไม่สำเร็จ: ' + String(err))
    } finally {
      setIsExporting(false)
    }
  }

  // ─── Table cell base styles ───
  const th: React.CSSProperties = {
    padding: '6px 8px', textAlign: 'center', fontWeight: 700,
    fontSize: 11, color: T.blue, background: T.blueSoft,
    border: `1px solid #D1E0FF`, whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '5px 7px', verticalAlign: 'middle',
    border: `1px solid ${T.border}`, textAlign: 'center',
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg, overflow: 'hidden' }}>
      <SaveToast visible={saveToastVisible} />

      {showSubmitModal && (
        <SubmitModal onConfirm={handleSubmitConfirm} onCancel={() => setShowSubmitModal(false)} isExporting={isExporting} />
      )}

      {/* ─── Header bar ─── */}
      <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', background: T.surface, borderBottom: `1px solid ${T.border}`, boxShadow: '0 1px 3px rgba(20,98,255,.06)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, lineHeight: 1.2, margin: 0 }}>Report</h1>
          <span style={{ fontSize: 11, color: T.textMuted }}>Report › Report Maker</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setExportingPptx(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.color = T.blue; e.currentTarget.style.background = T.blueSoft }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; e.currentTarget.style.background = T.surface }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export (pptx)
          </button>
          <button onClick={() => setShowSubmitModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 8, border: 'none', background: T.blue, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', boxShadow: `0 2px 10px ${T.blue}44`, transition: 'background .15s, transform .1s' }}
            onMouseEnter={e => { e.currentTarget.style.background = T.blueHover }}
            onMouseLeave={e => { e.currentTarget.style.background = T.blue }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Submit
          </button>
        </div>
      </div>

      {/* ─── Scrollable content ─── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '20px 24px' }}>

        {/* ─── Table card ─── */}
        <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, background: T.bg }}>
            <div style={{ width: 4, height: 18, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Report Table</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: T.textMuted, background: T.blueSoft, padding: '3px 10px', borderRadius: 20, border: `1px solid ${T.border}` }}>
              {rows.length} row{rows.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
            <table style={{ tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12, margin: '12px auto' }}>
              <colgroup>
                <col style={{ width: 28 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 75 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 75 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 58 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 42 }} />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ ...th, fontSize: 10, color: T.textMuted, background: T.bg, border: `1px solid ${T.border}` }}></th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>Mode</th>
                  <th colSpan={2} style={th}>Assumption</th>
                  <th colSpan={2} style={th}>Action</th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>Due date</th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>PIC</th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>Progress</th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle' }}>Status</th>
                  <th rowSpan={2} style={{ ...th, verticalAlign: 'middle', background: T.bg, border: `1px solid ${T.border}` }}></th>
                </tr>
                <tr>
                  <th style={{ ...th, fontWeight: 500, fontSize: 10, color: '#000000' }}>Detail</th>
                  <th style={{ ...th, fontWeight: 500, fontSize: 10, color: '#000000' }}>Picture</th>
                  <th style={{ ...th, fontWeight: 500, fontSize: 10, color: '#000000' }}>Detail</th>
                  <th style={{ ...th, fontWeight: 500, fontSize: 10, color: '#000000' }}>Picture</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const bg = ri % 2 === 0 ? T.rowEven : T.rowOdd
                  const hasMode = !!(row.modeName?.trim())
                  const isFirst = ri === 0, isLast = ri === rows.length - 1
                  return (
                    <tr key={row.id} style={{ background: bg, verticalAlign: 'middle' }}>
                      <td style={{ ...td, padding: '4px 2px', background: T.bg }}>
                        <ReorderControls isFirst={isFirst} isLast={isLast} onUp={() => moveRow(ri, -1)} onDown={() => moveRow(ri, 1)} />
                      </td>
                      <td style={{ ...td, fontWeight: 700, fontSize: 11, color: hasMode ? T.blue : T.textMuted, background: hasMode ? T.blueSoft : '#fafafa', borderRight: `2px solid ${T.blue}20`, verticalAlign: 'middle' }}>
                        <ModeDropdown value={row.modeName ?? ''} onChange={val => updateRow(row.id, 'modeName' as any, val)} options={DEFAULT_MODES} />
                      </td>
                      <td style={td}><AutoTextarea value={row.assumptionDetail} placeholder="Detail..." onChange={v => updateRow(row.id, 'assumptionDetail', v)} /></td>
                      <td style={td}><PictureCell value={row.assumptionPicture} onUpload={f => handlePicUpload(row.id, 'assumptionPicture', f)} onClear={() => updateRow(row.id, 'assumptionPicture', undefined as any)} /></td>
                      <td style={td}><AutoTextarea value={row.actionDetail} placeholder="Detail..." onChange={v => updateRow(row.id, 'actionDetail', v)} /></td>
                      <td style={td}><PictureCell value={row.actionPicture} onUpload={f => handlePicUpload(row.id, 'actionPicture', f)} onClear={() => updateRow(row.id, 'actionPicture', undefined as any)} /></td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
                          <input type="date" value={row.dueDateStart ?? ''} onChange={e => updateRow(row.id, 'dueDateStart' as any, e.target.value)}
                            style={{ fontSize: 10, padding: '3px 5px', borderRadius: 6, border: `1px solid ${T.border}`, width: '100%', outline: 'none', background: T.bg, color: T.text }} />
                          <span style={{ fontSize: 9, color: T.textMuted, textAlign: 'center' }}>–</span>
                          <input type="date" value={row.dueDateEnd ?? ''} onChange={e => updateRow(row.id, 'dueDateEnd' as any, e.target.value)}
                            style={{ fontSize: 10, padding: '3px 5px', borderRadius: 6, border: `1px solid ${T.border}`, width: '100%', outline: 'none', background: T.bg, color: T.text }} />
                        </div>
                      </td>
                      <td style={td}><PicDropdown value={row.pic} onChange={v => updateRow(row.id, 'pic', v)} options={picOptions} /></td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <PizzaProgress value={row.progress} onChange={v => updateRow(row.id, 'progress', v)} />
                          <span style={{ fontSize: 9, color: T.blueHover, fontWeight: 700 }}>{row.progress}%</span>
                        </div>
                      </td>
                      <td style={td}><StatusDot value={row.status} onChange={v => updateRow(row.id, 'status', v)} /></td>
                      <td style={{ ...td, background: T.bg }}>
                        <button onClick={() => isFirst ? resetRow(row.id) : removeRow(row.id)}
                          style={{ background: 'none', border: isFirst ? `1px solid ${T.border}` : 'none', cursor: 'pointer', fontSize: isFirst ? 10 : 16, color: isFirst ? T.textMuted : T.border, padding: isFirst ? '3px 7px' : '0 4px', borderRadius: isFirst ? 7 : '50%', lineHeight: 1, fontFamily: 'Sarabun,sans-serif', fontWeight: 600, transition: 'color .15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#EF5350')}
                          onMouseLeave={e => (e.currentTarget.style.color = isFirst ? T.textMuted : T.border)}
                          title={isFirst ? 'Reset row' : 'Remove row'}>
                          {isFirst ? 'reset' : '✕'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer actions */}
          <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${T.border}`, background: T.bg }}>
            <button onClick={addRow}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1.5px dashed ${T.borderHover}`, background: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, color: T.blue, cursor: 'pointer', fontWeight: 600, fontFamily: 'Sarabun,sans-serif', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.background = T.blueSoft }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.borderHover; e.currentTarget.style.background = 'none' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add row
            </button>
            <button onClick={handleSave}
              style={{ padding: '7px 18px', borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.color = T.blue; e.currentTarget.style.background = T.blueSoft }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; e.currentTarget.style.background = T.surface }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save
            </button>
          </div>
        </div>

        {/* ─── Submitted Reports ─── */}
        {submitted.length > 0 && (
          <div style={{ background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, background: T.bg }}>
              <div style={{ width: 4, height: 18, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Submitted Reports</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: T.blue, background: T.blueSoft, padding: '3px 10px', borderRadius: 20, border: `1px solid ${T.border}`, fontWeight: 700 }}>
                {submitted.length} report{submitted.length !== 1 ? 's' : ''}
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['#', 'Date', 'Rows', 'Modes', 'View PDF', ''].map((h, i) => (
                    <th key={i} style={{ ...th, width: i === 5 ? 52 : undefined, padding: '10px 16px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submitted.map((rep, i) => {
                  const modes = [...new Set(rep.rows.map(r => r.modeName).filter(Boolean))]
                  const bg = i % 2 === 0 ? T.rowEven : T.rowOdd
                  return (
                    <tr key={rep.id} style={{ background: bg }}>
                      <td style={{ ...td, color: T.textMuted, width: 40 }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 600, color: T.text }}>{rep.date}</td>
                      <td style={{ ...td, color: T.textSub }}>{rep.rows.length} rows</td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {modes.length > 0
                          ? modes.map(m => (<span key={m} style={{ display: 'inline-block', margin: '2px 3px', background: T.blueSoft, color: T.blue, borderRadius: 5, padding: '2px 8px', fontWeight: 700, fontSize: 11, border: `1px solid #D1E0FF` }}>{m}</span>))
                          : <span style={{ color: T.textMuted }}>—</span>}
                      </td>
                      <td style={td}>
                        {rep.pdfDataUrl
                          ? <a href={rep.pdfDataUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 7, background: T.blueSoft, color: T.blue, border: `1px solid #D1E0FF`, fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: 'Sarabun,sans-serif' }}>📄 Open</a>
                          : <span style={{ color: T.textMuted, fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ ...td, width: 52 }}>
                        <button onClick={() => { if (confirm(`ลบ report วันที่ ${rep.date} ?`)) deleteSubmitted(rep.id) }}
                          title="ลบ report นี้"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: T.border, padding: '0 4px', borderRadius: '50%', lineHeight: 1, transition: 'color .15s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#EF5350')}
                          onMouseLeave={e => (e.currentTarget.style.color = T.border)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {exportingPptx && (
        <PptxExporter
          rows={rows}
          todayStr={todayStr}
          onDone={() => setExportingPptx(false)}
        />
      )}
    </div>
  )
}