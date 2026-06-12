// Built by vsrupeshkumar
// Sign-In With Ethereum (SIWE) — proves a request actually owns the wallet it
// claims. Without this, every endpoint trusted a client-supplied ?wallet=, so
// anyone could read/write anyone's data. Flow: client gets a nonce, signs a
// message with their wallet, server verifies the signature and issues an
// HMAC-signed session cookie carrying the verified address. Per-user write
// endpoints then derive the wallet from the SESSION, not the request body.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { verifyMessage } from 'viem'

const COOKIE = 'rwakins_session'
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SECRET = process.env.AUTH_SECRET || process.env.CRON_SECRET || 'rwakins-dev-secret-change-me'

// Issued nonces (single-use, short-lived) — replay protection.
const nonces = new Map<string, number>()
const NONCE_TTL = 10 * 60_000

export function issueNonce(): string {
  const n = randomBytes(16).toString('hex')
  nonces.set(n, Date.now())
  // opportunistic cleanup
  const cutoff = Date.now() - NONCE_TTL
  for (const [k, t] of nonces) if (t < cutoff) nonces.delete(k)
  return n
}

function consumeNonce(n: string): boolean {
  const t = nonces.get(n)
  if (t == null || Date.now() - t > NONCE_TTL) return false
  nonces.delete(n)
  return true
}

export function siweMessage(address: string, nonce: string): string {
  return (
    `RWAkins wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Sign in to your AI CFO. This request will not trigger a transaction or cost gas.\n\n` +
    `Nonce: ${nonce}`
  )
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex')
}

/** Build a signed session cookie value for a verified address. */
export function makeSession(address: string): string {
  const exp = Date.now() + TTL_MS
  const payload = `${address.toLowerCase()}.${exp}`
  return `${payload}.${sign(payload)}`
}

/** Verify + parse a session cookie → the verified address, or null. */
function parseSession(value: string | undefined): string | null {
  if (!value) return null
  const i = value.lastIndexOf('.')
  if (i < 0) return null
  const payload = value.slice(0, i)
  const mac = value.slice(i + 1)
  const expected = sign(payload)
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const [address, expStr] = payload.split('.')
  if (!address || !expStr || Date.now() > Number(expStr)) return null
  return address.toLowerCase()
}

function cookieFromReq(req: Request): string | undefined {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/** The authenticated address for this request (from the session cookie), or null. */
export function getSessionAddress(req: Request): string | null {
  return parseSession(cookieFromReq(req))
}

/** Verify a SIWE signature against an issued nonce. Returns true on success. */
export async function verifySiwe(address: string, nonce: string, signature: string): Promise<boolean> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return false
  if (!consumeNonce(nonce)) return false
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message: siweMessage(address, nonce),
      signature: signature as `0x${string}`,
    })
  } catch {
    return false
  }
}

export const SESSION_COOKIE = COOKIE
export const SESSION_MAX_AGE = Math.floor(TTL_MS / 1000)

/**
 * Guard for a per-user request: the session must exist AND match the wallet the
 * request is acting on. Returns an error string, or null when authorised.
 */
export function requireSelf(req: Request, wallet: string): string | null {
  const session = getSessionAddress(req)
  if (!session) return 'NOT_AUTHENTICATED'
  if (session !== wallet.toLowerCase()) return 'WALLET_MISMATCH'
  return null
}
