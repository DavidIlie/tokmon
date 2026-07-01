import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readJson } from '../http'
import { resetIn } from '../format'
import type { Metric } from './types'
import { runSqlite, sqliteStatusMessage, type SqliteStatus } from './cursor/sqlite'

const CLOUD_CODE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
]
const LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist'
const FETCH_MODELS_PATH = '/v1internal:fetchAvailableModels'
const RETRIEVE_QUOTA_PATH = '/v1internal:retrieveUserQuota'
const GOOGLE_OAUTH_URL = 'https://oauth2.googleapis.com/token'

const GOOGLE_OAUTH_CLIENT_REGEX =
  /OAUTH_CLIENT_ID\s*=\s*["']([0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com)["']\s*;?\s*(?:var|const|let)?\s*OAUTH_CLIENT_SECRET\s*=\s*["'](GOCSPX-[A-Za-z0-9_-]+)["']/s
const MAX_BUNDLE_READ = 32 * 1024 * 1024

interface GoogleOAuthClient {
  clientId: string
  clientSecret: string
}
let cachedClient: GoogleOAuthClient | null | undefined

const OAUTH_TOKEN_KEY = 'antigravityUnifiedStateSync.oauthToken'
const OAUTH_TOKEN_SENTINEL = 'oauthTokenInfoSentinelKey'
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

export interface CloudCodeToken {
  accessToken: string | null
  refreshToken?: string | null
  expirySeconds?: number | null
}

export interface CloudCodeBucket {
  modelId: string
  remainingFraction: number
  resetTime?: string
}

export type CloudCodeResult =
  | { ok: true; plan: string | null; buckets: CloudCodeBucket[] }
  | { ok: false; plan: string | null; error: string }

interface ProtoField {
  type: number
  value?: number
  data?: Uint8Array
}

function readVarint(bytes: Uint8Array, start: number): { value: number; pos: number } | null {
  let value = 0
  let shift = 0
  let pos = start
  while (pos < bytes.length) {
    const b = bytes[pos++]
    value += (b & 0x7f) * Math.pow(2, shift)
    if ((b & 0x80) === 0) return { value, pos }
    shift += 7
  }
  return null
}

function readFields(bytes: Uint8Array): Record<number, ProtoField> {
  const fields: Record<number, ProtoField> = {}
  let pos = 0
  while (pos < bytes.length) {
    const tag = readVarint(bytes, pos)
    if (!tag) break
    pos = tag.pos
    const fieldNum = Math.floor(tag.value / 8)
    const wireType = tag.value % 8
    if (wireType === 0) {
      const val = readVarint(bytes, pos)
      if (!val) break
      fields[fieldNum] = { type: 0, value: val.value }
      pos = val.pos
    } else if (wireType === 1) {
      if (pos + 8 > bytes.length) break
      pos += 8
    } else if (wireType === 2) {
      const len = readVarint(bytes, pos)
      if (!len) break
      pos = len.pos
      if (pos + len.value > bytes.length) break
      fields[fieldNum] = { type: 2, data: bytes.slice(pos, pos + len.value) }
      pos += len.value
    } else if (wireType === 5) {
      if (pos + 4 > bytes.length) break
      pos += 4
    } else {
      break
    }
  }
  return fields
}

function utf8(data: Uint8Array): string {
  return Buffer.from(data).toString('utf8')
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    return Buffer.from(text, 'base64')
  } catch {
    return null
  }
}

function unwrapKeyringBase64(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('go-keyring-base64:')) return text
  const decoded = decodeBase64(text.slice('go-keyring-base64:'.length))
  return decoded ? utf8(decoded).trim() : text
}

function unwrapOAuthSentinel(base64Text: string): Uint8Array | null {
  const outerBytes = decodeBase64(unwrapKeyringBase64(base64Text))
  if (!outerBytes) return null
  const outer = readFields(outerBytes)
  if (outer[1]?.type !== 2 || !outer[1].data) return null
  const wrapper = readFields(outer[1].data)
  const sentinel = wrapper[1]?.type === 2 && wrapper[1].data ? utf8(wrapper[1].data) : null
  const payload = wrapper[2]?.type === 2 ? wrapper[2].data : null
  if (sentinel !== OAUTH_TOKEN_SENTINEL || !payload) return null
  const payloadFields = readFields(payload)
  if (payloadFields[1]?.type !== 2 || !payloadFields[1].data) return null
  const innerText = utf8(payloadFields[1].data).trim()
  return innerText ? decodeBase64(innerText) : null
}

