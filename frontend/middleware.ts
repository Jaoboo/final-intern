import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const SECRET_KEY = new TextEncoder().encode('change-this-to-random-64-char-string')

const PUBLIC_PATHS = ['/auth/signin', '/auth/signup']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Static / API → ผ่านเลย
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Auth pages
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const token = req.cookies.get('access_token')?.value
    if (token) {
      try {
        await jwtVerify(token, SECRET_KEY)
        return NextResponse.redirect(new URL('/home/daily-monitoring', req.url))
      } catch {
        // token invalid → เข้า signin ได้ปกติ
      }
    }
    // ★ ต้อง set x-pathname เสมอ ให้ layout รู้ว่าเป็นหน้า auth → ซ่อน Sidebar
    const res = NextResponse.next()
    res.headers.set('x-pathname', pathname)
    return res
  }

  // Root → redirect signin
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/auth/signin', req.url))
  }

  // Protected routes — ต้องมี token
  const token = req.cookies.get('access_token')?.value
  if (!token) {
    const loginUrl = new URL('/auth/signin', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Verify JWT
  let payload: any
  try {
    const { payload: p } = await jwtVerify(token, SECRET_KEY)
    payload = p
  } catch {
    const res = NextResponse.redirect(new URL('/auth/signin', req.url))
    res.cookies.delete('access_token')
    return res
  }

  // Role-based access control
  const role: string = payload.role ?? 'operator'
  const adminOnly = ['/home/tsd-expense', '/form/tsd', '/table/tsd', '/analysis', '/report', '/users']

  if (adminOnly.some(p => pathname.startsWith(p)) && role === 'operator') {
    return NextResponse.redirect(new URL('/form/defect', req.url))
  }

  // ส่ง user info ให้ layout ผ่าน headers
  const res = NextResponse.next()
  res.headers.set('x-pathname', pathname)
  res.headers.set('x-role', role)
  res.headers.set('x-fullname', payload.full_name ?? '')
  res.headers.set('x-department', payload.department ?? '')

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}