// Built by vsrupeshkumar
import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { WalletProvider } from '@/context/WalletContext'
import { AuthSync } from '@/components/auth/AuthSync'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'RWAkins — An AI CFO for Real-World Asset Portfolios',
  description:
    'Autonomous, multi-agent rebalancing of tokenized RWAs (USDY + mETH) on Mantle. Describe your goals in plain English; a transparent AI council debates, votes, and executes every rebalance on-chain.',
}

// Minimal root shell for the RWAkins agent app. Each screen renders its own
// AgentNav / navbar, so the layout only needs the wallet context + toaster.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`} suppressHydrationWarning>
      <body style={{ fontFamily: 'var(--font-jakarta), "Plus Jakarta Sans", system-ui, sans-serif', background: '#080808' }}>
        <WalletProvider>
          <AuthSync />
          {children}
        </WalletProvider>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: '#111',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              fontFamily: 'var(--font-jakarta), sans-serif',
            },
          }}
        />
      </body>
    </html>
  )
}
