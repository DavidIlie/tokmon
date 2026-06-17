import type { SVGProps } from 'react'

function Icon({ children, className = 'size-4', ...rest }: SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...rest}
    >
      {children}
    </svg>
  )
}

export const Camera = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Icon>
)
export const Check = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>
)
export const Copy = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
)
export const Download = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></Icon>
)
export const Share = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></Icon>
)
export const ChevronDown = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>
)
export const Search = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Icon>
)
export const X = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
)
export const ArrowUpDown = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></Icon>
)
export const Activity = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>
)