export async function readAntigravityOAuthToken(db: string): Promise<{ token: CloudCodeToken | null; status: SqliteStatus }> {
  const r = await runSqlite(db, 'SELECT value FROM ItemTable WHERE key=? LIMIT 1;', [OAUTH_TOKEN_KEY])
  if (r.status !== 'ok') return { token: null, status: r.status }
  const raw = r.rows[0]?.value
  if (typeof raw !== 'string' || !raw.trim()) return { token: null, status: 'ok' }
  const inner = unwrapOAuthSentinel(raw)
  if (!inner) return { token: null, status: 'ok' }
  const fields = readFields(inner)
  const accessToken = fields[1]?.type === 2 && fields[1].data ? utf8(fields[1].data) : null
  const refreshToken = fields[3]?.type === 2 && fields[3].data ? utf8(fields[3].data) : null
  let expirySeconds: number | null = null
  if (fields[4]?.type === 2 && fields[4].data) {
    const ts = readFields(fields[4].data)
    expirySeconds = ts[1]?.type === 0 && typeof ts[1].value === 'number' ? ts[1].value : null
  }
  if (!accessToken && !refreshToken) return { token: null, status: 'ok' }
  return { token: { accessToken, refreshToken, expirySeconds }, status: 'ok' }
}

function redact(token: string | null | undefined): string {
  if (!token) return 'none'
  return `...${token.slice(-4)}`
}

function geminiBundleCandidates(): string[] {
  const candidates: string[] = []
  const addBundle = (nodeModulesRoot: string) => {
    if (!nodeModulesRoot) return
    candidates.push(join(nodeModulesRoot, '@google', 'gemini-cli', 'bundle'))
  }

  try {
    const which = process.platform === 'win32'
      ? spawnSync('where', ['gemini'], { encoding: 'utf8', timeout: 5000 })
      : spawnSync('sh', ['-lc', 'command -v gemini'], { encoding: 'utf8', timeout: 5000 })
    const resolved = typeof which.stdout === 'string' ? which.stdout.trim().split('\n')[0]?.trim() : ''
    if (resolved) candidates.push(resolved)
  } catch {
  }

  const home = homedir()
  if (process.platform === 'win32') {
    addBundle(join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm', 'node_modules'))
  } else {
    addBundle('/opt/homebrew/lib/node_modules')
    addBundle('/usr/local/lib/node_modules')
    addBundle(join(home, '.local', 'share', 'node_modules'))
    addBundle(join(home, '.bun', 'install', 'global', 'node_modules'))
  }

  try {
    const prefix = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['config', 'get', 'prefix'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32',
    })
    const root = typeof prefix.stdout === 'string' ? prefix.stdout.trim() : ''
    if (root && root !== 'undefined') {
      addBundle(process.platform === 'win32' ? join(root, 'node_modules') : join(root, 'lib', 'node_modules'))
    }
  } catch {
  }

  return [...new Set(candidates.filter(Boolean))]
}

async function resolveBundleDir(candidate: string): Promise<string | null> {
  try {
    if (candidate.endsWith(`${join('@google', 'gemini-cli', 'bundle')}`)) {
      return candidate
    }
    const real = await realpath(candidate)
    return dirname(real)
  } catch {
    return null
  }
}

async function scanBundleDir(dir: string): Promise<GoogleOAuthClient | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  const targets = entries.filter(name => name === 'gemini.js' || (name.startsWith('chunk-') && name.endsWith('.js')))
  for (const name of targets) {
    const filePath = join(dir, name)
    try {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_BUNDLE_READ) continue
      const contents = await readFile(filePath, 'utf8')
      if (!contents.includes('OAUTH_CLIENT_SECRET')) continue
      const match = GOOGLE_OAUTH_CLIENT_REGEX.exec(contents)
      if (match) return { clientId: match[1], clientSecret: match[2] }
    } catch {
    }
  }
  return null
}

