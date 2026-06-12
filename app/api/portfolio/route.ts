// Built by vsrupeshkumar
// GET /api/portfolio?wallet=0x… — the dashboard's single, reliable read of a
// wallet's vault position + live yields + live mETH price. Runs server-side over
// the resilient multi-endpoint RPC (lib/rwa/rpc), so the browser makes ONE call
// that doesn't fail when the canonical public RPC throttles — instead of three
// flaky client-side reads that used to crash into a fake demo position.
import { NextResponse } from 'next/server'
import { type Address } from 'viem'
import {
  isVaultDeployed, readPortfolioServer, readYieldsServer, readMethPriceServer, publicClient,
} from '@/lib/rwa/serverVault'
import { VAULT_ABI } from '@/lib/rwa/abi'
import deployed from '@/lib/rwa-deployed.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get('wallet') ?? ''
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ ok: false, error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  if (!isVaultDeployed) {
    return NextResponse.json({ ok: false, error: 'VAULT_NOT_DEPLOYED' }, { status: 503 })
  }
  try {
    const [pos, yields, methPriceUsd, feeBps] = await Promise.all([
      readPortfolioServer(wallet as Address),
      readYieldsServer(),
      readMethPriceServer(),
      publicClient.readContract({ address: deployed.vault as Address, abi: VAULT_ABI, functionName: 'feeBps' }) as Promise<bigint>,
    ])
    return NextResponse.json({
      ok: true,
      // bigints → decimal strings; the client converts with formatEther.
      usdyBal: pos.usdyBal.toString(),
      methBal: pos.methBal.toString(),
      usdyBps: Number(pos.usdyBps),
      methBps: Number(pos.methBps),
      usdyApyBps: yields.usdyApyBps,
      methApyBps: yields.methApyBps,
      methPriceUsd,
      feeBps: Number(feeBps),
    })
  } catch (e) {
    // The resilient RPC already retried every endpoint; a failure here is a real
    // outage, not a blip. Report it so the client can show "reconnecting" rather
    // than fabricating a position.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'READ_FAILED' },
      { status: 502 },
    )
  }
}
