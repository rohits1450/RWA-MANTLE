// Built by vsrupeshkumar
// POST /api/agent/check  { wallet } — the "is there anything I should tell you?"
// endpoint for the CONNECTED user. The browser calls this on an interval (and
// after a rebalance), so the notification bell reflects the user's REAL live
// situation even when the Vercel cron isn't the one watching. It runs the same
// brain as the autonomous heartbeat over LIVE market + on-chain data, and when a
// rebalance is genuinely warranted it drops a deduped "action needed" reminder.
//
// It NEVER executes on-chain — the user applies the move with their own wallet via
// Run Rebalance. So this needs no agent key and is safe to call from the client.
import { NextResponse } from 'next/server'
import { type Address } from 'viem'
import { getIntent } from '@/lib/intentStore'
import { getMarketData } from '@/lib/marketData'
import { getLastUsdyApy } from '@/lib/yieldHistory'
import { decideDirection, computeAllocation } from '@/lib/agent/brain'
import { readPortfolioServer, isVaultDeployed } from '@/lib/rwa/serverVault'
import { addNotification } from '@/lib/notificationStore'
import { requireSelf } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const pct0 = (n: number) => `${n.toFixed(0)}%`

export async function POST(req: Request) {
  let wallet = ''
  try { wallet = String(((await req.json()) as { wallet?: string }).wallet ?? '').trim() } catch { /* ignore */ }
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ ok: false, error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  const authErr = requireSelf(req, wallet)
  if (authErr) return NextResponse.json({ ok: false, error: authErr }, { status: 401 })

  // Need a saved policy + a deployed, funded vault position to reason about.
  const rules = await getIntent(wallet)
  if (!rules) return NextResponse.json({ ok: true, decision: 'no-policy' })
  if (!isVaultDeployed) return NextResponse.json({ ok: true, decision: 'vault-not-deployed' })

  const pos = await readPortfolioServer(wallet as Address)
  const funded = pos.usdyBal > BigInt(0) || pos.methBal > BigInt(0)
  if (!funded) return NextResponse.json({ ok: true, decision: 'unfunded' })

  const market = await getMarketData()
  const methPct = Number(pos.methBps) / 100
  const signal = await decideDirection(rules, market, methPct, getLastUsdyApy())
  const { before, after, direction } = computeAllocation(rules, methPct, signal.shouldRebalance)

  if (!signal.shouldRebalance || direction === 'hold') {
    return NextResponse.json({ ok: true, decision: 'hold', reason: signal.reason })
  }

  // A genuine, actionable reminder — built entirely from live numbers, and deduped
  // so the same standing recommendation is shown once until the user acts on it.
  const move =
    direction === 'de-risk'
      ? `rotate ${pct0(Math.abs(before.meth - after.meth))} from mETH into USDY (down to ${pct0(after.meth)} mETH)`
      : `rotate ${pct0(Math.abs(after.meth - before.meth))} from USDY into mETH (up to ${pct0(after.meth)} mETH)`
  const message = `Action needed — your AI CFO suggests you ${move}. ${signal.reason}. Open RWAkins and hit Run Rebalance to apply.`

  const { created } = await addNotification(wallet, {
    message,
    type: 'recommendation',
    dedupeKey: `rec:${direction}:${after.meth}`,
  })

  return NextResponse.json({
    ok: true,
    decision: 'action-needed',
    direction,
    notified: created,
    reason: signal.reason,
    currentMethPct: Math.round(methPct),
    targetMethPct: after.meth,
  })
}
