# RWAkins — Business Model

*An AI CFO for tokenized Real-World Asset portfolios on Mantle.*

## Problem
Tokenized RWAs (treasuries, staked-ETH, credit) are growing fast, but **managing a position is still manual**: users watch yields, judge risk, and rebalance by hand across volatile and stable legs. Most holders under-manage and leave yield (and risk-adjusted return) on the table.

## Product
A personal **AI CFO**: the user describes goals in plain English; an auditable multi-agent system continuously reads live market data, screens compliance, and **executes rebalances on-chain** between a stable RWA leg (USDY) and a growth leg (mETH) — autonomously or on demand, gas-free for the user.

## Target users
1. **Crypto-native treasuries & DAOs** holding idle stablecoins who want managed RWA yield with on-chain transparency.
2. **Non-US individuals** (USDY is non-US-person eligible) seeking passive, rules-based exposure to tokenized treasuries + staking.
3. **Fintech / neobank partners** who want to embed a compliant RWA yield product (B2B2C).

## Why now / why Mantle
- RWA issuance on Mantle is expanding (Ondo USDY, Mantle mETH) with **low gas** that makes *frequent* autonomous rebalancing economically viable — the core of this product. High-gas L1s make per-tick management uneconomic.

## Revenue model (implemented on-chain)
The vault charges a **protocol management fee** on every rebalance, accruing to a treasury — live and configurable on-chain (`feeBps`, `setParams`), currently **0.10% of position value per rebalance**.

| Stream | Mechanism | Status |
|---|---|---|
| **Management fee** | `feeBps` taken from the USDY leg to treasury on each rebalance | ✅ live on-chain |
| **Performance fee** | bps of realised gains above a high-water mark | roadmap (same fee plumbing) |
| **B2B licensing** | white-label the agent + compliance stack for partners | roadmap |

**Illustrative unit economics:** at 0.10%/rebalance and ~weekly rebalances, a managed position yields ~0.5% AUM/yr in fees. On **$10M AUM → ~$50k ARR**; the model scales linearly with AUM and rebalance frequency, both of which Mantle's low gas enables.

## Go-to-market
1. **Testnet → mainnet:** swap the mock token addresses for real Ondo USDY / Mantle mETH (the agent/vault logic is unchanged); complete Ondo KYC onboarding + a security audit.
2. **Wedge:** target non-US crypto treasuries/DAOs via the Mantle ecosystem; the gasless, plain-English UX is the differentiator vs. manual RWA dashboards.
3. **Expand assets:** the two-leg vault generalises to N RWA legs (credit, tokenized funds) — same brain, same compliance gate.
4. **B2B:** license the compliance + agent layer to fintechs wanting a turnkey compliant RWA yield product.

## Compliance posture
USDY is a regulated security. The product ships a **real on-chain compliance gate**: an AI-assisted KYC screen (hard OFAC-sanctioned-jurisdiction blocks in code + LLM risk assessment) writes an eligibility record to a `ComplianceRegistry`, and **the vault blocks deposits from unverified addresses**. Mainnet adds Ondo's whitelist + a KYC provider; the architecture is already in place.

## Moat / differentiation
- **Auditable AI in the loop** (signals from the model, numbers computed in code, execution on-chain) — not a chatbot wrapper.
- **Compliance-native** RWA management (most DeFi yield products ignore this).
- **Gasless, plain-English UX** that a Web2 user can complete end-to-end.
