import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { FOCUS_RING } from './primitives'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'xs'

const VARIANTS: Record<Variant, string> = {
  primary: 'border border-accent/60 bg-bg-1 text-accent hover:bg-bg-2',
  secondary: 'border border-line bg-bg-1 text-fg-dim hover:border-line-2 hover:text-fg',
  ghost: 'text-fg-faint hover:text-fg',
}

const SIZES: Record<Size, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  xs: 'gap-1 px-2 py-1 text-[11px]',
}

export type ButtonProps = {
  variant?: Variant
  size?: Size
} & ButtonHTMLAttributes<HTMLButtonElement>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center rounded transition active:scale-[0.97] disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${FOCUS_RING} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
