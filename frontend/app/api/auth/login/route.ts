import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { work_number, password } = body

  const form = new URLSearchParams()
  form.append('username', work_number)
  form.append('password', password)

  try {
    const res = await fetch('http://localhost:8000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })

    if (!res.ok) {
      const data = await res.json()
      return NextResponse.json(
        { error: data.detail ?? 'เข้าสู่ระบบไม่สำเร็จ' },
        { status: 401 }
      )
    }

    const { access_token } = await res.json()

    const response = NextResponse.json({ ok: true })
    response.cookies.set('access_token', access_token, {
      httpOnly: false,
      path: '/',
      maxAge: 60 * 60 * 8,
      sameSite: 'lax',
    })
    return response

  } catch (err: any) {
    // Backend ไม่ได้รัน หรือ network error
    if (err?.cause?.code === 'ECONNREFUSED' || err?.message?.includes('fetch')) {
      return NextResponse.json(
        { error: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend กำลังรันอยู่' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' },
      { status: 500 }
    )
  }
}