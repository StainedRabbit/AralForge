import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}

export function SectionHeading({
  action,
  subtitle,
  title,
}: {
  action?: ReactNode
  subtitle: string
  title: string
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>
}

export function SearchBox({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="search-box">
      <Icon name="search" />
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  )
}

export function StatCard({
  detail,
  icon,
  label,
  value,
}: {
  detail: string
  icon: IconName
  label: string
  value: number | string
}) {
  return (
    <article className="stat-card">
      <span className="stat-card__icon">
        <Icon name={icon} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </article>
  )
}

export function MetaStrip({
  items,
  stacked = false,
}: {
  items: Array<[string, string]>
  stacked?: boolean
}) {
  return (
    <dl className={stacked ? 'meta-strip meta-strip--stacked' : 'meta-strip'}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function EmptyState({
  icon,
  message,
  title,
}: {
  icon: IconName
  message: string
  title: string
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__visual" aria-hidden="true">
        <span className="empty-state__spark empty-state__spark--one" />
        <span className="empty-state__spark empty-state__spark--two" />
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  )
}

export function NotFoundState({ message, to }: { message: string; to: string }) {
  return (
    <div className="empty-state empty-state--large">
      <span className="empty-state__visual" aria-hidden="true">
        <span className="empty-state__spark empty-state__spark--one" />
        <span className="empty-state__spark empty-state__spark--two" />
        <Icon name="warning" />
      </span>
      <strong>Nothing to show here</strong>
      <p>{message}</p>
      <Link className="button button--secondary" to={to}>
        <Icon name="book" />
        <span>Go back</span>
      </Link>
    </div>
  )
}

export function StatusBanner({
  message,
  title,
  tone,
}: {
  message: string
  title: string
  tone: 'success' | 'warning'
}) {
  return (
    <div className={`status-banner status-banner--${tone}`}>
      <Icon name={tone === 'success' ? 'check' : 'warning'} />
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <span />
      <strong />
      <p />
      <p />
    </div>
  )
}

export function SkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <div>
            <strong />
            <p />
          </div>
        </div>
      ))}
    </>
  )
}
