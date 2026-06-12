# RWAkins — AI CFO Agent on Mantle

RWAkins is a Personal CFO agent that removes the complexity of real-world asset investing. Instead of manually configuring sliders and monitoring markets, users simply describe their financial goals in a chat interface. The AI agent continuously evaluates live market data against the user's stated wealth rules and autonomously executes on-chain rebalances between two yield-bearing assets:

- **USDY** — Ondo's tokenized US Treasury bonds. The stable, low-risk leg.
- **mETH** — Mantle Staked ETH. The growth, higher-yield leg.



---

## Live System


| System | How it's live |
|---|---|
| **Wealth-rule parsing** | An LLM (Groq, OpenAI-compatible) extracts *signals* from your plain-English goal; a deterministic priority-chain turns them into the allocation. No-key fallback is a regex parser. |
| **Real DEX swaps** | Every rebalance is a **real on-chain swap** through `RWAkinsAMM` — a constant-product (x·y=k) pool with a 0.3% fee ([contracts/src/RWAkinsAMM.sol](contracts/src/RWAkinsAMM.sol)). The vault routes USDY↔mETH through it, so rebalances take **real slippage + price impact** (a 70% target lands at ~69.96%, not a clean number). No mint-at-fixed-price. |
| **mETH price** | The pool's **on-chain spot price** (`reserveUsdy/reserveMeth`) — real price discovery. The agent owner key anchors it to the live CoinGecko price via `amm.syncToPrice()` ([lib/rwa/oracleSync.ts](lib/rwa/oracleSync.ts)), exactly the job arbitrageurs do on a real DEX. The dashboard reads the pool price back, so `$` and `%` reconcile. |
| **USDY & mETH yields** | Real reference APYs from DefiLlama, written on-chain via `token.setYield()` each sync; the dashboard reads `currentYield()`. |
| **Volatility** | Annualized **realized volatility** computed from CoinGecko's 7-day hourly ETH series ([lib/api/coingecko.ts](lib/api/coingecko.ts)) — not a formula. |
| **Risk council** | 4 agents (Market Analyst, Risk Guardian, Yield Optimizer, Execution Planner) are **real LLM personas** debating the live numbers ([lib/aiCouncil/council.ts](lib/aiCouncil/council.ts)). The mETH ≤ 70% cap veto is enforced in code, never delegated to the model. Deterministic per-agent fallback when the LLM is unavailable. |
| **Execution** | Real `vault.rebalance()` / `rebalanceFor()` on Mantle Sepolia → real tx hashes + real AMM swaps. Gas-gated oracle writes only fire when the live value actually drifted. |

> **On the assets:** USDY/mETH are deployed as testnet `MockRWAToken` contracts (real Ondo USDY / Mantle mETH are mainnet-only + KYC-gated). The **swap mechanics, price discovery, yields, and volatility are all real** — only the tokens are stand-ins. Mainnet is an address swap (real USDY/mETH + a real Mantle DEX router) plus Ondo KYC away; the agent/vault logic is unchanged.

## Production-grade layer

| Feature | How it works |
|---|---|
| **On-chain compliance gate** | `ComplianceRegistry` holds per-address KYC/eligibility. `POST /api/compliance/screen` runs an **AI-assisted screen** — hard OFAC-sanctioned-jurisdiction blocks in code + an LLM risk assessment — and writes the verdict on-chain; the **vault reverts deposits from unverified addresses** ([lib/compliance.ts](lib/compliance.ts)). |
| **Wallet auth (SIWE)** | Sign-In With Ethereum issues an HMAC session cookie; per-user write endpoints derive the wallet from the **session, not a query param**, so you can only touch your own data ([lib/auth.ts](lib/auth.ts)). |
| **Gasless rebalances** | The user signs an **EIP-712 RebalanceIntent** (free, no gas); the agent relays it on-chain and pays the gas (`vault.rebalanceWithSig`, `POST /api/rebalance/relay`). Web2-friendly — connect, click, sign. |
| **Real slippage protection** | Each rebalance swap derives `minOut` from a live on-chain quote + tolerance — a bad pool/sandwich reverts instead of executing. |
| **On-chain tokenomics** | A protocol **management fee** (`feeBps`, default 0.10%) is taken to a treasury on every rebalance. See [BUSINESS.md](BUSINESS.md). |
| **Durable per-user storage** | Intents/notifications/compliance are wallet-keyed; KV-backed in production (in-memory fallback locally). See [DEPLOYMENT.md](DEPLOYMENT.md). |

