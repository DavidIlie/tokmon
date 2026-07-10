const safeSlug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export'

export function shareFilename(prefix: string, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `tokmon-${safeSlug(prefix)}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`
}
