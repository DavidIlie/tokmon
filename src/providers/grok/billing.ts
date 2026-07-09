import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { identityFields } from '../_shared/identity'
import { finite, numberValue, percentMetric } from '../_shared/metric'
import { msToIso } from '../_shared/time'
import { grokClientVersion, readGrokAuth, readGrokIdentity } from './identity'

const DEFAULT_BILLING_BASE = 'https://grok.com'
const BILLING_PATH = '/billing?format=credits'

function billingBase(): string {
  // Billing is grok.com-only. Never redirect the session bearer via env
  // (GROK_CLI_CHAT_PROXY_BASE_URL is inference; shipping OIDC tokens there is unsafe).
  return DEFAULT_BILLING_BASE
}

function num(v: unknown): number | undefined {
  return numberValue(v) ?? (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
}

function periodMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 10_000_000_000 ? v : v * 1000
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

export async function grokBilling(account: Account): Promise<BillingResult> {
  const identity = readGrokIdentity(account.homeDir)
  const auth = readGrokAuth(account.homeDir)
  if (!auth?.key) {
    return {
      plan: null,
      metrics: [],
      error: 'Not signed in — run `grok login`',
      ...identityFields(identity),
    }
  }

  const version = grokClientVersion(account.homeDir)
  try {
    const res = await fetch(`${billingBase()}${BILLING_PATH}`, {
      headers: {
        Authorization: `Bearer ${auth.key}`,
        'x-grok-client-version': version,
        Accept: 'application/json',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (res.status === 401 || res.status === 403) {
      return {
        plan: null,
        metrics: [],
        error: 'Billing requires grok.com auth — run `grok login`',
        ...identityFields(identity),
      }
    }
    if (!res.ok) {
      return {
        plan: null,
        metrics: [],
        error: `Billing HTTP ${res.status}`,
        ...identityFields(identity),
      }
    }
    const data = await readJson<any>(res)
    if (!data || typeof data !== 'object') {
      return { plan: null, metrics: [], error: 'Empty billing response', ...identityFields(identity) }
    }

    // Response may be flat BillingConfig or wrapped { config / billing / data }.
    const cfg = data.currentPeriod !== undefined || data.creditUsagePercent !== undefined
      ? data
      : (data.config ?? data.billing ?? data.data ?? data)

    const metrics: Metric[] = []
    const usagePct = num(cfg.creditUsagePercent)
    if (usagePct !== undefined) {
      const end = periodMs(cfg.billingPeriodEnd ?? cfg.currentPeriod?.end ?? cfg.currentPeriod?.billingPeriodEnd)
      metrics.push(percentMetric('Credits', finite(usagePct), end ? msToIso(end) : null, true))
    }

    const monthlyLimit = num(cfg.monthlyLimit)
    const includedUsed = num(cfg.includedUsed ?? cfg.currentPeriod?.includedUsed ?? cfg.totalUsed)
    if (monthlyLimit !== undefined && monthlyLimit > 0 && includedUsed !== undefined) {
      metrics.push({
        label: 'Included',
        used: includedUsed,
        limit: monthlyLimit,
        format: { kind: 'count' },
        primary: metrics.length === 0,
      })
    }

    const onDemandCap = num(cfg.onDemandCap)
    const onDemandUsed = num(cfg.onDemandUsed)
    if (onDemandCap !== undefined && onDemandCap > 0) {
      metrics.push({
        label: 'On-demand',
        used: onDemandUsed ?? 0,
        limit: onDemandCap,
        format: { kind: 'dollars' },
      })
    } else if (onDemandUsed !== undefined && onDemandUsed > 0) {
      metrics.push({
        label: 'On-demand',
        used: onDemandUsed,
        limit: null,
        format: { kind: 'dollars' },
      })
    }

    const prepaid = num(cfg.prepaidBalance)
    if (prepaid !== undefined) {
      metrics.push({
        label: 'Credits left',
        used: prepaid,
        limit: null,
        format: { kind: 'dollars' },
      })
    }

    const plan = typeof cfg.plan === 'string' && cfg.plan.trim()
      ? cfg.plan.trim()
      : cfg.isUnifiedBillingUser === true
        ? 'SuperGrok'
        : identity.tier !== undefined
          ? `Tier ${identity.tier}`
          : 'Grok'

    return {
      plan,
      metrics,
      error: metrics.length ? null : 'No billing metrics',
      ...identityFields(identity),
    }
  } catch (err) {
    return {
      plan: null,
      metrics: [],
      error: err instanceof Error ? err.message : 'Billing request failed',
      ...identityFields(identity),
    }
  }
}
