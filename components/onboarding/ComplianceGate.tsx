// Built by vsrupeshkumar
// KYC gate shown before the intent chat. USDY is a regulated security, so a holder
// must clear AI-assisted screening (jurisdiction + status) before they can set a
// policy / deposit. Verdict is written on-chain (ComplianceRegistry); the vault
// gates deposits on it. Renders children only once the wallet is verified.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Loader2, Sparkles } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'

const TEAL = '#2dd4bf'

interface Status { verified: boolean; accredited?: boolean; riskScore?: number; jurisdiction?: string }

export function ComplianceGate({ children }: { children: React.ReactNode }) {
  const { evm } = useWallet()
  const wallet = evm.address
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [jurisdiction, setJurisdiction] = useState('')
  const [context, setContext] = useState('')
  const [screening, setScreening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!wallet) { setLoading(false); return }
    try {
      const r = await fetch(`/api/compliance/status?wallet=${wallet}`)
      const j = await r.json()
      setStatus({ verified: !!j.verified, accredited: j.accredited, riskScore: j.riskScore, jurisdiction: j.jurisdiction })
    } catch { setStatus({ verified: false }) }
    finally { setLoading(false) }
  }, [wallet])

  useEffect(() => { setLoading(true); refresh() }, [refresh])

  const screen = useCallback(async () => {
    if (!wallet || !jurisdiction.trim() || screening) return
    setScreening(true); setError(null)
    try {
      const r = await fetch('/api/compliance/screen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, jurisdiction, context }),
      })
      const j = await r.json()
      if (j?.verdict && !j.verdict.eligible) {
        setError(j.verdict.reason || 'Not eligible in this jurisdiction.')
      } else if (j?.ok) {
        await refresh()
      } else {
        setError(j?.error || 'Screening failed — try again.')
      }
    } catch { setError('Screening failed — try again.') }
    finally { setScreening(false) }
  }, [wallet, jurisdiction, context, screening, refresh])

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.5)', padding: 24 }}><Loader2 size={16} className="animate-spin" /> Checking compliance status…</div>
  }
  if (status?.verified) {
    return (
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: TEAL, background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)' }}>
          <ShieldCheck size={14} /> KYC verified{status.jurisdiction ? ` · ${status.jurisdiction}` : ''}{status.accredited ? ' · accredited' : ''}
        </div>
        {children}
      </div>
    )
  }

  // Not verified → screening form.
  return (
    <div style={{ padding: 24, borderRadius: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <ShieldCheck size={20} color={TEAL} />
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Quick compliance check</h2>
      </div>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 18px', lineHeight: 1.6 }}>
        USDY is a tokenized US-treasury security. A one-time AI-assisted KYC screen records your eligibility on-chain
        before you can set a policy. (Sanctioned jurisdictions are blocked.)
      </p>
      <label style={labelS}>Jurisdiction (country)</label>
      <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Singapore, Germany, UAE…" style={inputS} />
      <label style={labelS}>Your status (optional)</label>
      <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="e.g. individual investor, treasury yield" style={inputS} />
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: '#f87171' }}>
          <ShieldAlert size={15} /> {error}
        </div>
      )}
      <button onClick={screen} disabled={!jurisdiction.trim() || screening} style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#080808', background: jurisdiction.trim() ? TEAL : 'rgba(255,255,255,0.12)', cursor: jurisdiction.trim() ? 'pointer' : 'not-allowed', border: 'none' }}>
        {screening ? <><Loader2 size={15} className="animate-spin" /> Screening + recording on-chain…</> : <><Sparkles size={15} /> Run AI compliance screen</>}
      </button>
    </div>
  )
}

const labelS: React.CSSProperties = { display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '12px 0 6px' }
const inputS: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 14, outline: 'none' }

export default ComplianceGate
