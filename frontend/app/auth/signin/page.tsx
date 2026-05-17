'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react'

export default function SignInPage() {
  const [workNumber, setWorkNumber] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async () => {
    setError('')
    if (!workNumber || !password) {
      setError('Please enter your employee number and password')
      return
    }
    setLoading(true)
    try {
      // เรียกผ่าน Next.js API route เพื่อให้ set cookie ฝั่ง server
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_number: workNumber, password }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'เข้าสู่ระบบไม่สำเร็จ')
        return
      }

      router.push('/home/daily-monitoring')
      router.refresh()
    } catch {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1829 0%, #1a2540 45%, #0f2060 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Geist Sans', 'Segoe UI', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Background decorations */}
      <div style={{
        position: 'absolute', top: '-120px', right: '-120px',
        width: '480px', height: '480px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-80px', left: '-80px',
        width: '360px', height: '360px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Grid pattern */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: '400px',
        margin: '24px',
        background: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '24px',
        padding: '40px 36px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset',
        position: 'relative',
      }}>

        {/* Logo & Title */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ margin: 0, color: 'white', fontSize: '22px', fontWeight: 700, letterSpacing: '-0.3px' }}>
            DENSO Defect Tracking
          </h1>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '20px',
            color: '#f87171', fontSize: '13px',
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* Work Number */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            display: 'block', color: 'rgba(255,255,255,0.55)',
            fontSize: '12px', fontWeight: 600, marginBottom: '7px',
            letterSpacing: '0.5px', textTransform: 'uppercase',
          }}>
            Employee Number
          </label>
          <input
            type="text"
            value={workNumber}
            onChange={e => setWorkNumber(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="EMP001"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '12px', padding: '13px 16px',
              color: 'white', fontSize: '14px',
              outline: 'none', letterSpacing: '0.5px',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'rgba(37,99,235,0.7)'
              e.target.style.background = 'rgba(255,255,255,0.09)'
            }}
            onBlur={e => {
              e.target.style.borderColor = 'rgba(255,255,255,0.12)'
              e.target.style.background = 'rgba(255,255,255,0.06)'
            }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block', color: 'rgba(255,255,255,0.55)',
            fontSize: '12px', fontWeight: 600, marginBottom: '7px',
            letterSpacing: '0.5px', textTransform: 'uppercase',
          }}>
            Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="••••••••"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '12px', padding: '13px 44px 13px 16px',
                color: 'white', fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onFocus={e => {
                e.target.style.borderColor = 'rgba(37,99,235,0.7)'
                e.target.style.background = 'rgba(255,255,255,0.09)'
              }}
              onBlur={e => {
                e.target.style.borderColor = 'rgba(255,255,255,0.12)'
                e.target.style.background = 'rgba(255,255,255,0.06)'
              }}
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute', right: '14px', top: '50%',
                transform: 'translateY(-50%)',
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 0,
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%', padding: '14px',
            background: loading
              ? 'rgba(37,99,235,0.4)'
              : 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
            border: 'none', borderRadius: '12px',
            color: 'white', fontSize: '14px', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            boxShadow: loading ? 'none' : '0 8px 24px rgba(37,99,235,0.35)',
            transition: 'all 0.2s ease',
            letterSpacing: '0.3px',
          }}
        >
          {loading ? (
            <>
              <div style={{
                width: '16px', height: '16px', borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                animation: 'spin 0.8s linear infinite',
              }} />
              กำลังเข้าสู่ระบบ...
            </>
          ) : (
            <>
              <LogIn size={16} />
              Sign in
            </>
          )}
        </button>

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  )
}