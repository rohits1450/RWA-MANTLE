// Built by vsrupeshkumar
// Compact "trust" strip on the dashboard — surfaces the production-grade features
// so they're visible at a glance: on-chain KYC status, gasless rebalances, and the
// live protocol fee. KYC status is read live from the ComplianceRegistry.
'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Zap, Receipt } from 'lucide-react'

const TEAL = '#2dd4bf'

export function TrustStrip({ wallet, feeBps }: { wallet: string | null | undefined; feeBps: number }) {
  const [kyc, setKyc] = useState<{ verified: boolean; jurisdiction?: string } | null>(null)

  useEffect(() => {
    if (!wallet) return
    let active = true
    fetch(`/api/compliance/status?wallet=${wallet}`)
      .then((r) => r.json())
      .then((j) => { if (active) setKyc({ verified: !!j.verified, jurisdiction: j.jurisdiction }) })
      .catch(() => {})
    return () => { active = false }
  }, [wallet])

  const pill = (icon: React.ReactNode, text: string, color = 'rgba(255,255,255,0.7)') => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, color, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {icon}{text}
    </span>
  )

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {kyc?.verified
        ? pill(<ShieldCheck size={13} />, `KYC verified${kyc.jurisdiction ? ` · ${kyc.jurisdiction}` : ''}`, TEAL)
        : pill(<ShieldAlert size={13} />, 'KYC required', '#fbbf24')}
      {pill(<Zap size={13} />, 'Gasless rebalances', TEAL)}
      {pill(<Receipt size={13} />, `${(feeBps / 100).toFixed(2)}% on-chain fee`)}
    </div>
  )
}

export default TrustStrip
