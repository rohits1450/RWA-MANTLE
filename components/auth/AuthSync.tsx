// Built by vsrupeshkumar
// Invisible app-wide component: when a wallet connects, it runs Sign-In With
// Ethereum once so a verified session cookie exists before any per-user write
// (saveIntent, agent/check). One free signature, no gas. Re-signs if the account
// changes. Mounted in the root layout so it covers every page.
'use client'

import { useEffect, useRef } from 'react'
import { useWallet } from '@/context/WalletContext'
import { signInWithEthereum } from '@/lib/rwa/vaultClient'
import type { Address } from 'viem'

export function AuthSync() {
  const { evm } = useWallet()
  const signedFor = useRef<string | null>(null)

  useEffect(() => {
    const addr = evm.address
    if (!addr || signedFor.current === addr.toLowerCase()) return
    let active = true
    ;(async () => {
      try {
        const ok = await signInWithEthereum(addr as Address)
        if (active && ok) signedFor.current = addr.toLowerCase()
      } catch { /* user may reject the signature; non-fatal */ }
    })()
    return () => { active = false }
  }, [evm.address])

  return null
}

export default AuthSync
