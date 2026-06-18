export interface UsageSummary {
  cost: number
  tokens: number
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
  cacheSavings: number
  cost: number
  count: number
}

export interface TableRow {
  label: string
  models: string[]
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  cacheSavings: number
  total: number
  cost: number
  count: number
  breakdown: ModelDetail[]
}

export interface DashboardData {
  today: UsageSummary
  week: UsageSummary
  month: UsageSummary
  burnRate: number
  series: number[]
}

export interface TableData {
  daily: TableRow[]
  weekly: TableRow[]
  monthly: TableRow[]
}
