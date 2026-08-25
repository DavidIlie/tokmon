import type { QuotaSourceConfig } from '../../config-schema'

export type QuotaSourceFetchResult =
  | { ok: true; response: Response }
  | { ok: false; error: string }

export async function fetchQuotaSource(
  source: QuotaSourceConfig,
  providerHeaders: Record<string, string> = {},
): Promise<QuotaSourceFetchResult> {
  const apiKey = process.env[source.apiKeyEnv]?.trim()
  if (!apiKey) return { ok: false, error: `API key environment variable ${source.apiKeyEnv} is not set` }
  try {
    const response = await fetch(source.url, {
      headers: {
        ...providerHeaders,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'tokmon',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: true, response }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}
