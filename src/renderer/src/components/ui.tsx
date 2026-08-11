import type { ReactNode } from 'react'
import { IconAlert, IconCheck, IconInfo, IconX } from '../lib/icons'
import { useStore } from '../lib/store'

export function Card({
  title,
  description,
  actions,
  children,
  flush = false
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
}): React.JSX.Element {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="card__desc">{description}</p>}
          </div>
          {actions && <div className="card__head-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'card__body'}>{children}</div>
    </section>
  )
}

/** Four stats read as one instrument, so they share a single bordered strip. */
export function StatStrip({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="strip">{children}</div>
}

export function Stat({
  label,
  value,
  meta,
  tone
}: {
  label: string
  value: ReactNode
  meta?: ReactNode
  tone?: 'success' | 'danger' | 'accent'
}): React.JSX.Element {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${tone ? ` ${tone}-text` : ''}`}>{value}</span>
      {meta && <span className="stat__meta">{meta}</span>}
    </div>
  )
}

export function Tag({
  tone,
  children
}: {
  tone?: 'accent' | 'success' | 'danger'
  children: ReactNode
}): React.JSX.Element {
  return <span className={`tag${tone ? ` tag--${tone}` : ''}`}>{children}</span>
}

export function Tile({
  label,
  value,
  metric = false
}: {
  label: string
  value: ReactNode
  metric?: boolean
}): React.JSX.Element {
  return (
    <div className={`tile${metric ? ' tile--metric' : ''}`}>
      <span className="tile__text">
        <span className="tile__sub">{label}</span>
        <span className="tile__title">{value}</span>
      </span>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  danger = false,
  disabled = false
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={`switch${danger ? ' switch--danger' : ''}`}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      {(label || hint) && (
        <span className="tile__text">
          {label && <span className="tile__title">{label}</span>}
          {hint && <span className="tile__sub">{hint}</span>}
        </span>
      )}
    </label>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Empty({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <span className="empty__icon">{icon}</span>
      <span className="empty__title">{title}</span>
      <span className="empty__text">{text}</span>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}

export function Callout({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'accent' | 'danger' | 'success'
  children: ReactNode
}): React.JSX.Element {
  const Icon = tone === 'danger' ? IconAlert : tone === 'success' ? IconCheck : IconInfo
  return (
    <div className={`callout${tone === 'neutral' ? '' : ` callout--${tone}`}`}>
      <Icon size={14} className="callout__icon" />
      <div className="prose">{children}</div>
    </div>
  )
}

export function Modal({
  title,
  description,
  onClose,
  footer,
  children
}: {
  title: string
  description?: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <header className="modal__head">
          <div className="inline">
            <h2>{title}</h2>
            <span className="spacer" />
            <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
              <IconX size={14} />
            </button>
          </div>
          {description && <p className="card__desc">{description}</p>}
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const { toasts, dismiss } = useStore()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? IconCheck : toast.kind === 'error' ? IconAlert : IconInfo
        return (
          <div
            key={toast.id}
            className={`toast toast--${toast.kind}`}
            onClick={() => dismiss(toast.id)}
          >
            <Icon size={14} className="toast__icon" />
            <span>{toast.text}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Meter({ value }: { value: number }): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const tone = pct > 60 ? 'success' : pct > 25 ? '' : 'danger'
  return (
    <div className="meter">
      <div className={`meter__fill${tone ? ` meter__fill--${tone}` : ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Layout-shaped loading state, not a spinner floating in empty space. */
export function Skeleton({
  height = 14,
  width = '100%',
  radius
}: {
  height?: number
  width?: number | string
  radius?: number
}): React.JSX.Element {
  return (
    <div
      className="skel"
      style={{ height, width, ...(radius !== undefined ? { borderRadius: radius } : {}) }}
    />
  )
}
