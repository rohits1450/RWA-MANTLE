// Built by vsrupeshkumar
// POST /api/auth/nonce { address } — issues a single-use nonce + the exact SIWE
// message to sign (so the client and server never disagree on the string).
import { NextResponse } from 'next/server'
import { issueNonce, siweMessage } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let address = ''
  try { address = String(((await req.json()) as { address?: string }).address ?? '') } catch { /* ignore */ }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  const nonce = issueNonce()
  return NextResponse.json({ nonce, message: siweMessage(address, nonce) })
}
