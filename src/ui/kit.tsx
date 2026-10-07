// Small shared UI primitives so panels look consistent.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-black font-medium hover:bg-accent-strong',
  secondary: 'bg-panel-2 text-neutral-100 border border-line hover:bg-neutral-800',
  ghost: 'text-neutral-300 hover:bg-neutral-800 hover:text-white',
  danger: 'text-red-300 hover:bg-red-950/60 hover:text-red-200',
}

// Buttons default to type="button": inside a <form> the HTML default is
// "submit", which would submit the form on any click.
export function Button({ variant = 'secondary', className = '', children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, className = '', children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string | number>({
  value, options, onChange, size = 'sm', label,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange(v: T): void
  size?: 'xs' | 'sm'
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1 rounded px-2 ${size === 'xs' ? 'py-0.5 text-[11px]' : 'py-1 text-xs'} transition-colors ${
            value === o.value ? 'bg-neutral-200 font-medium text-black' : 'text-neutral-400 hover:text-neutral-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Section({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel-2/60 p-3 ${className}`}>
      {(title || aside) && (
        <header className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  // Orbit around a square "scene": simple, recognisable at 20px.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" opacity=".9" />
      <ellipse cx="12" cy="12" rx="10.5" ry="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" transform="rotate(-30 12 12)" />
      <circle cx="20.2" cy="6.5" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function relativeDays(date: string, now = Date.now()): string {
  const days = Math.round((now - Date.parse(`${date}T12:00:00Z`)) / 86400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 45) return `${days} days ago`
  if (days < 548) return `${Math.round(days / 30.4)} months ago`
  return `${(days / 365.25).toFixed(1)} years ago`
}

export function fmtDate(date: string, style: 'long' | 'short' = 'long'): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric', month: style === 'long' ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
  })
}
