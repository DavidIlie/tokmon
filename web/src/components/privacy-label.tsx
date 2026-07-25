import { useState } from 'react'
import { containsEmail, redactEmail } from '@shared'
import { FOCUS_RING } from './ui/primitives'

export function privacyText(value: string, privacyMode: boolean): string {
  return privacyMode ? redactEmail(value) : value
}

export function PrivacyLabel({ value, projected, privacyMode, className, title }: {
  value: string
  /**
   * The strict privacy label from projectAccountIdentity. Supplied wherever the
   * value is an account identity, because a display name carries no email for
   * redactEmail to find and would otherwise render verbatim.
   */
  projected?: string
  privacyMode: boolean
  className?: string
  title?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const masked = privacyMode && !revealed
    ? projected ?? (containsEmail(value) ? redactEmail(value) : null)
    : null
  if (masked === null) return <span className={className} title={title ?? value}>{value}</span>
  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={`min-w-0 cursor-pointer truncate rounded text-left ${FOCUS_RING} ${className ?? ''}`}
      title={projected ? 'Click to reveal identity' : 'Click to reveal email'}
      aria-label={projected ? 'Identity hidden. Click to reveal.' : 'Email hidden. Click to reveal.'}
    >
      {/* A projected label discloses nothing, so it reads plainly; a redacted
          email still blurs, since its shape hints at the address. */}
      <span className={`inline-block max-w-full truncate${projected ? '' : ' blur-sm transition hover:blur-[2px]'}`}>{masked}</span>
    </button>
  )
}
