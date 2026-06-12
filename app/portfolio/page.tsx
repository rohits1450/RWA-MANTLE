// Built by vsrupeshkumar
// SCREEN 2 — Portfolio dashboard: live on-chain position, allocation, yield, and
// the active AI-CFO wealth rules. Standalone route with its own sticky navbar.
// Reads real balances via lib/rwa/vaultClient when the vault is deployed; before
// deployment it renders a clearly-labelled demo position (same convention the
// existing Treasury panel uses).
'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatEther } from 'viem'
import { Wallet, TrendingUp, PieChart as PieIcon, Coins, Sparkles, ArrowRight, Zap, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { usePrices } from '@/hooks/usePrices'
import { isVaultDeployed, fetchVaultSnapshot, readWalletBalances, approveAndDeposit, faucetMint, RWA } from '@/lib/rwa/vaultClient'
import { rwaRebalanceSkill } from '@/lib/skills/rwaRebalanceSkill'
import { loadIntent, summarizeRules, type WealthRules } from '@/lib/intent'
import { StandaloneNavbar } from '@/components/shell/StandaloneNavbar'
import { AgentNav } from '@/components/shell/AgentNav'
import { WalletButton, SwitchToMantleBanner } from '@/components/onboarding/WalletButton'
import { MetricCard } from '@/components/portfolio/MetricCard'
import { TrustStrip } from '@/components/portfolio/TrustStrip'
import { RiskBadge } from '@/components/portfolio/RiskBadge'
import { PortfolioChart } from '@/components/portfolio/PortfolioChart'
import { PortfolioLineChart } from '@/components/portfolio/PortfolioLineChart'
import type { ActivityPoint } from '@/app/api/activity/route'

const TEAL = '#2dd4bf'
const PURPLE = '#a78bfa'
const USDY_PRICE = 1.0 // USDY is a ~$1 stable yield token (testnet mock pegged for the demo)
const ETH_FALLBACK = 3200

interface MarketSnapshot {
  ethPrice: number
  eth24hChange: number
  usdyApy: number
  methApy: number
  volatility: number
  yieldsLive: boolean
  marketLive: boolean
}

// Demo position shown before the vault is deployed (token units, 18-dec).
const DEMO = { usdyTokens: 6800, methTokens: 1.15, usdyApyBps: 480, methApyBps: 360 }

const toNum = (b: bigint) => Number(formatEther(b))

export default function PortfolioPage() {
  const { evm } = useWallet()
  const connected = evm.isConnected && !!evm.address
  const { prices } = usePrices(['ethereum'])
  const ethPrice = prices['ethereum']?.usd || ETH_FALLBACK

  const [usdyTokens, setUsdyTokens] = useState(0)
  const [methTokens, setMethTokens] = useState(0)
  // On-chain allocation (basis points) straight from the vault's getPortfolio.
  // This is the SAME accounting the vault uses when it rebalances, so the
  // dashboard split matches the target the agent executes. null = demo / no
  // live position → fall back to live-price valuation below.
  const [chainMethBps, setChainMethBps] = useState<number | null>(null)
  // Live mETH price the vault values the leg at — read on-chain (the agent oracle
  // keeps it synced to the real market). null until first read → ETH proxy below.
  const [methPriceUsd, setMethPriceUsd] = useState<number | null>(null)
  // Live market snapshot (APYs, ETH 24h, realized volatility) for the data badge.
  const [market, setMarket] = useState<MarketSnapshot | null>(null)
  // Live protocol management fee (bps) from the vault — shown in the trust strip.
  const [feeBps, setFeeBps] = useState(0)
  const [apy, setApy] = useState({ usdyApyBps: DEMO.usdyApyBps, methApyBps: DEMO.methApyBps })
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(!isVaultDeployed)
  // True when the live read failed after retries — we show a "reconnecting"
  // notice and KEEP the last data, rather than fabricating a demo position.
  const [loadError, setLoadError] = useState(false)
  // Flips true after the first successful live read, so the "fund your vault"
  // panel only appears for a genuinely-empty position (never during an outage).
  const [hasLoaded, setHasLoaded] = useState(false)
  const [rules, setRules] = useState<WealthRules | null>(null)
  const [series, setSeries] = useState<ActivityPoint[]>([])
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; narrative?: string; txHash?: string; err?: string } | null>(null)
  const [funding, setFunding] = useState<{ busy: boolean; step?: string; err?: string }>({ busy: false })
  const router = useRouter()

  // Load saved wealth rules for this wallet — and re-read whenever the tab regains
  // focus, so a policy just set on /onboarding is reflected the moment you return.
  useEffect(() => {
    const refresh = () => setRules(loadIntent(evm.address))
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [evm.address])

  // Load the live vault position. ONE reliable call to /api/portfolio (resilient
  // multi-endpoint RPC) with a few client retries. On a genuine outage we never
  // fabricate a demo position — we keep the last data and flag loadError. The
  // labelled DEMO is shown ONLY when not connected / vault not deployed.
  useEffect(() => {
    let active = true
    async function load() {
      if (!isVaultDeployed || !connected || !evm.address) {
        // Genuine "no live position to read" → labelled demo.
        setUsdyTokens(DEMO.usdyTokens)
        setMethTokens(DEMO.methTokens)
        setChainMethBps(null)
        setMethPriceUsd(null)
        setApy({ usdyApyBps: DEMO.usdyApyBps, methApyBps: DEMO.methApyBps })
        setIsDemo(true)
        setLoadError(false)
        setLoading(false)
        return
      }
      setLoading(true)
      for (let attempt = 0; attempt < 3 && active; attempt++) {
        try {
          const s = await fetchVaultSnapshot(evm.address)
          if (!active) return
          setUsdyTokens(s.usdyTokens)
          setMethTokens(s.methTokens)
          setChainMethBps(s.methBps)
          setMethPriceUsd(s.methPriceUsd > 0 ? s.methPriceUsd : null)
          setFeeBps(s.feeBps)
          setApy({ usdyApyBps: s.usdyApyBps, methApyBps: s.methApyBps })
          setIsDemo(false)
          setLoadError(false)
          setHasLoaded(true)
          setLoading(false)
          return
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      // Every endpoint failed: surface a reconnecting state, keep prior values,
      // and DO NOT show fake demo numbers.
      if (!active) return
      setLoadError(true)
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [connected, evm.address])

  // The price we value the mETH leg at: the LIVE on-chain vault price (kept synced
  // to the real market by the agent oracle), falling back to the ETH spot proxy
  // until that first read lands. USDY ≈ $1.
  const methPrice = methPriceUsd ?? ethPrice

  // Derived USD metrics. Everything is valued at the same live mETH price, so the
  // dollar figures and the allocation split always reconcile. When we have the
  // on-chain bps we use them for the split (exact, = the target a rebalance hits);
  // otherwise (demo) we derive the split from the dollar values.
  const m = useMemo(() => {
    const usdyUsd = usdyTokens * USDY_PRICE
    const methUsd = methTokens * methPrice
    const total = usdyUsd + methUsd
    const usdyFrac = chainMethBps != null ? 1 - chainMethBps / 10_000 : total > 0 ? usdyUsd / total : 0
    const methFrac = chainMethBps != null ? chainMethBps / 10_000 : total > 0 ? methUsd / total : 0
    const weightedYield = usdyFrac * (apy.usdyApyBps / 100) + methFrac * (apy.methApyBps / 100)
    return { usdyUsd, methUsd, total, usdyFrac, methFrac, weightedYield }
  }, [usdyTokens, methTokens, methPrice, apy, chainMethBps])

  // Performance series anchored to the live total value.
  useEffect(() => {
    if (loading || m.total <= 0) return
    let active = true
    const addr = evm.address || 'anon'
    fetch(`/api/activity?base=${Math.round(m.total)}&address=${addr}`)
      .then((r) => r.json())
      .then((j: { series?: ActivityPoint[] }) => { if (active) setSeries(j.series ?? []) })
      .catch(() => { if (active) setSeries([]) })
    return () => { active = false }
  }, [loading, m.total, evm.address])

  // Live market snapshot for the data badge — refreshed every 60s while mounted.
  useEffect(() => {
    let active = true
    const load = () =>
      fetch('/api/market')
        .then((r) => r.json())
        .then((j: MarketSnapshot & { ok?: boolean }) => { if (active && j?.ok !== false) setMarket(j) })
        .catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const fmtPct = (n: number) => `${n.toFixed(1)}%`

  // Establish a vault position so the AI CFO has something to rebalance.
  // Mints mock USDY to the wallet if needed (testnet faucet), then approves +
  // deposits it into the vault. After this, getPortfolio(user) is non-zero and
  // rebalance() no longer reverts with "EMPTY".
  const fundVault = useCallback(async () => {
    if (!evm.address || funding.busy) return
    const acct = evm.address as `0x${string}`
    const SEED = '5000' // USDY
    setFunding({ busy: true, step: 'Checking balance…' })
    try {
      const bal = await readWalletBalances(acct)
      if (toNum(bal.usdy) < Number(SEED)) {
        setFunding({ busy: true, step: 'Minting test USDY…' })
        await faucetMint(acct, RWA.usdy, SEED)
      }
      await approveAndDeposit(acct, RWA.usdy, SEED, (s) =>
        setFunding({ busy: true, step: s === 'approving' ? 'Approving USDY…' : 'Depositing into vault…' }),
      )
      // Refresh the vault position.
      await new Promise(r => setTimeout(r, 1500)) // wait 1.5s for chain
      const s = await fetchVaultSnapshot(acct)
      setUsdyTokens(s.usdyTokens)
      setMethTokens(s.methTokens)
      setChainMethBps(s.methBps)
      setMethPriceUsd(s.methPriceUsd > 0 ? s.methPriceUsd : null)
          setFeeBps(s.feeBps)
      setIsDemo(false)
      setHasLoaded(true)
      setFunding({ busy: false })
    } catch (e) {
      setFunding({ busy: false, err: e instanceof Error ? e.message : 'Funding failed — try again.' })
    }
  }, [evm.address, funding.busy])

  const triggerRebalance = useCallback(async () => {
    if (!evm.address || triggering) return
    setTriggering(true)
    setTriggerResult(null)
    try {
      // Steps 2-4: ask the agent brain (rules + live market + LLM + council) for a decision.
      const res = await fetch('/api/rebalance/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: evm.address,
          currentMethPct: Math.round(m.methFrac * 100),
           targetUsdyBps: rules?.targetUsdyBps ?? 8000,
          targetMethBps: rules?.targetMethBps ?? 2000,
          usdyApyBps: apy.usdyApyBps,
          methApyBps: apy.methApyBps,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setTriggerResult({ ok: false, err: json.error ?? 'Trigger failed' })
        return
      }

      // Council held / no action needed — show the reasoning, nothing to execute.
      if (!json.shouldRebalance) {
        setTriggerResult({ ok: true, narrative: json.narrative })
        return
      }

      // Step 5: execute on-chain when the vault is live → REAL Mantle tx hash.
      // Execution goes through the named rwa-rebalance agent skill (the Byreal
      // Agent Skills layer) rather than calling the vault directly, so the
      // decision → skill → on-chain hop is explicit in the architecture.
      if (isVaultDeployed && !isDemo) {
        const { usdyBps, methBps, direction } = json.decision
        const { txHash: hash } = await rwaRebalanceSkill.execute({
          wallet: evm.address,
          targetUsdyBps: usdyBps,
          targetMethBps: methBps,
          reason: json.aiRationale ?? json.narrative ?? 'AI CFO rebalance',
        })
        // Log the confirmed activity with the genuine hash + LLM narrative.
        await fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: evm.address,
            activity: {
              actionType: 'rebalance',
              narrative: json.narrative,
              assetFrom: direction === 'de-risk' ? 'mETH' : direction === 'rotate-in' ? 'USDY' : null,
              assetTo: direction === 'de-risk' ? 'USDY' : direction === 'rotate-in' ? 'mETH' : null,
              txHash: hash,
              allocationBefore: json.allocationBefore,
              allocationAfter: json.allocationAfter,
            },
          }),
        }).catch(() => {})
        setTriggerResult({ ok: true, narrative: json.narrative, txHash: hash })
        // Refresh the vault position from chain so the dashboard reflects the new split.
        try {
          await new Promise(r => setTimeout(r, 2000)) // wait 2s for the Mantle node to settle before re-reading
          const s = await fetchVaultSnapshot(evm.address)
          setUsdyTokens(s.usdyTokens)
          setMethTokens(s.methTokens)
          setChainMethBps(s.methBps)
          setMethPriceUsd(s.methPriceUsd > 0 ? s.methPriceUsd : null)
          setFeeBps(s.feeBps)
          setIsDemo(false)
          setHasLoaded(true)
        } catch { /* keep prior values */ }
        setTimeout(() => router.push('/activity'), 2600)
      } else {
        // Vault not deployed — surface the decision; never fabricate a tx hash.
        setTriggerResult({ ok: true, narrative: `${json.narrative} (Deploy the vault to Mantle Sepolia to execute this on-chain.)` })
      }
    } catch (e) {
      setTriggerResult({ ok: false, err: e instanceof Error ? e.message : 'Execution failed — try again.' })
    } finally {
      setTriggering(false)
    }
  }, [evm.address, m.methFrac, apy, isDemo, triggering, router, rules])

  return (
    <div className="agent-shell" style={{ minHeight: '100vh', background: '#080808', color: '#fff' }}>
      <AgentNav />
      {/* Sticky navbar (shared with /onboarding + /activity) */}
      <StandaloneNavbar subtitle="Portfolio" showBell />

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '24px 20px 80px' }}>
        <div style={{ marginBottom: 16 }}>
          <SwitchToMantleBanner />
        </div>

        {!connected ? (
          <ConnectPrompt />
        ) : (
          <>
            {isDemo && (
              <div
                style={{
                  marginBottom: 20,
                  padding: '10px 16px',
                  borderRadius: 12,
                  fontSize: 13,
                  color: '#fbbf24',
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.2)',
                }}
              >
                Showing a <strong>demo position</strong>. Deploy the RWA vault to Mantle Sepolia to read your live balances.
              </div>
            )}

            {/* Transient RPC outage: keep the last data, never fake a position. */}
            {loadError && !isDemo && (
              <div
                style={{
                  marginBottom: 20, padding: '10px 16px', borderRadius: 12, fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
                }}
              >
                <Loader2 size={14} className="animate-spin" />
                Reconnecting to Mantle… showing your last known balances.
              </div>
            )}

            {/* Policy-vs-position: your saved target differs from your live split. */}
            {!isDemo && !loadError && hasLoaded && rules && chainMethBps != null && m.total > 0 &&
              Math.abs(rules.targetMethBps / 100 - chainMethBps / 100) >= rules.rebalanceThresholdPct && (
              <div
                style={{
                  marginBottom: 20, padding: '12px 16px', borderRadius: 12, fontSize: 13.5,
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  color: PURPLE, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)',
                }}
              >
                <Sparkles size={15} />
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Your saved target is <strong>{(rules.targetUsdyBps / 100).toFixed(0)}% USDY / {(rules.targetMethBps / 100).toFixed(0)}% mETH</strong>,
                  but you&apos;re currently at <strong>{(100 - chainMethBps / 100).toFixed(0)}% / {(chainMethBps / 100).toFixed(0)}%</strong>.
                  Hit <strong>Run Rebalance</strong> to apply your policy on-chain.
                </span>
              </div>
            )}

            {/* AI CFO Action Panel — fund the vault first if the position is
                empty (rebalance acts on the vault position, not wallet tokens). */}
            {!isDemo && !loading && !loadError && hasLoaded && m.total <= 0 ? (
              <FundPanel funding={funding} onFund={fundVault} />
            ) : (
              <RebalanceTrigger
                loading={loading}
                triggering={triggering}
                result={triggerResult}
                onTrigger={triggerRebalance}
              />
            )}

            {/* Live data badge — proves nothing is hardcoded: price synced
                on-chain, yields + realized volatility pulled live. */}
            <TrustStrip wallet={evm.address} feeBps={feeBps} />
            <LiveDataBadge market={market} methPrice={methPriceUsd} />

            {/* Metric cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
              <MetricCard
                label="Total Portfolio Value"
                value={fmtUsd(m.total)}
                sub={`USDY $1.00 · mETH ${fmtUsd(methPrice)}`}
                accent="green"
                icon={<Wallet size={16} />}
                loading={loading}
              />
              <MetricCard
                label="Current Yield Rate"
                value={fmtPct(m.weightedYield)}
                sub="Weighted USDY + mETH APY"
                accent="neutral"
                icon={<TrendingUp size={16} />}
                loading={loading}
              />
              <MetricCard
                label="USDY Allocation"
                value={fmtPct(m.usdyFrac * 100)}
                sub={fmtUsd(m.usdyUsd)}
                accent="teal"
                icon={<Coins size={16} />}
                loading={loading}
              />
              <MetricCard
                label="mETH Allocation"
                value={fmtPct(m.methFrac * 100)}
                sub={fmtUsd(m.methUsd)}
                accent="purple"
                icon={<PieIcon size={16} />}
                loading={loading}
              />
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 16, marginBottom: 24 }} className="portfolio-charts-grid">
              <Panel title="Allocation">
                <PortfolioChart data={[{ name: 'USDY', value: m.usdyUsd }, { name: 'mETH', value: m.methUsd }]} />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8, fontSize: 12 }}>
                  <Legend color={TEAL} label="USDY" />
                  <Legend color={PURPLE} label="mETH" />
                </div>
              </Panel>
              <Panel title="Performance (30d)">
                <PortfolioLineChart data={series} />
              </Panel>
            </div>

            {/* Active wealth rules */}
            <WealthRulesPanel rules={rules} />
          </>
        )}
      </main>

      <style>{`@media (max-width: 820px){ .portfolio-charts-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function WealthRulesPanel({ rules }: { rules: WealthRules | null }) {
  return (
    <Panel title="Active Wealth Rules">
      {!rules ? (
        <div style={{ textAlign: 'center', padding: '24px 12px' }}>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 16 }}>
            No AI CFO policy set for this wallet yet.
          </p>
          <Link
            href="/onboarding"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, background: TEAL, color: '#080808', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
          >
            <Sparkles size={14} /> Set up your AI CFO <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <RiskBadge level={rules.riskLevel} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{summarizeRules(rules)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Rule label="Default asset" value={rules.defaultAsset} />
            <Rule label="Target USDY" value={`${(rules.targetUsdyBps / 100).toFixed(0)}%`} />
            <Rule label="Target mETH" value={`${(rules.targetMethBps / 100).toFixed(0)}%`} />
            <Rule label="Rebalancing" value={rules.autoRebalance ? `Auto · ${rules.rebalanceThresholdPct}% drift` : 'Manual'} />
          </div>
          {rules.rawIntent && (
            <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              “{rules.rawIntent}”
            </p>
          )}
          <Link href="/onboarding" style={{ display: 'inline-block', marginTop: 14, fontSize: 12, color: TEAL, textDecoration: 'none' }}>
            Edit policy →
          </Link>
        </div>
      )}
    </Panel>
  )
}

function LiveDataBadge({ market, methPrice }: { market: MarketSnapshot | null; methPrice: number | null }) {
  const fmtUsd0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const pill = (label: string, value: string, accent?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: accent ?? '#fff' }}>{value}</span>
    </div>
  )
  const up = market ? market.eth24hChange >= 0 : true
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20, padding: '10px 14px', borderRadius: 14, background: 'rgba(45,212,191,0.04)', border: '1px solid rgba(45,212,191,0.18)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: TEAL, boxShadow: `0 0 8px ${TEAL}`, animation: 'pulse 1.8s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: TEAL, letterSpacing: 0.6 }}>LIVE</span>
      </div>
      {pill('mETH price', methPrice != null ? fmtUsd0(methPrice) : market ? fmtUsd0(market.ethPrice) : '—', TEAL)}
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', alignSelf: 'flex-end', paddingBottom: 3 }}>synced on-chain</span>
      {pill('USDY APY', market ? `${market.usdyApy.toFixed(2)}%` : '—')}
      {pill('mETH APY', market ? `${market.methApy.toFixed(2)}%` : '—')}
      {pill('ETH 24h', market ? `${up ? '+' : ''}${market.eth24hChange.toFixed(1)}%` : '—', up ? '#34d399' : '#f87171')}
      {pill('Volatility', market ? `${market.volatility.toFixed(0)}%` : '—', PURPLE)}
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
        CoinGecko · DefiLlama · Mantle
      </span>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </div>
  )
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{value}</div>
    </div>
  )
}

function ConnectPrompt() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)',
        }}
      >
        <Wallet size={24} color={TEAL} />
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Connect your wallet</h2>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: '0 0 22px' }}>
        Connect on Mantle Testnet to see your live RWA portfolio.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <WalletButton />
      </div>
      <p style={{ marginTop: 18, fontSize: 13 }}>
        <Link href="/onboarding" style={{ color: TEAL, textDecoration: 'none' }}>New here? Set up your AI CFO →</Link>
      </p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 20, borderRadius: 18, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.04em', margin: '0 0 16px' }}>{title}</h3>
      {children}
    </section>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.6)' }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} /> {label}
    </span>
  )
}

function FundPanel({ funding, onFund }: { funding: { busy: boolean; step?: string; err?: string }; onFund: () => void }) {
  return (
    <div
      style={{
        marginBottom: 20, padding: '16px 20px', borderRadius: 14,
        background: 'rgba(45,212,191,0.05)', border: '1px solid rgba(45,212,191,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Fund your vault to activate the AI CFO</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: 460 }}>
          The agent rebalances what the vault custodies. Deposit test USDY once (we’ll mint it for you on Mantle Sepolia), then the AI CFO can rebalance on-chain.
        </div>
        {funding.err && <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 6 }}>{funding.err}</div>}
      </div>
      <button
        onClick={onFund}
        disabled={funding.busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: funding.busy ? 'not-allowed' : 'pointer',
          background: funding.busy ? 'rgba(45,212,191,0.3)' : '#2dd4bf', color: '#080808',
          fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', opacity: funding.busy ? 0.8 : 1,
        }}
      >
        <Zap size={14} />
        {funding.busy ? (funding.step || 'Funding…') : 'Deposit 5,000 USDY'}
      </button>
    </div>
  )
}

interface TriggerProps {
  loading: boolean
  triggering: boolean
  result: { ok: boolean; narrative?: string; txHash?: string; err?: string } | null
  onTrigger: () => void
}

function RebalanceTrigger({ loading, triggering, result, onTrigger }: TriggerProps) {
  if (result?.ok) {
    return (
      <div
        style={{
          marginBottom: 20, padding: '16px 20px', borderRadius: 14,
          background: 'rgba(45,212,191,0.06)', border: '1px solid rgba(45,212,191,0.3)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#2dd4bf', fontWeight: 700, fontSize: 14 }}>
          <CheckCircle size={16} /> AI CFO executed rebalance
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{result.narrative}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {result.txHash && (
            <a
              href={`https://sepolia.mantlescan.xyz/tx/${result.txHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: '#2dd4bf', textDecoration: 'none', fontFamily: 'monospace' }}
            >
              {result.txHash.slice(0, 18)}…{result.txHash.slice(-6)} ↗
            </a>
          )}
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Redirecting to Activity feed…</span>
        </div>
      </div>
    )
  }

  if (result?.ok === false) {
    return (
      <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertCircle size={15} color="#fbbf24" />
        <span style={{ fontSize: 13, color: '#fbbf24' }}>{result.err}</span>
      </div>
    )
  }

  return (
    <div
      style={{
        marginBottom: 20, padding: '14px 20px', borderRadius: 14,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>AI CFO Agent</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
          Fetches live market data, evaluates your wealth rules, and executes a rebalance on Mantle.
        </div>
      </div>
      <button
        onClick={onTrigger}
        disabled={loading || triggering}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: loading || triggering ? 'not-allowed' : 'pointer',
          background: loading || triggering ? 'rgba(45,212,191,0.3)' : '#2dd4bf',
          color: '#080808', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap',
          transition: 'opacity 0.15s',
          opacity: loading || triggering ? 0.7 : 1,
        }}
      >
        <Zap size={14} />
        {triggering ? 'AI CFO evaluating…' : 'Run Rebalance'}
      </button>
    </div>
  )
}
