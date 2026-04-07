export interface UsageSummary {
  cost: number
  tokens: number
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
