import { NextRequest, NextResponse } from 'next/server'

const BACKEND = 'http://localhost:8000'

async function proxyRequest(req: NextRequest, path: string) {
  // รับ token จาก Authorization header ที่ client ส่งมาโดยตรง
  // (client อ่านจาก document.cookie แล้วแนบมาใน header)
  const authHeader = req.headers.get('Authorization') ?? ''

  // fallback: ลองอ่านจาก cookie ถ้าไม่มี header
  const cookieToken = req.cookies.get('access_token')?.value ?? ''
  const token = authHeader || (cookieToken ? `Bearer ${cookieToken}` : '')

  if (!token) {
    return new NextResponse(JSON.stringify({ detail: 'ไม่พบ token กรุณา login ใหม่' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': token,
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