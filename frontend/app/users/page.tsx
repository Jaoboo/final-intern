'use client'
import { useState, useEffect } from 'react'
import {
  UserPlus, Search, Pencil, PowerOff, Power,
  X, Check, AlertCircle,
} from 'lucide-react'

const API = '/api/users'

const DEPARTMENTS = ['IT', 'Production', 'Quality', 'Engineering', 'Maintenance', 'Logistics']
const ROLES = ['operator', 'supervisor', 'admin'] as const
type Role = typeof ROLES[number]

const ROLE_STYLE: Record<Role, { bg: string; label: string }> = {
  admin:      { bg: '#ef4444', label: 'Admin' },
  supervisor: { bg: '#f59e0b', label: 'Supervisor' },
  operator:   { bg: '#6366f1', label: 'Operator' },
}

type Employee = {
  work_number: string
  full_name:   string
  department:  string
  position:    string
  role:        Role
  is_active:   boolean
}

type ModalMode = 'add' | 'edit' | null

// ── อ่าน token จาก cookie แล้วแนบเป็น Authorization header ──
function getToken(): string {
  if (typeof document === 'undefined') return ''
  return (
    document.cookie
      .split('; ')
      .find(r => r.startsWith('access_token='))
      ?.split('=')[1] ?? ''
  )
}

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
}

