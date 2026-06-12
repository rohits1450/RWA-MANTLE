// Built by vsrupeshkumar
// POST /api/rebalance/relay — GASLESS rebalance relayer. The user signs an EIP-712
// RebalanceIntent in their browser (free, no gas), and this endpoint submits it
// on-chain via vault.rebalanceWithSig using the AGENT key, which pays the gas. The
// signature proves the user authorised this exact allocation, so it's non-custodial
// in spirit (the agent can't move funds the user didn't sign for). This is what
// makes manual rebalances Web2-friendly: connect, click, sign — never pay gas.
import { NextResponse } from 'next/server'
import { type Address, parseSignature } from 'viem'
import { VAULT_ABI } from '@/lib/rwa/abi'
import { getAgentWallet, publicClient } from '@/lib/rwa/serverVault'
import deployed from '@/lib/rwa-deployed.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Body {
  user?: string
  usdyBps?: number
  methBps?: number
  nonce?: string
  deadline?: string
  signature?: string
}

export async function POST(req: Request) {
  let b: Body
  try { b = await req.json() } catch { return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 }) }

  if (!/^0x[a-fA-F0-9]{40}$/.test(b.user ?? '')) {
    return NextResponse.json({ ok: false, error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  if (typeof b.usdyBps !== 'number' || typeof b.methBps !== 'number' || !b.signature || !b.nonce || !b.deadline) {
    return NextResponse.json({ ok: false, error: 'MISSING_FIELDS' }, { status: 400 })
  }

  const signer = getAgentWallet()
  if (!signer) return NextResponse.json({ ok: false, error: 'RELAYER_UNAVAILABLE' }, { status: 503 })

  const { r, s, v, yParity } = parseSignature(b.signature as `0x${string}`)
  const vByte = Number(v ?? (yParity === 1 ? 28 : 27))

  try {
    const hash = await signer.wallet.writeContract({
      address: deployed.vault as Address,
      abi: VAULT_ABI,
      functionName: 'rebalanceWithSig',
      args: [b.user as Address, BigInt(b.usdyBps), BigInt(b.methBps), BigInt(b.nonce), BigInt(b.deadline), vByte, r, s],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return NextResponse.json({ ok: true, txHash: hash, gasless: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'RELAY_FAILED' }, { status: 502 })
  }
}
