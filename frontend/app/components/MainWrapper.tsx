'use client'
import { useEffect, useState } from 'react'

function getCookieValue(name: string) {
  return document.cookie
    .split('; ')
    .find(r => r.startsWith(name + '='))
    ?.split('=')[1]
}

export default function MainWrapper({
  children,
  initialOpen,
  isAuthPage,
}: {
  children: React.ReactNode
  initialOpen: boolean
  isAuthPage: boolean
}) {
  const [open, setOpen] = useState(initialOpen)

  useEffect(() => {
    if (isAuthPage) return

    // ฟัง custom event ที่ Sidebar จะ dispatch ตอน toggle
    const handler = (e: Event) => {
      setOpen((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener('sidebar-toggle', handler)
    return () => window.removeEventListener('sidebar-toggle', handler)
  }, [isAuthPage])

  return (
    <main
      style={{
        marginLeft: isAuthPage ? '0' : open ? '220px' : '56px',
        minHeight: '100vh',
        transition: 'margin-left 0.25s ease',
      }}
    >
      {children}
    </main>
  )
}