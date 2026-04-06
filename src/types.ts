export interface UsageSummary {
  cost: number
  tokens: number
}

export interface BlockInfo {
  spent: number
  projected: number
  burnRate: number
  percent: number
  remaining: string
}

export interface UsageData {
  today: UsageSummary
  week: UsageSummary
  month: UsageSummary
  block: BlockInfo | null
}
