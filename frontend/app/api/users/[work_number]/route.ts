import { NextRequest, NextResponse } from 'next/server'

const BACKEND = 'http://localhost:8000'

async function proxyRequest(req: NextRequest, path: string) {
  // ลอง cookie ทั้งสองชื่อ (บาง auth flow ใช้ต่างกัน)
  const token =
    req.cookies.get('access_token')?.value ??
    req.cookies.get('token')?.value ??
    ''

  // Debug — ดูใน terminal ว่า token มีค่ามั้ย
  console.log('[proxy]', req.method, path, '| token:', token ? token.slice(0, 20) + '...' : 'EMPTY')

  if (!token) {
    return new NextResponse(JSON.stringify({ detail: 'ไม่พบ token กรุณา login ใหม่' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  let body: string | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.text()
  }

  const res = await fetch(`${BACKEND}${path}`, {
    method: req.method,
    headers,
    body,
  })

  const data = await res.text()
  return new NextResponse(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, '/users/')
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, '/users/')
}