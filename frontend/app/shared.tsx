// ─────────────────────────────────────────────────────────────────────────────
//  shared.ts  —  ค่าคงที่, Types, และ Helpers ร่วมของทั้งโปรเจค
//  import ใช้ได้จากทุกไฟล์: import { API, ... } from '@/shared'
// ─────────────────────────────────────────────────────────────────────────────

// ── API Base URL ──────────────────────────────────────────────────────────────
export const API = 'http://localhost:8000'

// ── Auth Helper ───────────────────────────────────────────────────────────────
export function getToken(): string {
  if (typeof document === 'undefined') return ''
  return (
    document.cookie
      .split('; ')
      .find(r => r.startsWith('access_token='))
      ?.split('=')[1] ?? ''
  )
}

export function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  }
}

/** อ่าน payload จาก JWT cookie (ไม่ต้องใช้ library) */
export function getTokenPayload(): {
  sub?: string
  full_name?: string
  role?: string
  department?: string
  position?: string
} | null {
  try {
    const token = getToken()
    if (!token) return null
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

// ── Role ──────────────────────────────────────────────────────────────────────
export type Role = 'admin' | 'supervisor' | 'operator'

export const ROLE_STYLE: Record<Role, { bg: string; label: string }> = {
  admin:      { bg: '#ef4444', label: 'Admin' },
  supervisor: { bg: '#f59e0b', label: 'Supervisor' },
  operator:   { bg: '#6366f1', label: 'Operator' },
}

// ── QR / Model Types ──────────────────────────────────────────────────────────
export interface QRData {
  part_no:         string
  model:           string
  line:            string
  core_no:         string
  date:            string
  time:            string
  work_tag:        string
  ph_top:          string
  die_list_ph_top: string
  ph_btm:          string
  die_list_ph_btm: string
  th_top:          string
  th_btm:          string
  [key: string]:   string
}

export interface QREntry {
  raw:  string
  data: QRData
}

// ── Defect Types ──────────────────────────────────────────────────────────────
export interface DefectInfo {
  defect_item:       string
  defect_mode:       string
  defect_code:       string
  defect_by_process: string
  defect_type:       string
}

export interface DefectRow {
  id:         string
  qrEntry:    QREntry
  defectInfo: DefectInfo
  defectRaw:  string
}

// ── Volume / Defect Record Types (จาก API /records/*) ────────────────────────
export interface VolumeRecord {
  no:              number
  date_day:        string
  time:            string
  line:            string
  model:           string
  quantity:        number
  part_no:         string
  production_date: string
  ph_top:          string
  die_list_ph_top: string
  ph_btm:          string
  die_list_ph_btm: string
  th_top:          string
  th_btm:          string
  shift:           string
  group:           string
  shift_group:     string
}

export interface DefectRecord {
  no:                number
  name:              string
  date_day:          string
  time:              string
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
  model_qr:          string
  defect_qr:         string
  shift:             string
  group:             string
  shift_group:       string
  line:              string
}

// ── Report Types ──────────────────────────────────────────────────────────────
export interface ReportRecord {
  no:                number
  mode:              string
  assumption_detail: string
  action_detail:     string
  date_day:          string
  pic:               string
  progress:          number
  status:            string
}

// ── Employee Types ────────────────────────────────────────────────────────────
export interface Employee {
  work_number: string
  full_name:   string
  department:  string
  position:    string
  role:        Role
  is_active:   boolean
}

// ── Analyze Types ─────────────────────────────────────────────────────────────
export interface AnalyzeSummary {
  defectRatio:      number | null
  defectByShift:    { shift: string; count: number }[]
  defectByDayNight: { label: string; count: number }[]
  defectByModel:    { model: string; count: number }[]
  defectByCoreNo:   { core_no: string; count: number }[]
  tableRows:        Record<string, string | number>[]
  tankTop:          { label: string; value: number }[]
  tankBtm:          { label: string; value: number }[]
  phTop:            { label: string; value: number }[]
  phBtm:            { label: string; value: number }[]
}

export interface DailyTrendItem {
  date:           string
  volume:         number
  total_defect:   number
  defect_after:   number
  defect_before:  number
  ratio:          number
  ratio_after:    number
  ratio_before:   number
  by_mode:        Record<string, number>
}

export interface CorrectionNote {
  note_date:      string
  line:           string
  defect_type:    string
  changing_point: string
  created_at:     string
}

// ── Filter State ──────────────────────────────────────────────────────────────
export interface FilterState {
  startDate:   string
  endDate:     string
  model:       string
  line:        string
  shift:       string
  defectMode:  string
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export interface ToastMsg {
  id:      number
  message: string
  type:    'error' | 'warn' | 'info'
}

// ── Defect Ratio Targets ──────────────────────────────────────────────────────
export const TARGET_BOTH   = 1.8
export const TARGET_AFTER  = 1.0
export const TARGET_BEFORE = 0.8

export function getTarget(viewType: 'All' | 'after' | 'before'): number {
  if (viewType === 'after')  return TARGET_AFTER
  if (viewType === 'before') return TARGET_BEFORE
  return TARGET_BOTH
}

// ── Chart Colors ──────────────────────────────────────────────────────────────
export const COLORS = ['#FF3399','#00B0F0','#2F5597','#DAE3F3','#FFC000','#C5C0B4','#548235','#FFFF00','#7030A0','#D9D9D9','#FBE3D6','#C55A11','#A6A6A6','#3A3A3A','#FFF2CC']
export const DONUT_COLORS = ['#FF3399','#00B0F0','#2F5597','#DAE3F3','#FFC000','#C5C0B4','#548235','#FFFF00','#7030A0','#D9D9D9','#FBE3D6','#C55A11','#A6A6A6','#3A3A3A','#FFF2CC']

// ── Status Options ────────────────────────────────────────────────────────────
export const STATUS_OPTIONS = [
  { label: 'Pending',     color: '#bbb' },
  { label: 'In Progress', color: '#F5A623' },
  { label: 'Done',        color: '#7BC67A' },
  { label: 'Issue',       color: '#C0001A' },
]

// ── Departments ───────────────────────────────────────────────────────────────
export const DEPARTMENTS = [
  'IT', 'Production', 'Quality', 'Engineering', 'Maintenance', 'Logistics',
]

// ── Empty Defaults ────────────────────────────────────────────────────────────
export const emptyAnalyzeData = (): AnalyzeSummary => ({
  defectRatio:      null,
  defectByShift:    [],
  defectByDayNight: [],
  defectByModel:    [],
  defectByCoreNo:   [],
  tableRows:        [],
  tankTop:          [],
  tankBtm:          [],
  phTop:            [],
  phBtm:            [],
})

// ── Table Cell Styles ─────────────────────────────────────────────────────────
export const thStyle: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left',
  fontSize: 11, fontWeight: 700, color: '#777',
  borderBottom: '1px solid rgba(0,0,0,.08)',
  borderRight: '1px solid rgba(0,0,0,.05)',
  whiteSpace: 'nowrap', background: '#faf9f6',
}
export const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,0,0,.05)',
  borderRight: '1px solid rgba(0,0,0,.05)',
  verticalAlign: 'middle',
}