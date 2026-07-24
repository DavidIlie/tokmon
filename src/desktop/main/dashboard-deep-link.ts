import type { DashboardPath } from '../shared/desktop-contract'

export function dashboardDeepLink(
  baseUrl: string,
  path: DashboardPath = '/',
): string {
  const url = new URL(baseUrl)
  url.pathname = '/'
  url.hash = path === '/' ? '/overview' : path
  return url.toString()
}
