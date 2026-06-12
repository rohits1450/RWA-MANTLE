// Built by vsrupeshkumar
// POST /api/auth/verify { address, nonce, signature } — verifies the SIWE
// signature and, on success, sets an HMAC-signed session cookie for the wallet.
import { NextResponse } from 'next/server'
import { verifySiwe, makeSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let b: { address?: string; nonce?: string; signature?: string }
  try { b = await req.json() } catch { return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 }) }
  const { address, nonce, signature } = b
  if (!address || !nonce || !signature) {
    return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 })
  }
  const ok = await verifySiwe(address, nonce, signature)
  if (!ok) return NextResponse.json({ ok: false, error: 'INVALID_SIGNATURE' }, { status: 401 })

  const res = NextResponse.json({ ok: true, address: address.toLowerCase() })
  res.cookies.set(SESSION_COOKIE, makeSession(address), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
