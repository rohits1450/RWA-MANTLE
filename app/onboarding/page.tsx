// Built by vsrupeshkumar
// SCREEN 1 — Onboarding: wallet connection + plain-English intent capture for
// the AI CFO. Standalone route (renders outside the hub shell) so it owns its
// own navbar, per the Turing Test AI x RWA onboarding spec.
'use client'

import Link from 'next/link'
import { useWallet } from '@/context/WalletContext'
import { WalletButton, SwitchToMantleBanner } from '@/components/onboarding/WalletButton'
import { AgentNav } from '@/components/shell/AgentNav'
import { IntentChat } from '@/components/onboarding/IntentChat'
import { ComplianceGate } from '@/components/onboarding/ComplianceGate'
import { Wallet, ShieldCheck, Bot } from 'lucide-react'

const TEAL = '#2dd4bf'
const PURPLE = '#a78bfa'

export default function OnboardingPage() {
  const { evm } = useWallet()
  const connected = evm.isConnected

  return (
    <div className="agent-shell" style={{ minHeight: '100vh', background: '#080808', color: '#fff' }}>
      <AgentNav />
      {/* Navbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', textDecoration: 'none' }}>
          <LogoMark />
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em' }}>RWAkins</span>
        </Link>
        <WalletButton />
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '48px 20px 80px' }}>
        <div style={{ padding: '0 4px 16px' }}>
          <SwitchToMantleBanner />
        </div>

        {/* Hero / connect card */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              color: TEAL,
              background: 'rgba(45,212,191,0.1)',
              border: '1px solid rgba(45,212,191,0.25)',
              marginBottom: 20,
            }}
          >
            <Bot size={13} /> AI × RWA on Mantle
          </span>
          <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Tell your AI CFO how to{' '}
            <span style={{ background: `linear-gradient(90deg, ${TEAL}, ${PURPLE})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
              manage your treasury
            </span>
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            Connect your wallet, describe your goals in plain English, and RWAkins allocates between USDY and mETH —
            with every risk rule enforced on-chain.
          </p>
        </div>

        {!connected ? (
          <div
            style={{
              padding: 32,
              borderRadius: 20,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                margin: '0 auto 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(45,212,191,0.1)',
                border: '1px solid rgba(45,212,191,0.25)',
              }}
            >
              <Wallet size={24} color={TEAL} />
            </div>
            <h2 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 8px' }}>Connect your wallet to begin</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: '0 0 22px' }}>
              MetaMask or any injected wallet on Mantle Sepolia (chain 5003).
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <WalletButton />
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 28, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Feature icon={<ShieldCheck size={15} />} text="On-chain risk caps" />
              <Feature icon={<Bot size={15} />} text="ERC-8004 agent identity" />
            </div>
          </div>
        ) : (
          <ComplianceGate>
            <IntentChat />
          </ComplianceGate>
        )}
      </main>
    </div>
  )
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
      <span style={{ color: TEAL }}>{icon}</span>
      {text}
    </span>
  )
}

function LogoMark() {
  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${TEAL}, ${PURPLE})`,
        color: '#080808',
        fontWeight: 900,
        fontSize: 10,
        letterSpacing: '-0.02em',
      }}
    >
      RWA
    </span>
  )
}