// ── Badge ──────────────────────────────────────────────────
function RoleBadge({ role }: { role: Role }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.operator
  return (
    <span style={{
      background: s.bg + '22', color: s.bg,
      border: `1px solid ${s.bg}55`,
      fontSize: '11px', fontWeight: 700,
      padding: '2px 8px', borderRadius: '6px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {s.label}
    </span>
  )
}

// ── Modal ──────────────────────────────────────────────────
function Modal({
  mode, emp, onClose, onSaved,
}: {
  mode: ModalMode
  emp: Employee | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    work_number: emp?.work_number ?? '',
    full_name:   emp?.full_name   ?? '',
    department:  emp?.department  ?? '',
    position:    emp?.position    ?? '',
    role:        (emp?.role ?? 'operator') as Role,
    password:    '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setError('')
    if (!form.full_name || !form.department || !form.position) {
      setError('กรุณากรอกข้อมูลให้ครบ'); return
    }
    if (mode === 'add' && (!form.work_number || !form.password)) {
      setError('Enter the Employee Number & Password'); return
    }
    if (mode === 'add' && form.password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return
    }

    setLoading(true)
    try {
      let res: Response
      if (mode === 'add') {
        res = await authFetch(`${API}/`, {
          method: 'POST',
          body: JSON.stringify(form),
        })
      } else {
        const body: Record<string, unknown> = {
          full_name:  form.full_name,
          department: form.department,
          position:   form.position,
          role:       form.role,
        }
        if (form.password) body.password = form.password
        res = await authFetch(`${API}/${emp!.work_number}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.detail ?? 'เกิดข้อผิดพลาด'); return
      }
      onSaved()
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: '10px', padding: '10px 12px',
    fontSize: '13px', color: '#1e293b', outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', fontWeight: 600,
    color: '#64748b', marginBottom: '5px',
    textTransform: 'uppercase', letterSpacing: '0.4px',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
    }}>
      <div style={{
        background: 'white', borderRadius: '20px', width: '100%', maxWidth: '480px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
        animation: 'slideUp 0.2s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              {mode === 'add' ? 'ADD NEW EMPLOYEE' : 'EDIT'}
            </h2>
            {mode === 'edit' && (
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                {emp?.work_number}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{
            background: '#f1f5f9', border: 'none', borderRadius: '8px',
            width: '32px', height: '32px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '10px', padding: '10px 14px', marginBottom: '16px',
              color: '#ef4444', fontSize: '13px',
            }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {mode === 'add' && (
              <div>
                <label style={labelStyle}>Employee Number</label>
                <input
                  value={form.work_number}
                  onChange={e => set('work_number', e.target.value.toUpperCase())}
                  placeholder="EMP001"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = '#2563eb'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>
            )}

            <div style={{ gridColumn: mode === 'add' ? '2' : '1 / -1' }}>
              <label style={labelStyle}>Name</label>
              <input
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                placeholder="ชื่อ นามสกุล"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#2563eb'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            <div>
              <label style={labelStyle}>Department</label>
              <select
                value={form.department}
                onChange={e => set('department', e.target.value)}
                style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
                onFocus={e => e.target.style.borderColor = '#2563eb'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              >
                <option value="">choose</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Position</label>
              <input
                value={form.position}
                onChange={e => set('position', e.target.value)}
                placeholder="ตำแหน่งงาน"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#2563eb'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Role</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {ROLES.map(r => (
                  <button key={r} onClick={() => set('role', r)} style={{
                    flex: 1, padding: '9px 8px', borderRadius: '10px',
                    border: form.role === r ? `1.5px solid ${ROLE_STYLE[r].bg}` : '1.5px solid #e2e8f0',
                    background: form.role === r ? ROLE_STYLE[r].bg + '15' : 'white',
                    color: form.role === r ? ROLE_STYLE[r].bg : '#94a3b8',
                    fontSize: '12px', fontWeight: form.role === r ? 700 : 400,
                    cursor: 'pointer', transition: 'all 0.15s ease',
                    fontFamily: 'inherit',
                  }}>
                    {ROLE_STYLE[r].label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>
                {mode === 'add' ? 'Password' : 'New Password'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder={mode === 'add' ? 'อย่างน้อย 6 ตัวอักษร' : 'เว้นว่างถ้าไม่ต้องการเปลี่ยน'}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#2563eb'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: '10px', justifyContent: 'flex-end',
          padding: '16px 24px', borderTop: '1px solid #f1f5f9',
        }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: '10px',
            background: '#f1f5f9', border: 'none', color: '#64748b',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            ยกเลิก
          </button>
          <button onClick={handleSave} disabled={loading} style={{
            padding: '10px 20px', borderRadius: '10px',
            background: loading ? '#93c5fd' : '#2563eb',
            border: 'none', color: 'white',
            fontSize: '13px', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            fontFamily: 'inherit',
          }}>
            {loading ? 'กำลังบันทึก...' : <><Check size={14} /> บันทึก</>}
          </button>
        </div>
      </div>
      <style>{`@keyframes slideUp { from { transform:translateY(16px);opacity:0; } to { transform:translateY(0);opacity:1; } }`}</style>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────
export default function UsersPage() {
  const [employees,         setEmployees]         = useState<Employee[]>([])
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState('')
  const [search,            setSearch]            = useState('')
  const [filterRole,        setFilterRole]        = useState<string>('all')
  const [filterStatus,      setFilterStatus]      = useState<string>('active')
  const [modal,             setModal]             = useState<{ mode: ModalMode; emp: Employee | null }>({ mode: null, emp: null })
  const [confirmDeactivate, setConfirmDeactivate] = useState<Employee | null>(null)

  const fetchUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authFetch(`${API}/`)
      if (res.ok) {
        setEmployees(await res.json())
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.detail ?? `Error ${res.status}`)
      }
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

  const handleToggleActive = async (emp: Employee) => {
    await authFetch(`${API}/${emp.work_number}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !emp.is_active }),
    })
    setConfirmDeactivate(null)
    fetchUsers()
  }

  const filtered = employees.filter(e => {
    const matchSearch =
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      e.work_number.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase())
    const matchRole   = filterRole   === 'all' || e.role === filterRole
    const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? e.is_active : !e.is_active)
    return matchSearch && matchRole && matchStatus
  })

  return (
    <div style={{ padding: '32px', background: '#f8fafc', minHeight: '100vh', overflowY: 'auto' }}>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>Users</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
          ดู เพิ่ม แก้ไข และจัดการสิทธิ์พนักงานในระบบ
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '320px' }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ, รหัส, แผนก..."
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px 10px 34px',
              background: 'white', border: '1px solid #e2e8f0',
              borderRadius: '10px', fontSize: '13px', color: '#1e293b',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{
          padding: '10px 12px', background: 'white', border: '1px solid #e2e8f0',
          borderRadius: '10px', fontSize: '13px', color: '#1e293b',
          outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <option value="all">ทุก Role</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_STYLE[r].label}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
          padding: '10px 12px', background: 'white', border: '1px solid #e2e8f0',
          borderRadius: '10px', fontSize: '13px', color: '#1e293b',
          outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">ทั้งหมด</option>
        </select>

        <div style={{ marginLeft: 'auto' }}>
          <button onClick={() => setModal({ mode: 'add', emp: null })} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 18px', background: '#2563eb', border: 'none',
            borderRadius: '10px', color: 'white', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.3)', fontFamily: 'inherit',
          }}>
            <UserPlus size={15} />
            ADD
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'ทั้งหมด',  value: employees.length,                         color: '#2563eb' },
          { label: 'Active',   value: employees.filter(e => e.is_active).length,  color: '#22c55e' },
          { label: 'Inactive', value: employees.filter(e => !e.is_active).length, color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'white', borderRadius: '12px', padding: '14px 20px',
            border: '1px solid #f1f5f9', minWidth: '100px',
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
          color: '#ef4444', fontSize: '13px',
        }}>
          <AlertCircle size={16} />
          {error}
          <button onClick={fetchUsers} style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: '6px',
            background: '#ef4444', border: 'none', color: 'white',
            fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
          }}>ลองใหม่</button>
        </div>
      )}

      <div style={{
        background: 'white', borderRadius: '16px',
        border: '1px solid #f1f5f9', overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr 130px 140px 110px 90px 80px',
          padding: '12px 20px', background: '#f8fafc',
          borderBottom: '1px solid #f1f5f9',
          fontSize: '11px', fontWeight: 700, color: '#94a3b8',
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          <span>Employee Number</span>
          <span>Name</span>
          <span>Department</span>
          <span>Position</span>
          <span>Role</span>
          <span>Status</span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            กำลังโหลด...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#cbd5e1', fontSize: '14px' }}>
            {error ? 'โหลดข้อมูลไม่สำเร็จ' : 'ไม่พบข้อมูลพนักงาน'}
          </div>
        ) : filtered.map((emp, i) => (
          <div
            key={emp.work_number}
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr 130px 140px 110px 90px 80px',
              padding: '14px 20px',
              borderBottom: i < filtered.length - 1 ? '1px solid #f8fafc' : 'none',
              alignItems: 'center', opacity: emp.is_active ? 1 : 0.5,
              transition: 'background 0.15s', cursor: 'default',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#fafbff')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#2563eb', fontFamily: 'monospace' }}>
              {emp.work_number}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>{emp.full_name}</span>
            <span style={{ fontSize: '13px', color: '#64748b' }}>{emp.department}</span>
            <span style={{ fontSize: '13px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {emp.position}
            </span>
            <span><RoleBadge role={emp.role} /></span>
            <span>
              <span style={{
                fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px',
                background: emp.is_active ? '#dcfce7' : '#f1f5f9',
                color: emp.is_active ? '#16a34a' : '#94a3b8',
              }}>
                {emp.is_active ? 'Active' : 'Inactive'}
              </span>
            </span>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                title="แก้ไข"
                onClick={() => setModal({ mode: 'edit', emp })}
                style={{
                  width: '30px', height: '30px', borderRadius: '8px',
                  background: '#f1f5f9', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#dbeafe')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f1f5f9')}
              >
                <Pencil size={13} color="#2563eb" />
              </button>
              <button
                title={emp.is_active ? 'Deactivate' : 'Activate'}
                onClick={() => emp.is_active ? setConfirmDeactivate(emp) : handleToggleActive(emp)}
                style={{
                  width: '30px', height: '30px', borderRadius: '8px',
                  background: emp.is_active ? '#fff1f2' : '#f0fdf4',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {emp.is_active
                  ? <PowerOff size={13} color="#ef4444" />
                  : <Power size={13} color="#22c55e" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDeactivate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
        }}>
          <div style={{
            background: 'white', borderRadius: '16px', padding: '28px',
            maxWidth: '360px', width: '100%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px',
              background: '#fff1f2', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '16px',
            }}>
              <PowerOff size={20} color="#ef4444" />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              Deactivate พนักงาน?
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
              <strong>{confirmDeactivate.full_name}</strong> ({confirmDeactivate.work_number}){' '}
              จะไม่สามารถเข้าสู่ระบบได้ สามารถเปิดใช้งานอีกครั้งได้ภายหลัง
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setConfirmDeactivate(null)} style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                background: '#f1f5f9', border: 'none', color: '#64748b',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>ยกเลิก</button>
              <button onClick={() => handleToggleActive(confirmDeactivate)} style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                background: '#ef4444', border: 'none', color: 'white',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {modal.mode && (
        <Modal
          mode={modal.mode}
          emp={modal.emp}
          onClose={() => setModal({ mode: null, emp: null })}
          onSaved={() => { setModal({ mode: null, emp: null }); fetchUsers() }}
        />
      )}
    </div>
  )
}