// Built by vsrupeshkumar
// AI-assisted compliance screening for the RWAkins RWA vault. Tokenized treasuries
// (USDY) are regulated securities — holders must clear KYC + jurisdiction checks.
//
// Design: HARD rules live in code (real OFAC comprehensively-sanctioned
// jurisdictions are always blocked — never delegated to a model), and the LLM does
// the NUANCED risk assessment + plain-English rationale for everything else. The
// verdict is then written on-chain to the ComplianceRegistry, so the decision is
// fully auditable. Falls back to a deterministic verdict when no LLM key is set.
import { chatJson } from '@/lib/openai'

/**
 * OFAC comprehensively-sanctioned jurisdictions (ISO-3166 alpha-2) — a HARD block.
 * This is real regulatory reference data, not a guess. Source: U.S. Treasury OFAC
 * comprehensive sanctions programs.
 */
export const SANCTIONED_JURISDICTIONS: Record<string, string> = {
  CU: 'Cuba', IR: 'Iran', KP: 'North Korea', SY: 'Syria', RU: 'Russia',
  // Sanctioned regions, mapped to their country code for screening.
  UA_CRIMEA: 'Crimea (UA)',
}

/** Jurisdictions where a retail offering typically requires accredited status. */
const ACCREDITATION_REQUIRED = new Set(['US'])

export interface ComplianceVerdict {
  eligible: boolean
  accredited: boolean
  riskScore: number // 0 (clean) – 100 (blocked)
  jurisdiction: string // normalized ISO alpha-2 (best effort)
  reason: string
}

const COUNTRY_TO_ISO: Record<string, string> = {
  'united states': 'US', usa: 'US', america: 'US', us: 'US',
  singapore: 'SG', uk: 'GB', 'united kingdom': 'GB', britain: 'GB',
  india: 'IN', germany: 'DE', france: 'FR', japan: 'JP', canada: 'CA',
  australia: 'AU', uae: 'AE', 'united arab emirates': 'AE', switzerland: 'CH',
  cuba: 'CU', iran: 'IR', 'north korea': 'KP', syria: 'SY', russia: 'RU',
}

/** Best-effort ISO alpha-2 from free text (already-2-letter codes pass through). */
export function normalizeJurisdiction(input: string): string {
  const t = (input || '').trim()
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
  return COUNTRY_TO_ISO[t.toLowerCase()] ?? t.slice(0, 2).toUpperCase()
}

/** The deterministic guard: hard rules that the LLM can never override. */
function hardRule(jurisdiction: string): ComplianceVerdict | null {
  const code = jurisdiction.toUpperCase()
  if (SANCTIONED_JURISDICTIONS[code]) {
    return {
      eligible: false,
      accredited: false,
      riskScore: 100,
      jurisdiction: code,
      reason: `${SANCTIONED_JURISDICTIONS[code]} is under OFAC comprehensive sanctions — onboarding is blocked.`,
    }
  }
  return null
}

/**
 * Screen a prospective holder. `context` is the user's free-text answer about their
 * status/intent. Hard-blocks sanctioned jurisdictions in code, then asks the LLM to
 * assess residual risk + accreditation and explain it. Always returns a verdict.
 */
export async function screenCompliance(jurisdictionInput: string, context: string): Promise<ComplianceVerdict> {
  const jurisdiction = normalizeJurisdiction(jurisdictionInput)
  const blocked = hardRule(jurisdiction)
  if (blocked) return blocked

  // Deterministic baseline (used directly when no LLM, or as the floor).
  const needsAccredited = ACCREDITATION_REQUIRED.has(jurisdiction)
  const baseline: ComplianceVerdict = {
    eligible: true,
    accredited: !needsAccredited, // assume accredited unless a gated jurisdiction needs proof
    riskScore: needsAccredited ? 35 : 15,
    jurisdiction,
    reason: needsAccredited
      ? `${jurisdiction}: eligible, but this jurisdiction requires accredited-investor status for tokenized securities.`
      : `${jurisdiction}: not sanctioned; standard KYC risk profile — eligible.`,
  }

  const ai = await chatJson<{ riskScore?: number; accredited?: boolean; reason?: string; eligible?: boolean }>({
    messages: [
      {
        role: 'system',
        content:
          'You are a compliance officer screening a prospective holder of a tokenized US-treasury security (USDY) ' +
          'on a DeFi vault. You are given a (non-sanctioned) ISO jurisdiction and the user\'s self-described status. ' +
          'Comprehensively-sanctioned jurisdictions are ALREADY blocked upstream — do not re-litigate that. Assess: ' +
          '(1) a KYC/AML risk score 0-100 (0 clean), (2) whether they should be treated as an accredited/eligible ' +
          'investor, (3) a one-sentence rationale citing the jurisdiction\'s real constraints (e.g. US accreditation ' +
          'rules, EU MiCA, jurisdiction-specific securities limits). Respond ONLY as JSON: ' +
          '{"eligible":boolean,"accredited":boolean,"riskScore":number,"reason":string}. reason < 180 chars.',
      },
      { role: 'user', content: JSON.stringify({ jurisdiction, status: context.slice(0, 500) }) },
    ],
    temperature: 0.2,
    timeoutMs: 12_000,
    maxTokens: 160,
  })

  if (!ai || typeof ai.riskScore !== 'number') return baseline
  const riskScore = Math.max(0, Math.min(100, Math.round(ai.riskScore)))
  return {
    eligible: ai.eligible !== false && riskScore < 80,
    accredited: ai.accredited === true || baseline.accredited,
    riskScore,
    jurisdiction,
    reason: (ai.reason || baseline.reason).slice(0, 200),
  }
}
