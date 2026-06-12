// Shared "wealth rules" model for the AI CFO onboarding flow.
//
// A user describes their financial goals in plain English on /onboarding. That
// free text is turned into a structured, on-chain-safe allocation policy here.
// The SAME parser is the deterministic fallback inside /api/saveIntent, so the
// client confirmation and the server-persisted rules can never disagree, and the
// resulting mETH share can never exceed the vault's on-chain MAX_RISK_BPS cap.

export type RiskLevel = 'low' | 'medium' | 'high'

export interface WealthRules {
  riskLevel: RiskLevel
  defaultAsset: 'USDY' | 'mETH'
  targetUsdyBps: number // sums to 10_000 with targetMethBps
  targetMethBps: number // hard-capped at MAX_RISK_BPS (mirrors RWAkinsRWAVault)
  autoRebalance: boolean
  rebalanceThresholdPct: number
  rawIntent: string
  updatedAt: string
}

/** Mirror of RWAkinsRWAVault.MAX_RISK_BPS — mETH can never exceed 70%. */
export const MAX_RISK_BPS = 7000
const TOTAL_BPS = 10_000

const RISK_TO_METH_BPS: Record<RiskLevel, number> = {
  low: 2000, // 20% mETH / 80% USDY — capital preservation
  medium: 4000, // 40% mETH / 60% USDY — balanced
  high: 7000, // 70% mETH / 30% USDY — growth, at the on-chain ceiling
}

/** Clamp any allocation to the on-chain invariants: sum == 100%, mETH <= cap. */
export function clampAllocation(methBps: number): { usdyBps: number; methBps: number } {
  let m = Math.round(Number.isFinite(methBps) ? methBps : 4000)
  if (m < 0) m = 0
  if (m > MAX_RISK_BPS) m = MAX_RISK_BPS
  return { usdyBps: TOTAL_BPS - m, methBps: m }
}

/**
 * Structured SIGNALS extracted from a user's plain-English goal. This is the
 * ONLY thing the parsing LLM is allowed to produce — it reports what the user
 * literally expressed and makes NO allocation decision. The deterministic
 * priority chain (resolveAllocationFromSignals) turns these signals into the
 * actual numbers, so the math is auditable and never hallucinated.
 */
export interface IntentSignals {
  /** P1: the mETH side of a bare "A/B" USDY/mETH split (e.g. "50/50" → 50), else null. */
  splitMethPct: number | null
  /** P2: a percentage the user explicitly assigned to mETH (e.g. "10% mETH" → 10), else null. */
  explicitMethPct: number | null
  /** P2: a percentage the user explicitly assigned to USDY (mETH = remainder), else null. */
  explicitUsdyPct: number | null
  /** P3: the user's risk tone, used only when no numbers are present. */
  riskKeyword: RiskLevel | null
  autoRebalance: boolean
  /** Drift threshold the user implied (tight/loose), else null → default. */
  rebalanceThresholdPct: number | null
}

/**
 * Deterministic SIGNAL extraction from raw text — the no-LLM fallback and the
 * shape the parsing LLM mirrors. Pure regex; decides nothing on its own.
 */
