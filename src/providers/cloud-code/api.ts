import { readJson } from '../../http'
import { refreshAccessToken, type CloudCodeToken } from './auth'

const CLOUD_CODE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
]
const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist'
const FETCH_MODELS_PATH = '/v1internal:fetchAvailableModels'
const RETRIEVE_QUOTA_PATH = '/v1internal:retrieveUserQuota'

const CC_MODEL_BLACKLIST: Record<string, true> = {
  MODEL_CHAT_20706: true,
  MODEL_CHAT_23310: true,
  MODEL_GOOGLE_GEMINI_2_5_FLASH: true,
  MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING: true,
  MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE: true,
  MODEL_GOOGLE_GEMINI_2_5_PRO: true,
  MODEL_PLACEHOLDER_M19: true,
  MODEL_PLACEHOLDER_M9: true,
  MODEL_PLACEHOLDER_M12: true,
}

export interface CloudCodeBucket {
  modelId: string
  remainingFraction: number
  resetTime?: string
}

export type CloudCodeResult =
  | { ok: true; plan: string | null; buckets: CloudCodeBucket[] }
  | { ok: false; plan: string | null; error: string }

function redact(token: string | null | undefined): string {
  if (!token) return 'none'
  return `...${token.slice(-4)}`
}

async function requestCloudCodeJson(path: string, token: string, body: unknown): Promise<any | null | { _authFailed: true }> {
  for (const base of CLOUD_CODE_URLS) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'agy',
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 401 || res.status === 403) return { _authFailed: true }
      if (!res.ok) continue
      const json = await readJson(res)
      if (json && typeof json === 'object') return json
    } catch {
    }
  }
  return null
}

function readPlan(loadData: any): string | null {
  const paid = typeof loadData?.paidTier?.name === 'string' ? loadData.paidTier.name.trim() : ''
  const current = typeof loadData?.currentTier?.name === 'string' ? loadData.currentTier.name.trim() : ''
  const raw = paid || current
  if (!raw) return null
  return raw.replace(/^Gemini Code Assist (?:in|for)\s+/i, '').replace(/^Gemini Code Assist$/i, 'Code Assist')
}

function readRemainingFraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseBuckets(data: any): CloudCodeBucket[] {
  if (!Array.isArray(data?.buckets)) return []
  return data.buckets.flatMap((bucket: any) => {
    const modelId = typeof bucket?.modelId === 'string' ? bucket.modelId.trim() : ''
    if (!modelId) return []
    const remainingFraction = readRemainingFraction(bucket.remainingFraction)
    if (remainingFraction === null) return []
    return [{
      modelId,
      remainingFraction,
      resetTime: typeof bucket.resetTime === 'string' ? bucket.resetTime : undefined,
    }]
  })
}

function parseModelBuckets(data: any): CloudCodeBucket[] {
  const models = data?.models
  if (!models || typeof models !== 'object') return []
  return Object.keys(models).flatMap(key => {
    const model = models[key]
    if (!model || typeof model !== 'object' || model.isInternal) return []
    const modelId = typeof model.model === 'string' && model.model.trim() ? model.model.trim() : key
    if (CC_MODEL_BLACKLIST[modelId]) return []
    const displayName =
      (typeof model.displayName === 'string' && model.displayName.trim()) ||
      (typeof model.label === 'string' && model.label.trim()) ||
      ''
    if (!displayName) return []
    const quotaInfo = model.quotaInfo
    const remainingFraction = readRemainingFraction(quotaInfo?.remainingFraction)
    if (remainingFraction === null) return []
    return [{
      modelId: displayName,
      remainingFraction,
      resetTime: typeof quotaInfo?.resetTime === 'string' ? quotaInfo.resetTime : undefined,
    }]
  })
}

async function fetchWithAccessToken(accessToken: string): Promise<CloudCodeResult> {
  const loadData = await requestCloudCodeJson(LOAD_CODE_ASSIST_PATH, accessToken, {})
  if (!loadData) return { ok: false, plan: null, error: 'Cloud Code API error' }
  if ('_authFailed' in loadData) return { ok: false, plan: null, error: 'Token expired' }

  const plan = readPlan(loadData)
  const project = typeof loadData.cloudaicompanionProject === 'string' && loadData.cloudaicompanionProject.trim()
    ? loadData.cloudaicompanionProject.trim()
    : null

  let quotaData = project
    ? await requestCloudCodeJson(RETRIEVE_QUOTA_PATH, accessToken, { project })
    : null
  if (!quotaData || ('_authFailed' in quotaData)) {
    quotaData = await requestCloudCodeJson(RETRIEVE_QUOTA_PATH, accessToken, {})
  }
  if (!quotaData) return { ok: false, plan, error: 'Cloud Code quota unavailable' }
  if ('_authFailed' in quotaData) return { ok: false, plan, error: 'Token expired' }

  let buckets = parseBuckets(quotaData)
  if (buckets.length === 0) {
    const modelData = await requestCloudCodeJson(FETCH_MODELS_PATH, accessToken, {})
    if (modelData && !('_authFailed' in modelData)) buckets = parseModelBuckets(modelData)
    if (modelData && '_authFailed' in modelData) return { ok: false, plan, error: 'Token expired' }
  }
  if (buckets.length === 0) return { ok: false, plan, error: 'No quota data' }
  return { ok: true, plan, buckets }
}

export async function fetchCloudCodeQuota(token: CloudCodeToken, expiredMessage = 'Token expired'): Promise<CloudCodeResult> {
  const nowSec = Math.floor(Date.now() / 1000)
  let accessToken = token.accessToken?.trim() || null
  if (accessToken && token.expirySeconds && token.expirySeconds <= nowSec) {
    accessToken = await refreshAccessToken(token.refreshToken)
    if (!accessToken) return { ok: false, plan: null, error: expiredMessage }
  }
  if (!accessToken) {
    accessToken = await refreshAccessToken(token.refreshToken)
    if (!accessToken) return { ok: false, plan: null, error: `Missing credentials (${redact(token.accessToken)})` }
  }

  const result = await fetchWithAccessToken(accessToken)
  if (result.ok || result.error !== 'Token expired') return result

  const refreshed = await refreshAccessToken(token.refreshToken)
  if (!refreshed) return { ok: false, plan: result.plan, error: expiredMessage }
  return fetchWithAccessToken(refreshed)
}
