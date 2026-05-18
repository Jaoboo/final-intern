'use client'

import { useState, useEffect, useCallback } from 'react'
import { API, authHeaders } from '../../shared'

// ─── Types ───────────────────────────────────────────────────────────────────
interface SubmittedReport {
  no:           number
  title:        string
  submitted_at: string
  has_pdf:      boolean
}

interface ReportRow {
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

// ─── Design tokens (match report page) ───────────────────────────────────────
const T = {
  bg:        '#F8FAFC',
  surface:   '#FFFFFF',
  border:    '#E8ECF0',
  blue:      '#1462FF',
  blueSoft:  '#EEF4FF',
  text:      '#111827',
  textSub:   '#6B7280',
  textMuted: '#9CA3AF',
  rowEven:   '#FFFFFF',
  rowOdd:    '#F8FAFD',
  shadow:    '0 1px 3px rgba(20,98,255,.06), 0 1px 2px rgba(0,0,0,.04)',
  shadowMd:  '0 4px 16px rgba(20,98,255,.10), 0 2px 6px rgba(0,0,0,.06)',
  danger:    '#C0001A',
}

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  'Pending':     '#9e9e9e',
  'In Progress': '#F5A623',
  'Done':        '#7BC67A',
  'Issue':       '#C0001A',
}

const StatusBadge = ({ value }: { value: string }) => {
  const color = STATUS_COLORS[value] ?? '#9CA3AF'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: color + '18', border: `1.5px solid ${color}44`, fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {value || '—'}
    </span>
  )
}

