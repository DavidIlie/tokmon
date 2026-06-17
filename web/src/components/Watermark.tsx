// The tokmon watermark, baked into every export node (never dialog chrome) so it
// survives capture and can't be cropped. The mark is just "tokmon" — never a name.
export function Watermark({ variant = 'footer', version }: { variant?: 'footer' | 'corner'; version?: string }) {
  if (variant === 'corner') {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded bg-bg-0/60 px-2 py-1 font-display text-[11px] tracking-wide text-fg-faint backdrop-blur-sm">
        <span className="text-accent">●</span> tokmon
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 font-display text-sm tracking-wide">
      <span className="text-accent">●</span>
      <span className="text-fg-bright">tokmon</span>
      <span className="text-xs tracking-normal text-fg-faint">github.com/DavidIlie/tokmon{version ? ` · v${version}` : ''}</span>
    </div>
  )
}
