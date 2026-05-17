'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutGrid, FileInput, Table2, BarChart2, FileText,
  ArrowLeft, ArrowRight, ChevronDown, ChevronUp, LogOut, Users
} from 'lucide-react'

function setCookie(name: string, value: string, days = 365) {
  document.cookie = `${name}=${value};path=/;max-age=${days * 86400}`
}
function deleteCookie(name: string) {
  document.cookie = `${name}=;path=/;max-age=0`
}

const menuItems = [
  {
    label: 'Dashboard', icon: LayoutGrid,
    allow: ['admin', 'supervisor'],
    children: [
      { label: 'Overview',            href: '/home/overview'          },
      { label: 'Daily Monitoring',    href: '/home/daily-monitoring'  },
      { label: 'TSD-Defect expense',  href: '/home/tsd-expense'       },
    ]
  },
  {
    label: 'Recorded Form', icon: FileInput,
    allow: ['admin', 'supervisor', 'operator'],
    children: [
      { label: 'Volume form',       href: '/form/volume' },
      { label: 'Defect form',       href: '/form/defect' },
      { label: 'TSD-Expense form',  href: '/form/tsd'    },
    ]
  },
  {
    label: 'Data Table', icon: Table2,
    allow: ['admin', 'supervisor', 'operator'],
    children: [
      { label: 'Volume table',      href: '/table/volume' },
      { label: 'Defect table',      href: '/table/defect' },
      { label: 'TSD-Expense table', href: '/table/tsd'    },
    ]
  },
  {
    label: 'Analyze', icon: BarChart2,
    allow: ['admin', 'supervisor'],
    href: '/analysis/trend'
  },
  {
    label: 'Report', icon: FileText,
    allow: ['admin', 'supervisor'],
    href: '/report'
  },
  {
    label: 'Users', icon: Users,
    allow: ['admin'],
    href: '/users'
  },
]

const ROLE_STYLE: Record<string, { bg: string; label: string }> = {
  admin:      { bg: '#ef4444', label: 'Admin' },
  supervisor: { bg: '#f59e0b', label: 'Supervisor' },
  operator:   { bg: '#6366f1', label: 'Operator' },
}

const SIDEBAR_CLOSED = 56
const ICON_SIZE = 36
const ICON_OFFSET = (SIDEBAR_CLOSED - ICON_SIZE) / 2

const fadeStyle = (open: boolean): React.CSSProperties => ({
  opacity: open ? 1 : 0,
  transition: open ? 'opacity 0.2s ease 0.15s' : 'opacity 0.1s ease 0s',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  pointerEvents: open ? 'auto' : 'none',
})

type Props = {
  initialOpen: boolean
  initialExpanded: string | null
  role: string
  fullName: string
  department: string
}