// ─── Pizza visual (read-only) ────────────────────────────────────────────────
const PizzaDisplay = ({ value }: { value: number }) => {
  const size = 28, cx = 14, cy = 14, r = 11
  const slices: [number, number][] = [[0,25],[25,50],[50,75],[75,100]]
  const filledSlices = value / 25
  const toRad = (p: number) => (p / 100) * 2 * Math.PI - Math.PI / 2
  const slicePath = (s: number, e: number) => {
    const x1 = cx + r * Math.cos(toRad(s)), y1 = cy + r * Math.sin(toRad(s))
    const x2 = cx + r * Math.cos(toRad(e)), y2 = cy + r * Math.sin(toRad(e))
    return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${e-s>50?1:0} 1 ${x2},${y2} Z`
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={T.blueSoft} />
        {slices.map(([s, e], i) => (
          <path key={i} d={slicePath(s, e)} fill={i < filledSlices ? T.blue : 'transparent'} stroke="#fff" strokeWidth={1.2} />
        ))}
        {slices.map(([s], i) => {
          const rad = (s/100)*2*Math.PI - Math.PI/2
          return <line key={i} x1={cx} y1={cy} x2={cx+r*Math.cos(rad)} y2={cy+r*Math.sin(rad)} stroke="#fff" strokeWidth={1.2} />
        })}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={1} />
      </svg>
      <span style={{ fontSize: 9, fontWeight: 700, color: T.blue }}>{value}%</span>
    </div>
  )
}

// ─── PDF Viewer Modal ────────────────────────────────────────────────────────
const PdfModal = ({ no, title, onClose }: { no: number; title: string; onClose: () => void }) => {
  const [pdfSrc, setPdfSrc]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows]       = useState<ReportRow[]>([])
  const [view, setView]       = useState<'pdf' | 'table'>('pdf')

  useEffect(() => {
    fetch(`${API}/submitted-reports/${no}/pdf`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.pdf_base64) {
          // Decode base64 HTML → blob URL for iframe
          const html = decodeURIComponent(escape(atob(data.pdf_base64)))
          const blob = new Blob([html], { type: 'text/html' })
          setPdfSrc(URL.createObjectURL(blob))
        }
        if (data?.rows_json) {
          try { setRows(JSON.parse(data.rows_json)) } catch {}
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { if (pdfSrc) URL.revokeObjectURL(pdfSrc) }
  }, [no])

  const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: T.blue, background: T.blueSoft, border: `1px solid #D1E0FF`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', border: `1px solid ${T.border}`, fontSize: 12 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(17,24,39,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: T.surface, borderRadius: 16, width: '100%', maxWidth: 1100, height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.25)', border: `1px solid ${T.border}`, overflow: 'hidden' }}>

        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: `1px solid ${T.border}`, background: T.bg, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</span>
            <span style={{ fontSize: 11, color: T.textMuted }}>Table › Report › Preview</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* View toggle */}
            <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 3, gap: 2 }}>
              {(['pdf', 'table'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  style={{ padding: '5px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .15s', background: view === v ? T.surface : 'transparent', color: view === v ? T.blue : T.textMuted, boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.10)' : 'none' }}>
                  {v === 'pdf' ? '📄 PDF' : '📋 Table'}
                </button>
              ))}
            </div>
            <button onClick={onClose}
              style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, fontSize: 16, transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.danger; e.currentTarget.style.color = T.danger }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted }}>
              ✕
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: T.textMuted, fontSize: 14 }}>
              <div style={{ width: 20, height: 20, border: `2px solid ${T.border}`, borderTopColor: T.blue, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              กำลังโหลด...
            </div>
          ) : view === 'pdf' ? (
            pdfSrc ? (
              <iframe src={pdfSrc} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Preview" />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.textMuted, fontSize: 14 }}>ไม่พบไฟล์ PDF</div>
            )
          ) : (
            /* Table view */
            <div style={{ height: '100%', overflowY: 'auto', overflowX: 'auto', padding: 20 }}>
              {rows.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: T.textMuted }}>ไม่มีข้อมูล</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={th}>Mode</th>
                      <th style={th}>Assumption</th>
                      <th style={{ ...th, width: 80 }}>Picture</th>
                      <th style={th}>Action</th>
                      <th style={{ ...th, width: 80 }}>Picture</th>
                      <th style={{ ...th, whiteSpace: 'nowrap' }}>Due Date</th>
                      <th style={th}>PIC</th>
                      <th style={{ ...th, width: 64 }}>Progress</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? T.rowEven : T.rowOdd }}>
                        <td style={{ ...td, fontWeight: 700, color: r.modeName ? T.blue : T.textMuted, background: r.modeName ? T.blueSoft : undefined }}>{r.modeName || '—'}</td>
                        <td style={{ ...td, maxWidth: 200, whiteSpace: 'pre-wrap', textAlign: 'left' }}>{r.assumptionDetail || '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          {r.assumptionPicture
                            ? <img src={r.assumptionPicture} style={{ width: 60, height: 48, objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.border}` }} />
                            : <span style={{ color: T.textMuted }}>—</span>}
                        </td>
                        <td style={{ ...td, maxWidth: 200, whiteSpace: 'pre-wrap', textAlign: 'left' }}>{r.actionDetail || '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          {r.actionPicture
                            ? <img src={r.actionPicture} style={{ width: 60, height: 48, objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.border}` }} />
                            : <span style={{ color: T.textMuted }}>—</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'center', fontSize: 11, color: T.textSub }}>
                          {r.dueDateStart || r.dueDateEnd
                            ? <>{r.dueDateStart}<br /><span style={{ color: T.textMuted }}>–</span><br />{r.dueDateEnd}</>
                            : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.pic || '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}><PizzaDisplay value={r.progress} /></td>
                        <td style={{ ...td, textAlign: 'center' }}><StatusBadge value={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
const DeleteModal = ({ title, onConfirm, onCancel, loading }: { title: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) => (
  <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(17,24,39,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: T.surface, borderRadius: 14, padding: '28px 32px', maxWidth: 380, width: '90%', boxShadow: T.shadowMd, border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>🗑️</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>ลบ Report</div>
          <div style={{ fontSize: 12, color: T.textSub }}>ไม่สามารถกู้คืนได้</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#555', margin: 0, lineHeight: 1.6, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px' }}>
        ต้องการลบ <strong>"{title}"</strong> ออกจากระบบ?
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, fontSize: 13, cursor: 'pointer', color: T.textSub }}>ยกเลิก</button>
        <button onClick={onConfirm} disabled={loading}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: loading ? '#f87171' : T.danger, color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', transition: 'background .15s' }}>
          {loading ? 'กำลังลบ…' : 'ลบออก'}
        </button>
      </div>
    </div>
  </div>
)

// ─── Format date ─────────────────────────────────────────────────────────────
function fmtDatetime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function TableReportPage() {
  const [reports, setReports]       = useState<SubmittedReport[]>([])
  const [loading, setLoading]       = useState(true)
  const [previewNo, setPreviewNo]   = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SubmittedReport | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [toast, setToast]           = useState<{ msg: string; color: string } | null>(null)
  const [search, setSearch]         = useState('')

  const fetchReports = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/submitted-reports`, { headers: authHeaders() })
      if (res.ok) setReports(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchReports() }, [fetchReports])

  const showToast = (msg: string, color = T.blue) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2400)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API}/submitted-reports/${deleteTarget.no}`, { method: 'DELETE', headers: authHeaders() })
      if (res.ok || res.status === 204) {
        setReports(prev => prev.filter(r => r.no !== deleteTarget.no))
        showToast('ลบสำเร็จ', '#059669')
      } else {
        showToast('เกิดข้อผิดพลาด', T.danger)
      }
    } catch { showToast('เกิดข้อผิดพลาด', T.danger) }
    setDeleting(false)
    setDeleteTarget(null)
  }

  const previewReport = previewNo !== null ? reports.find(r => r.no === previewNo) : null

  const filtered = reports.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase())
  )

  const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: T.textMuted, background: T.bg, border: 'none', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const td: React.CSSProperties = { padding: '12px 16px', verticalAlign: 'middle', borderBottom: `1px solid ${T.border}`, fontSize: 13 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg, overflow: 'hidden' }}>

      {/* ─── Toast ─── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9990, background: toast.color, color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: T.shadowMd, display: 'flex', alignItems: 'center', gap: 8, animation: 'slideUp .25s ease' }}>
          <span style={{ fontSize: 16 }}>✓</span>{toast.msg}
        </div>
      )}

      {/* ─── Modals ─── */}
      {previewReport && previewNo !== null && (
        <PdfModal no={previewNo} title={previewReport.title} onClose={() => setPreviewNo(null)} />
      )}
      {deleteTarget && (
        <DeleteModal title={deleteTarget.title} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
      )}

      {/* ─── Header ─── */}
      <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', background: T.surface, borderBottom: `1px solid ${T.border}`, boxShadow: '0 1px 3px rgba(20,98,255,.06)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0, lineHeight: 1.2 }}>Submitted Reports</h1>
          <span style={{ fontSize: 11, color: T.textMuted }}>Table › Report</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, transition: 'border-color .15s' }}
            onFocus={() => {}} >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ report…"
              style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'Sarabun,sans-serif', background: 'transparent', color: T.text, width: 200 }} />
          </div>
          {/* Refresh */}
          <button onClick={fetchReports}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.blue; e.currentTarget.style.color = T.blue }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ─── Stats row ─── */}
      <div style={{ flexShrink: 0, padding: '16px 28px', display: 'flex', gap: 12 }}>
        {[
          { label: 'Report ทั้งหมด', value: reports.length, color: T.blue },
          { label: 'มี PDF', value: reports.filter(r => r.has_pdf).length, color: '#059669' },
        ].map(s => (
          <div key={s.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120, boxShadow: T.shadow }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{loading ? '…' : s.value}</span>
          </div>
        ))}
      </div>

      {/* ─── Table ─── */}
      <div style={{ flex: 1, minHeight: 0, padding: '0 28px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: T.textMuted, fontSize: 14 }}>
              <div style={{ width: 20, height: 20, border: `2px solid ${T.border}`, borderTopColor: T.blue, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              กำลังโหลด…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: T.textMuted }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.3}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <span style={{ fontSize: 14 }}>{search ? 'ไม่พบ report ที่ค้นหา' : 'ยังไม่มี submitted reports'}</span>
              {!search && <span style={{ fontSize: 12 }}>กด Submit ที่หน้า Report Maker เพื่อบันทึก</span>}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 48, textAlign: 'center' }}>#</th>
                    <th style={th}>ชื่อ Report</th>
                    <th style={{ ...th, width: 180 }}>วันที่ Submit</th>
                    <th style={{ ...th, width: 80, textAlign: 'center' }}>PDF</th>
                    <th style={{ ...th, width: 120, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rep, i) => (
                    <tr key={rep.no}
                      style={{ background: i % 2 === 0 ? T.rowEven : T.rowOdd, transition: 'background .1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.blueSoft)}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? T.rowEven : T.rowOdd)}>
                      <td style={{ ...td, textAlign: 'center', color: T.textMuted, fontWeight: 600 }}>{i + 1}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: T.text, marginBottom: 2 }}>{rep.title}</div>
                      </td>
                      <td style={{ ...td, color: T.textSub, fontSize: 12 }}>{fmtDatetime(rep.submitted_at)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {rep.has_pdf ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: '#ECFDF5', color: '#059669', fontSize: 11, fontWeight: 700, border: '1px solid #A7F3D0' }}>
                            ✓ พร้อม
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: T.textMuted }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          {/* View button */}
                          <button onClick={() => setPreviewNo(rep.no)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 7, border: `1px solid #D1E0FF`, background: T.blueSoft, color: T.blue, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .12s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = T.blue; e.currentTarget.style.color = '#fff' }}
                            onMouseLeave={e => { e.currentTarget.style.background = T.blueSoft; e.currentTarget.style.color = T.blue }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            ดู
                          </button>
                          {/* Delete button */}
                          <button onClick={() => setDeleteTarget(rep)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: `1px solid rgba(192,0,26,.25)`, background: 'rgba(192,0,26,.06)', color: T.danger, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Sarabun,sans-serif', transition: 'all .12s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = T.danger; e.currentTarget.style.color = '#fff' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(192,0,26,.06)'; e.currentTarget.style.color = T.danger }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes slideUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  )
}