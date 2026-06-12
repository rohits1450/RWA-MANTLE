// Built by vsrupeshkumar
// POST /api/compliance/screen { wallet, jurisdiction, context } — AI-assisted KYC.
// Screens a prospective holder (hard OFAC block in code + LLM risk assessment),
// then writes the verdict ON-CHAIN to the ComplianceRegistry via the agent
// compliance-officer key. The vault gates deposits on this, so a user can't enter
// a position until they've been screened. Fully auditable (on-chain event + tx).
import { NextResponse } from 'next/server'
import { type Address, stringToHex } from 'viem'
import { screenCompliance } from '@/lib/compliance'
import { COMPLIANCE_ABI } from '@/lib/rwa/abi'
import { getAgentWallet, publicClient } from '@/lib/rwa/serverVault'
import deployed from '@/lib/rwa-deployed.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ONE_YEAR = 365 * 24 * 60 * 60

export async function POST(req: Request) {
  let body: { wallet?: string; jurisdiction?: string; context?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 }) }

  const wallet = (body.wallet ?? '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ ok: false, error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  if (!body.jurisdiction?.trim()) {
    return NextResponse.json({ ok: false, error: 'JURISDICTION_REQUIRED' }, { status: 400 })
  }

  // 1) Screen (hard rules in code + LLM risk assessment).
  const verdict = await screenCompliance(body.jurisdiction, body.context ?? '')

  // 2) Record the verdict on-chain (agent compliance officer key).
  const registry = (deployed as { registry?: string }).registry as Address | undefined
  const signer = getAgentWallet()
  let txHash: string | null = null
  if (registry && signer) {
    const expiry = verdict.eligible ? BigInt(Math.floor(Date.now() / 1000) + ONE_YEAR) : BigInt(0)
    try {
      txHash = await signer.wallet.writeContract({
        address: registry,
        abi: COMPLIANCE_ABI,
        functionName: 'setCompliance',
        args: [
          wallet as Address,
          verdict.eligible,
          verdict.accredited,
          verdict.riskScore,
          stringToHex(verdict.jurisdiction.slice(0, 2), { size: 2 }),
          expiry,
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'ON_CHAIN_WRITE_FAILED', verdict },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({ ok: true, verdict, txHash, recordedOnChain: !!txHash })
}
