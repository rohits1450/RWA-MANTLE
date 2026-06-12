# RWAkins — Deployment & Persistence

## Contracts (Mantle Sepolia)
Deployed via Foundry; addresses auto-written to `lib/rwa-deployed.json`:
- `MockRWAToken` ×2 (USDY, mETH), `RWAkinsAMM` (constant-product pool), `ComplianceRegistry`, `RWAkinsVault`.

Redeploy:
```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...        # must equal AGENT_PRIVATE_KEY (owner = agent)
export METH_PRICE_USD=1800               # initial pool price
forge test                               # 5 passing
forge script script/Deploy.s.sol --rpc-url mantle_sepolia --broadcast --skip-simulation
```
The deployer becomes the vault owner, AMM owner, and compliance officer, and is marked compliant so it can transact immediately.

## Environment (`.env.local`)
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL` | LLM (Groq, OpenAI-compatible) |
| `AGENT_PRIVATE_KEY` | Agent owner = compliance officer = gasless relayer = oracle syncer |
| `CRON_SECRET` | Guards `/api/agent/heartbeat` |
| `AUTH_SECRET` | (optional) HMAC key for SIWE session cookies; falls back to `CRON_SECRET` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | (optional) durable per-user storage — see below |

## Durable per-user persistence (Vercel KV / Upstash Redis)
Intents, notifications, and compliance caching are keyed per wallet. The code
already supports a KV backend ([lib/kv.ts](lib/kv.ts)) and **falls back to an
in-memory store** when none is configured (fine for local dev, but data resets on
restart and isn't shared across serverless instances).

To enable durable, multi-instance persistence (and let the autonomous cron see
every user in production):
1. Vercel dashboard → **Storage → Marketplace → Upstash Redis** (or Vercel KV) → connect to the project.
2. Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` names) automatically.
3. No code change — `getRedis()` picks them up and every store becomes durable.

## Real price oracle (Pyth) — status
A real Pyth pull-oracle was evaluated for the on-chain price. **Pyth is not
deployed on Mantle Sepolia** (no contract at the standard addresses), so the agent
anchors the AMM pool to the live CoinGecko price via `amm.syncToPrice()` instead —
a real on-chain price that tracks the market. On **Mantle mainnet**, Pyth (and
Mantle's own mETH exchange-rate oracle) are available and can replace the
CoinGecko anchor with a fully on-chain feed; the `syncToPrice` seam stays the same.

## Production checklist (mainnet)
- Swap mock token addresses for real Ondo USDY + Mantle mETH in `rwa-deployed.json`.
- Route swaps through a real Mantle DEX router (Merchant Moe / Agni) instead of the bundled AMM.
- Replace the CoinGecko anchor with the on-chain Pyth / mETH oracle.
- Complete Ondo KYC/whitelist; wire the `ComplianceRegistry` to a real KYC provider.
- Security audit before custody of real funds.