async function discoverGoogleOAuthClient(): Promise<GoogleOAuthClient | null> {
  try {
    for (const candidate of geminiBundleCandidates()) {
      const dir = await resolveBundleDir(candidate)
      if (!dir) continue
      const found = await scanBundleDir(dir)
      if (found) return found
    }
  } catch {
  }
  return null
}

async function resolveGoogleClient(): Promise<GoogleOAuthClient | null> {
  const envId = process.env.TOKMON_GOOGLE_CLIENT_ID?.trim()
  const envSecret = process.env.TOKMON_GOOGLE_CLIENT_SECRET?.trim()
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret }
  if (cachedClient === undefined) cachedClient = await discoverGoogleOAuthClient()
  return cachedClient
}

async function refreshAccessToken(refreshToken: string | null | undefined): Promise<string | null> {
  if (!refreshToken) return null
  const client = await resolveGoogleClient()
  if (!client) return null
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  try {
    const res = await fetch(GOOGLE_OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const json = await readJson<{ access_token?: string }>(res)
    return typeof json?.access_token === 'string' && json.access_token.trim() ? json.access_token.trim() : null
  } catch {
    return null
  }
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

function normalizeLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function poolLabel(label: string, fullGeminiLabels = false): string {
  const lower = normalizeLabel(label).toLowerCase()
  // Claude is matched EXPLICITLY (Antigravity pools Claude models too) -- never
  // as a fallback, or non-pro/flash Gemini models render as a bogus "Claude"
  // quota row on the Gemini card.
  if (lower.includes('claude')) return 'Claude'
  if (lower.includes('gemini') && lower.includes('pro')) return fullGeminiLabels ? 'Gemini Pro' : 'Pro'
  if (lower.includes('gemini') && lower.includes('flash')) return fullGeminiLabels ? 'Gemini Flash' : 'Flash'
  if (lower.includes('gemini')) return 'Gemini'
  return normalizeLabel(label) || 'Other'
}

function sortKey(label: string): string {
  const lower = label.toLowerCase()
  if (lower === 'pro') return `0a_${label}`
  if (lower === 'flash') return `0b_${label}`
  if (lower === 'gemini') return `0c_${label}`
  if (lower === 'claude') return `1b_${label}`
  if (lower.includes('gemini') && lower.includes('pro')) return `0a_${label}`
  if (lower.includes('gemini')) return `0b_${label}`
  if (lower.includes('claude') && lower.includes('opus')) return `1a_${label}`
  if (lower.includes('claude')) return `1b_${label}`
  return `2_${label}`
}

export function cloudCodeBucketsToMetrics(buckets: CloudCodeBucket[], options: { fullGeminiLabels?: boolean } = {}): Metric[] {
  const pooled = new Map<string, CloudCodeBucket>()
  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.remainingFraction)) continue
    const label = poolLabel(bucket.modelId, options.fullGeminiLabels === true)
    const existing = pooled.get(label)
    if (!existing || bucket.remainingFraction < existing.remainingFraction) {
      pooled.set(label, { ...bucket, modelId: label })
    }
  }
  return [...pooled.values()]
    .sort((a, b) => sortKey(a.modelId).localeCompare(sortKey(b.modelId)))
    .map((bucket, i) => {
      const clamped = Math.max(0, Math.min(1, bucket.remainingFraction))
      return {
        label: bucket.modelId,
        used: Math.round((1 - clamped) * 100),
        limit: 100,
        format: { kind: 'percent' },
        resetsAt: bucket.resetTime ? resetIn(bucket.resetTime) : null,
        primary: i === 0,
      }
    })
}

export function cloudCodeSqliteError(status: SqliteStatus): string {
  return status === 'ok' ? 'Not signed in — open Antigravity' : sqliteStatusMessage(status).replace(/Cursor/g, 'Antigravity')
}
