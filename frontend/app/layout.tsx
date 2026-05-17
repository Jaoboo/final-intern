import type { Metadata } from "next";
import { Anaheim, Sarabun } from "next/font/google";
import "./globals.css";
import Sidebar from './components/Sidebar'
import { cookies, headers } from 'next/headers'

const anaheim = Anaheim({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-anaheim',
  display: 'swap',
})

const sarabun = Sarabun({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  variable: '--font-sarabun',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "DENSO Defect Tracking",
  description: "Defect Tracking System",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const headersList = await headers()

  const pathname = headersList.get('x-pathname') ?? ''
  const role = headersList.get('x-role') ?? 'operator'
  const fullName = headersList.get('x-fullname') ?? ''
  const department = headersList.get('x-department') ?? ''

  const isAuthPage = pathname.startsWith('/auth/')
  const sidebarOpen = !isAuthPage && cookieStore.get('sidebar-open')?.value === 'true'
  const sidebarExpanded = cookieStore.get('sidebar-expanded')?.value ?? null

  return (
    <html lang="th" className={`${anaheim.variable} ${sarabun.variable}`}>
      <body style={{
        margin: 0,
        fontFamily: "var(--font-anaheim), var(--font-sarabun), sans-serif",
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',      // ← flex row แทน fixed+margin
        flexDirection: 'row',
      }}>
        {!isAuthPage && (
          <Sidebar
            initialOpen={sidebarOpen}
            initialExpanded={sidebarExpanded}
            role={role}
            fullName={fullName}
            department={department}
          />
        )}
        <main style={{
          flex: 1,
          minWidth: 0,          // ← ป้องกัน flex child overflow
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {children}
        </main>
      </body>
    </html>
  )
}