---


## Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (Next.js)              │
│  RainbowKit · Wagmi · Vercel AI SDK · Recharts│
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│           Agent Brain (API Routes)           │
│                                             │
│  POST /api/intent/parse                     │
│    └─ GPT-4o-mini: text → WealthRules JSON  │
│                                             │
│  POST /api/rebalance/trigger                │
│    └─ Reads rules + market data             │
│    └─ LLM decides: rebalance or hold        │
│    └─ Returns { usdyBps, methBps, narrative}│
│                                             │
│  GET  /api/portfolio/:wallet                │
│    └─ Reads live vault balances via viem    │
│                                             │
│  GET  /api/activity/:wallet                 │
│    └─ Returns rebalance history + tx hashes │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│         Blockchain Layer (Mantle)            │
│                                             │
│  RWAkinsVault.sol                           │
│    ├─ deposit(asset, amount)                │
│    ├─ rebalance(usdyBps, methBps)           │
│    │    ├─ Enforces usdyBps + methBps = 100%│
│    │    └─ Enforces methBps ≤ 70% (MAX_RISK)│
│    ├─ withdraw(asset, amount)               │
│    └─ getPortfolio(user) → live balances    │
│                                             │
│  MockRWAToken.sol (USDY + mETH testnet)     │
└─────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, Tailwind CSS |
| Wallet | RainbowKit, Wagmi, viem |
| AI Chat | Vercel AI SDK |
| LLM | Groq (OpenAI-compatible) — provider-agnostic via `OPENAI_BASE_URL` |
| Market data | CoinGecko (price + realized vol), DefiLlama (reference yields) |
| Agent Framework | OpenClaw / RealClaw |
| Charts | Recharts |
| Smart Contracts | Solidity 0.8.24, Foundry |
| Network | Mantle Sepolia Testnet |
| Block Explorer | Mantle Sepolia Explorer |

---

## Getting Started

### Prerequisites
- Node.js 18+
- Foundry (for contract deployment)
- A funded Mantle Sepolia wallet (get MNT from the [Mantle faucet](https://faucet.sepolia.mantle.xyz))

### 1. Clone and install

```bash
git clone https://github.com/<your-repo>/RWAMantle
cd rwakins
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env.local
```

Fill in:

```env
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=
OPENAI_API_KEY=
DEPLOYER_PRIVATE_KEY=        # funded Mantle Sepolia key — never commit this
METH_PRICE_USD=3000          # initial mETH/USDY price
```

### 3. Deploy contracts

```bash
cd hub
forge script script/Deploy.s.sol \
  --rpc-url mantle_sepolia \
  --broadcast
```

This deploys MockRWAToken (USDY), MockRWAToken (mETH), and RWAkinsVault to Mantle Sepolia. Contract addresses are written to `lib/rwa-deployed.json` automatically.

### 4. Run the frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your wallet on Mantle Testnet.

---

## How to Use

1. **Connect** your MetaMask wallet on Mantle Sepolia Testnet
2. **Describe** your financial goals in the chat — plain English, no sliders
3. **Confirm** the AI CFO's parsed allocation plan
4. **Fund** the vault — the agent mints test USDY to your wallet and deposits it
5. **Run Rebalance** — the agent evaluates market conditions and executes on-chain
6. **View Activity** — every decision with its reason and Mantle tx hash

---

## License

MIT