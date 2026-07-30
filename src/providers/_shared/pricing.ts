interface PriceResolverOptions<Price> {
  fallback: Price
  matches?: (model: string, key: string) => boolean
}

function prefixMatches(model: string, key: string): boolean {
  if (!model.startsWith(key)) return false
  const rest = model.slice(key.length)
  return rest === '' || rest[0] === '-'
}

export function makePriceResolver<Price>(
  pricing: Readonly<Record<string, Price>>,
  options: PriceResolverOptions<Price>,
): (model: string) => Price {
  const keys = Object.keys(pricing).sort((a, b) => b.length - a.length)
  const matches = options.matches ?? prefixMatches
  return (model: string) => {
    const normalized = model.toLowerCase().trim()
    for (const key of keys) {
      if (matches(normalized, key)) return pricing[key]
    }
    return options.fallback
  }
}
