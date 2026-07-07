import { useState } from 'react'
import { containsEmail, redactEmail } from '@shared'

export function privacyText(value: string, privacyMode: boolean): string {
  return privacyMode ? redactEmail(value) : value
}

export function PrivacyLabel({ value, privacyMode, className, title }: {
  value: string
  privacyMode: boolean
  className?: string
  title?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const sensitive = privacyMode && containsEmail(value)
  if (!sensitive || revealed) return <span className={className} title={title ?? value}>{value}</span>
  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={`min-w-0 cursor-pointer truncate text-left ${className ?? ''}`}
      title="Click to reveal email"
      aria-label="Email hidden. Click to reveal."
    >
      <span className="inline-block max-w-full truncate blur-sm transition hover:blur-[2px]">{redactEmail(value)}</span>
    </button>
  )
}
