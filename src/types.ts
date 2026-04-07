export interface UsageSummary {
  cost: number
  tokens: number
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
}

export interface AppData {
  today: UsageSummary
  week: UsageSummary
  month: UsageSummary
  daily: TableRow[]
  weekly: TableRow[]
  monthly: TableRow[]
}
