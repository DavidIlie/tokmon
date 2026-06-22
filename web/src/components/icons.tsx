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
export const Folder = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /></Icon>
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
export const Sun = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>
)
export const Moon = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Icon>
)
export const Settings = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Icon>
)
export const Plus = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
)
export const Trash = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></Icon>
)
export const Pencil = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Icon>
)
export const ChevronUp = (p: SVGProps<SVGSVGElement> & { className?: string }) => (
  <Icon {...p}><path d="m18 15-6-6-6 6" /></Icon>
)
