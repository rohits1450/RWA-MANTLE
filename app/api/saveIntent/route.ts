// Built by vsrupeshkumar
// Persists a user's AI-CFO "wealth rules" for the onboarding flow.
//
// The client POSTs the free-text intent + wallet address. We try to parse it
// into a structured allocation policy with GPT-4o-mini; on any failure — no key,
// bad JSON, timeout — we fall back to the deterministic parser in lib/intent.
// Either way the result is run through normalizeRules(), so the persisted mETH
// share can never exceed the vault's on-chain MAX_RISK_BPS. Rules are also
// returned so the client can mirror them to localStorage (no off-chain database
// — parity with the contracts).
import { NextResponse } from 'next/server'
import {
  extractSignals, rulesFromSignals, normalizeRules,
  type WealthRules, type IntentSignals, type RiskLevel,
} from '@/lib/intent'
import { setIntent, getIntent } from '@/lib/intentStore'
import { chatJson } from '@/lib/openai'
import { requireSelf } from '@/lib/auth'

// PHASE-2 architecture (signal → code → narrative):
//   1. SIGNAL-EXTRACTION LLM (below, temperature 0) — reports ONLY what the user
//      literally expressed. It makes NO allocation decision.
//   2. DETERMINISTIC PRIORITY CHAIN (lib/intent rulesFromSignals) — turns signals
//      into the actual numbers; risk level is derived from the final number here,
//      never from the model. This is the single source of allocation truth.
//   3. NARRATIVE LLM — lives in /api/ai; writes the confirmation prose from the
//      numbers this route already computed (it decides nothing).
const SIGNAL_PROMPT =
  'You extract structured SIGNALS from a user\'s plain-English treasury goal for a ' +
  'two-asset RWA portfolio (USDY = stable yield, mETH = staked-ETH, higher risk). ' +
  'Do NOT decide an allocation, do NOT do any math, do NOT invent numbers — only ' +
  'report what the user LITERALLY stated. Return ONLY this JSON object: ' +
  '{"splitMethPct":number|null,"explicitMethPct":number|null,"explicitUsdyPct":number|null,' +
  '"riskKeyword":"low"|"medium"|"high"|null,"autoRebalance":boolean,"rebalanceThresholdPct":number|null}. ' +
  'splitMethPct = the mETH side of a bare "A/B" USDY/mETH split (e.g. "50/50" → 50, "60/40" → 40), else null. ' +
  'explicitMethPct = a percent the user explicitly tied to mETH (e.g. "10% mETH" → 10), else null. ' +
  'explicitUsdyPct = a percent the user explicitly tied to USDY, else null. ' +
  'riskKeyword = their risk tone if any, else null. ' +
  'Set any field you cannot ground in the user\'s words to null. Never guess.'

// Durable copy lives in the client's localStorage; this lets a same-instance GET read back.

interface Body {
  address?: string
  rawIntent?: string
  rules?: Partial<WealthRules>
}

const RISK_WORDS: ReadonlySet<string> = new Set(['low', 'medium', 'high'])
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * STEP 1 — signal-extraction LLM (temperature 0, signals only). Returns null on
 * any failure (no key, timeout, bad JSON) so the caller falls back to the
 * deterministic regex extractor in lib/intent. The returned signals are coerced
 * into the strict IntentSignals shape; the LLM never sees the allocation math.
 */
async function aiExtractSignals(rawIntent: string): Promise<IntentSignals | null> {
  const raw = await chatJson<Partial<Record<keyof IntentSignals, unknown>>>({
    messages: [
      { role: 'system', content: SIGNAL_PROMPT },
      { role: 'user', content: rawIntent.slice(0, 1000) },
    ],
    temperature: 0,
    timeoutMs: 12_000,
    maxTokens: 160,
  })
  if (!raw) return null
  const risk = typeof raw.riskKeyword === 'string' && RISK_WORDS.has(raw.riskKeyword)
    ? (raw.riskKeyword as RiskLevel)
    : null
  return {
    splitMethPct: numOrNull(raw.splitMethPct),
    explicitMethPct: numOrNull(raw.explicitMethPct),
    explicitUsdyPct: numOrNull(raw.explicitUsdyPct),
    riskKeyword: risk,
    autoRebalance: raw.autoRebalance !== false,
    rebalanceThresholdPct: numOrNull(raw.rebalanceThresholdPct),
  }
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const address = (body.address || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'INVALID_ADDRESS' }, { status: 400 })
  }
  // SIWE: you can only save a policy for the wallet you've signed in as.
  const authErr = requireSelf(req, address)
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 })

  const rawIntent = (body.rawIntent || '').toString()
  let rules: WealthRules

  if (body.rules) {
    // Client supplied an already-structured policy — just normalize/clamp it.
    rules = normalizeRules(body.rules, rawIntent)
  } else if (rawIntent.trim()) {
    // STEP 1 signals (LLM, temp 0) → deterministic regex fallback when unavailable.
    const signals = (await aiExtractSignals(rawIntent)) ?? extractSignals(rawIntent)
    // STEP 2 deterministic priority chain decides the numbers + risk level.
    rules = rulesFromSignals(signals, rawIntent)
  } else {
    return NextResponse.json({ error: 'EMPTY_INTENT' }, { status: 400 })
  }

  await setIntent(address, rules)
  return NextResponse.json({ ok: true, rules })
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? ''
  if (!address) return NextResponse.json({ error: 'MISSING_ADDRESS' }, { status: 400 })
  return NextResponse.json({ rules: await getIntent(address) })
}
