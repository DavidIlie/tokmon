export interface UsageSummary {
  cost: number
  tokens: number
  /** Cache-read tokens included in `tokens`. */
  cacheRead: number
  /** USD the cache saved vs paying full input rate for those reads. */
  cacheSavings: number
}

export interface ModelDetail {
  name: string
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  cost: number
}

export interface TableRow {
  label: string
  models: string[]
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  total: number
  cost: number
  breakdown: ModelDetail[]
}

export interface DashboardData {
  today: UsageSummary
  week: UsageSummary
  month: UsageSummary
  burnRate: number
  /** Daily cost for the last N days (oldest→newest) for the history sparkline. */
  series: number[]
}

export interface TableData {
  daily: TableRow[]
  weekly: TableRow[]
  monthly: TableRow[]
}