export function extractSignals(text: string): IntentSignals {
  const t = (text || '').toLowerCase()

  // P1 — bare split "50/50", "60/40": app convention is USDY/mETH, so 2nd = mETH.
  const split = t.match(/(\d{1,3})\s*\/\s*(\d{1,3})/)
  // P2 — explicit per-asset percentages.
  const methM = t.match(/(\d{1,3})\s*(?:%|percent)?\s*(?:in|to|of|into)?\s*(?:m-?eth|staked\s*eth)/)
  const usdyM = t.match(/(\d{1,3})\s*(?:%|percent)?\s*(?:in|to|of|into)?\s*(?:usdy|stable)/)

  // P3 — risk tone.
  let riskKeyword: RiskLevel | null = null
  if (/\b(aggressive|high risk|high-risk|maximi[sz]e|max yield|risky|growth|degen)\b/.test(t)) {
    riskKeyword = 'high'
  } else if (/\b(safe|conservative|low risk|low-risk|preserve|capital preservation|stable|protect|cautious)\b/.test(t)) {
    riskKeyword = 'low'
  }

  let rebalanceThresholdPct: number | null = null
  if (/\b(tight|frequent|aggressive rebalanc)\b/.test(t)) rebalanceThresholdPct = 3
  else if (/\b(loose|rare|infrequent|hands off|hands-off)\b/.test(t)) rebalanceThresholdPct = 10

  return {
    splitMethPct: split ? Number(split[2]) : null,
    explicitMethPct: methM ? Number(methM[1]) : null,
    explicitUsdyPct: usdyM ? Number(usdyM[1]) : null,
    riskKeyword,
    autoRebalance: !/\b(manual|no rebalanc|don'?t rebalance|never rebalance)\b/.test(t),
    rebalanceThresholdPct,
  }
}

/**
 * The DETERMINISTIC PRIORITY CHAIN — the single source of allocation truth.
 *   Priority 1  split keywords  ("50/50")
 *   Priority 2  explicit numbers ("10% mETH" / "90% USDY"), clamped to the cap
 *   Priority 3  risk-keyword default — ONLY when no numbers were given
 * Runs in code (never the LLM), and clampAllocation enforces mETH ≤ 70%.
 */
export function resolveAllocationFromSignals(s: IntentSignals): { usdyBps: number; methBps: number } {
  let methBps: number
  if (s.splitMethPct != null) {
    methBps = s.splitMethPct * 100 // P1
  } else if (s.explicitMethPct != null) {
    methBps = s.explicitMethPct * 100 // P2
  } else if (s.explicitUsdyPct != null) {
    methBps = (100 - s.explicitUsdyPct) * 100 // P2
  } else {
    methBps = RISK_TO_METH_BPS[s.riskKeyword ?? 'medium'] // P3
  }
  return clampAllocation(methBps) // clamps mETH to MAX_RISK_BPS (70%)
}

/** Risk level is ALWAYS derived from the final number in code — never the LLM. */
export function deriveRiskFromMethBps(methBps: number): RiskLevel {
  return methBps >= 5500 ? 'high' : methBps <= 2500 ? 'low' : 'medium'
}

/** Assemble final WealthRules from extracted signals via the priority chain. */
export function rulesFromSignals(s: IntentSignals, rawIntent: string): WealthRules {
  const { usdyBps, methBps } = resolveAllocationFromSignals(s)
  return {
    riskLevel: deriveRiskFromMethBps(methBps),
    // Hard rule: the default (fallback) asset is ALWAYS USDY, regardless of risk
    // level or any asset the user names. mETH is only ever held up to the target.
    defaultAsset: 'USDY',
    targetUsdyBps: usdyBps,
    targetMethBps: methBps,
    autoRebalance: s.autoRebalance,
    rebalanceThresholdPct: s.rebalanceThresholdPct ?? 5,
    rawIntent: (rawIntent || '').trim().slice(0, 600),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Deterministic plain-English → WealthRules parser. Intentionally simple and
 * dependency-free so the flow works with no AI key configured: it runs the same
 * signal-extraction → priority-chain pipeline, just with regex signals.
 */
export function parseIntent(text: string): WealthRules {
  return rulesFromSignals(extractSignals(text), text)
}

/** Validate + clamp an arbitrary (e.g. AI-produced) rules object into a safe one. */
export function normalizeRules(input: Partial<WealthRules>, rawIntent: string): WealthRules {
  const risk: RiskLevel =
    input.riskLevel === 'low' || input.riskLevel === 'high' ? input.riskLevel : 'medium'
  const methSource =
    typeof input.targetMethBps === 'number' ? input.targetMethBps : RISK_TO_METH_BPS[risk]
  const { usdyBps, methBps } = clampAllocation(methSource)
  return {
    riskLevel: risk,
    // Hard rule: the fallback asset is ALWAYS USDY, regardless of risk level or
    // what the model returned (mirrors parseIntent).
    defaultAsset: 'USDY',
    targetUsdyBps: usdyBps,
    targetMethBps: methBps,
    autoRebalance: input.autoRebalance !== false,
    rebalanceThresholdPct:
      typeof input.rebalanceThresholdPct === 'number' && input.rebalanceThresholdPct > 0
        ? Math.min(50, Math.round(input.rebalanceThresholdPct))
        : 5,
    rawIntent: (rawIntent || input.rawIntent || '').trim().slice(0, 600),
    updatedAt: new Date().toISOString(),
  }
}

/** One-line human summary used for the chat confirmation and the dashboard panel. */
export function summarizeRules(r: WealthRules): string {
  const usdyPct = Math.round(r.targetUsdyBps / 100)
  const methPct = Math.round(r.targetMethBps / 100)
  const reb = r.autoRebalance ? `auto-rebalance at ${r.rebalanceThresholdPct}% drift` : 'manual rebalance'
  return `${r.riskLevel} risk · default ${r.defaultAsset} · target ${usdyPct}% USDY / ${methPct}% mETH · ${reb}`
}

// ── Client-side persistence (no off-chain DB; keyed by wallet) ────────────────

export const intentStorageKey = (address: string) => `rwakins:intent:${address.toLowerCase()}`

export function loadIntent(address: string | null | undefined): WealthRules | null {
  if (!address || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(intentStorageKey(address))
    return raw ? (JSON.parse(raw) as WealthRules) : null
  } catch {
    return null
  }
}

export function saveIntentLocal(address: string, rules: WealthRules): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(intentStorageKey(address), JSON.stringify(rules))
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