export default function Sidebar({ initialOpen, initialExpanded, role, fullName, department }: Props) {
  const [open, setOpen] = useState(initialOpen)
  const [expanded, setExpanded] = useState<string | null>(initialExpanded)
  const [hovered, setHovered] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    setCookie('sidebar-open', String(next))
    // dispatch event ให้ส่วนอื่นรู้ (ถ้ายังใช้อยู่)
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: next }))
  }

  const toggleMenu = (label: string) => {
    const next = expanded === label ? null : label
    setExpanded(next)
    if (next) setCookie('sidebar-expanded', next)
    else deleteCookie('sidebar-expanded')
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    document.cookie = 'access_token=;path=/;max-age=0'
    document.cookie = 'sidebar-open=;path=/;max-age=0'
    document.cookie = 'sidebar-expanded=;path=/;max-age=0'
    window.location.href = '/auth/signin'
  }

  const visibleMenus = menuItems.filter(item => item.allow.includes(role))
  const roleStyle = ROLE_STYLE[role] ?? ROLE_STYLE.operator
  const avatar = fullName?.[0]?.toUpperCase() ?? 'U'

  const iconBox = (isActive: boolean, isHov: boolean, Icon: any) => (
    <div style={{
      width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '10px',
      background: isActive ? 'white' : isHov ? 'rgba(255,255,255,0.1)' : 'transparent',
      transition: 'all 0.15s ease',
    }}>
      <Icon
        size={20}
        color={isActive ? '#2563eb' : 'rgba(255,255,255,0.65)'}
        strokeWidth={isActive ? 2.5 : 1.8}
      />
    </div>
  )

  return (
    // ── เปลี่ยนจาก position:fixed → relative อยู่ใน flex row ──
    <div style={{
      position: 'relative',           // ← ไม่ fixed แล้ว
      top: 0,
      left: 0,
      zIndex: 100,
      width: open ? '220px' : `${SIDEBAR_CLOSED}px`,
      transition: 'width 0.25s ease',
      height: '100vh',
      flexShrink: 0,                  // ← ไม่ยุบตัวใน flex row
      background: '#1a2540',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Logo + Toggle */}
      <div style={{
        height: '72px', flexShrink: 0,
        display: 'flex', alignItems: 'center',
        paddingLeft: `${ICON_OFFSET}px`,
        paddingRight: '10px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Icon ArrowRight — ตอนปิด */}
        <div
          onClick={handleToggle}
          onMouseEnter={() => setHovered('__toggle__')}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: hovered === '__toggle__' ? 'white' : 'rgba(255,255,255,0.65)',
            opacity: open ? 0 : 1,
            transform: open ? 'scale(0.7)' : 'scale(1)',
            transition: 'opacity 0.2s ease, transform 0.2s ease, color 0.15s ease',
            position: 'absolute',
            cursor: 'pointer',
          }}>
          <ArrowRight size={20} />
        </div>

        {/* Text DENSO */}
        <div style={{
          flex: 1,
          opacity: open ? 1 : 0,
          transform: open ? 'translateX(0)' : 'translateX(-8px)',
          transition: open
            ? 'opacity 0.2s ease 0.1s, transform 0.2s ease 0.1s'
            : 'opacity 0.15s ease 0s, transform 0.15s ease 0s',
          pointerEvents: 'none',
        }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '16px', whiteSpace: 'nowrap' }}>DENSO</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', whiteSpace: 'nowrap' }}>Defect Tracking</div>
        </div>

        {/* Icon ArrowLeft — ตอนเปิด */}
        <div
          onClick={handleToggle}
          onMouseEnter={() => setHovered('__toggle__')}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px`, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: hovered === '__toggle__' ? 'white' : 'rgba(255,255,255,0.45)',
            opacity: open ? 1 : 0,
            transform: open ? 'scale(1)' : 'scale(0.7)',
            transition: open
              ? 'opacity 0.2s ease 0.15s, transform 0.2s ease 0.15s, color 0.15s ease'
              : 'opacity 0.1s ease 0s, transform 0.1s ease 0s, color 0.15s ease',
            cursor: 'pointer',
          }}>
          <ArrowLeft size={18} />
        </div>
      </div>

      {/* Menu */}
      <div style={{ padding: '8px 0', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {visibleMenus.map(item => {
          const Icon = item.icon
          const hasChildren = !!item.children
          const isExpanded = expanded === item.label
          const isActive = hasChildren
            ? item.children!.some(c => pathname === c.href)
            : pathname === item.href
          const isHov = hovered === item.label

          const rowStyle: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            paddingLeft: `${ICON_OFFSET}px`,
            paddingRight: open ? '10px' : `${ICON_OFFSET}px`,
            paddingTop: '5px',
            paddingBottom: '5px',
            margin: open ? '2px 8px' : '2px 0',
            borderRadius: open ? '12px' : '0',
            background: open
              ? isActive ? 'rgba(255,255,255,0.15)' : isHov ? 'rgba(255,255,255,0.07)' : 'transparent'
              : 'transparent',
            color: isActive ? 'white' : isHov ? 'white' : 'rgba(255,255,255,0.65)',
            cursor: 'pointer',
            fontWeight: isActive ? 600 : 400,
            fontSize: '14px',
            transition: 'all 0.25s ease',
            textDecoration: 'none',
          }

          return (
            <div key={item.label}>
              {hasChildren ? (
                <div
                  onClick={() => open && toggleMenu(item.label)}
                  onMouseEnter={() => setHovered(item.label)}
                  onMouseLeave={() => setHovered(null)}
                  style={rowStyle}
                >
                  {iconBox(isActive, isHov, Icon)}
                  <span style={{ ...fadeStyle(open), flex: 1 }}>{item.label}</span>
                  <span style={fadeStyle(open)}>
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </span>
                </div>
              ) : (
                <Link
                  href={item.href!}
                  onMouseEnter={() => setHovered(item.label)}
                  onMouseLeave={() => setHovered(null)}
                  style={rowStyle}
                >
                  {iconBox(isActive, isHov, Icon)}
                  <span style={fadeStyle(open)}>{item.label}</span>
                </Link>
              )}

              <div style={{
                maxHeight: hasChildren && open && isExpanded ? '200px' : '0px',
                overflow: 'hidden',
                transition: 'max-height 0.25s ease',
              }}>
                {hasChildren && item.children!.map(child => {
                  const isChildActive = pathname === child.href
                  const isChildHov = hovered === child.href
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onMouseEnter={() => setHovered(child.href)}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        display: 'block',
                        padding: '8px 12px 8px 58px',
                        color: isChildActive ? 'white' : isChildHov ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)',
                        textDecoration: 'none',
                        fontSize: '13px',
                        fontWeight: isChildActive ? 600 : 400,
                        background: isChildActive
                          ? 'rgba(255,255,255,0.12)'
                          : isChildHov ? 'rgba(255,255,255,0.04)' : 'transparent',
                        borderLeft: isChildActive ? '2px solid white' : '2px solid transparent',
                        transition: 'all 0.15s ease',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {child.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* User + Logout */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          paddingLeft: `${ICON_OFFSET}px`, paddingRight: '10px',
          paddingTop: '12px', paddingBottom: '12px',
        }}>
          {/* Avatar */}
          <div
            onClick={!open ? handleLogout : undefined}
            onMouseEnter={() => !open && setHovered('__logout__')}
            onMouseLeave={() => !open && setHovered(null)}
            style={{
              width: '32px', height: '32px', flexShrink: 0,
              borderRadius: '50%',
              background: !open && hovered === '__logout__' ? '#ef4444' : roleStyle.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: 700, color: 'white',
              cursor: !open ? 'pointer' : 'default',
              transition: 'background 0.15s ease',
            }}
          >
            {!open && hovered === '__logout__'
              ? <LogOut size={14} />
              : avatar}
          </div>

          {/* Name + dept + role */}
          <div style={{ ...fadeStyle(open), flex: 1, minWidth: 0 }}>
            <div style={{ color: 'white', fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fullName}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>{department}</span>
              <span style={{
                background: roleStyle.bg, color: 'white', fontSize: '9px', fontWeight: 700,
                padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                {roleStyle.label}
              </span>
            </div>
          </div>

          {/* Logout icon — ตอนเปิด */}
          <div
            onClick={open ? handleLogout : undefined}
            onMouseEnter={() => open && setHovered('__logout__')}
            onMouseLeave={() => open && setHovered(null)}
            style={{
              ...fadeStyle(open),
              width: '28px', height: '28px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '8px',
              color: hovered === '__logout__' ? '#f87171' : 'rgba(255,255,255,0.35)',
              cursor: 'pointer',
              transition: 'color 0.15s ease, background 0.15s ease',
              background: hovered === '__logout__' ? 'rgba(239,68,68,0.12)' : 'transparent',
            }}
          >
            <LogOut size={15} />
          </div>
        </div>
      </div>
    </div>
  )
}