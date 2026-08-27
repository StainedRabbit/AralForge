import { Link, NavLink } from 'react-router-dom'
import type { User } from '../types'
import { fullName, initials } from '../utils/student'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type NavItem = {
  to: string
  label: string
  icon: IconName
}

const studentNavItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/classes', label: 'Classes', icon: 'users' },
  { to: '/modules', label: 'Modules', icon: 'module' },
  { to: '/attendance', label: 'Attendance', icon: 'check' },
  { to: '/grades', label: 'Grades', icon: 'grade' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
]

const mobileNavItems: NavItem[] = [
  { to: '/', label: 'Home', icon: 'dashboard' },
  { to: '/modules', label: 'Modules', icon: 'module' },
  { to: '/classes', label: 'Classes', icon: 'users' },
  { to: '/grades', label: 'Grades', icon: 'grade' },
]

export function Sidebar({
  currentUser,
  items = studentNavItems,
  badgePath = '/modules',
  pendingCount,
  onLogout,
  workspaceLabel,
}: {
  currentUser: User | null
  items?: NavItem[]
  badgePath?: string
  pendingCount: number
  onLogout: () => void
  workspaceLabel?: string
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <BrandMark inverted sidebar />
        <nav className="nav-list" aria-label="Primary">
          {items.map((item) => (
            <NavEntry
              badgePath={badgePath}
              item={item}
              key={item.to}
              pendingCount={pendingCount}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar__bottom">
        <div className="user-chip">
          <div className="avatar">{initials(currentUser)}</div>
          <div>
            <strong>{fullName(currentUser)}</strong>
            <span>
              {workspaceLabel ||
                currentUser?.role?.toLowerCase() ||
                'Account'}
            </span>
          </div>
        </div>
        <button
          className="icon-button icon-button--wide"
          onClick={onLogout}
          title="Sign out"
          type="button"
        >
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}

export function MobileHeader({
  currentUser,
  pendingCount,
  onLogout,
}: {
  currentUser: User | null
  pendingCount: number
  onLogout: () => void
}) {
  return (
    <header className="mobile-header">
      <BrandMark iconOnly />
      <div className="mobile-header__actions">
        {pendingCount ? <span className="notification-dot">{pendingCount}</span> : null}
        <div className="avatar">{initials(currentUser)}</div>
        <button
          className="icon-button"
          onClick={onLogout}
          title="Sign out"
          type="button"
        >
          <Icon name="logout" />
        </button>
      </div>
    </header>
  )
}

export function MobileTabbar({
  badgePath = '/modules',
  items = mobileNavItems,
  pendingCount,
}: {
  badgePath?: string
  items?: NavItem[]
  pendingCount: number
}) {
  return (
    <nav className="mobile-tabbar" aria-label="Primary mobile">
      {items.map((item) => (
        <NavLink
          className={({ isActive }) => (isActive ? 'active' : '')}
          end={isExactNavItem(item.to)}
          key={item.to}
          to={item.to}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.to === badgePath && pendingCount ? (
            <small>{pendingCount}</small>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}

function NavEntry({
  badgePath,
  item,
  pendingCount,
}: {
  badgePath: string
  item: NavItem
  pendingCount: number
}) {
  return (
    <NavLink
      className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      end={isExactNavItem(item.to)}
      to={item.to}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {item.to === badgePath && pendingCount ? (
        <small>{pendingCount}</small>
      ) : null}
    </NavLink>
  )
}

function isExactNavItem(path: string) {
  return path === '/' || path === '/admin'
}

export function BrandMark({
  compact = false,
  iconOnly = false,
  inverted = false,
  sidebar = false,
}: {
  compact?: boolean
  iconOnly?: boolean
  inverted?: boolean
  sidebar?: boolean
}) {
  const className = [
    'brand',
    compact ? 'brand--compact' : '',
    iconOnly ? 'brand--icon' : '',
    inverted ? 'brand--inverted' : '',
    sidebar ? 'brand--sidebar' : '',
  ].filter(Boolean).join(' ')

  return (
    <Link aria-label="AralForge home" className={className} to="/">
      {sidebar ? (
        <>
          <img
            alt="AralForge"
            className="brand__icon"
            height="512"
            src="/brand/aralforge-icon-dark.png"
            width="512"
          />
          <span aria-hidden="true" className="brand__wordmark">
            <strong>Aral<span>Forge</span></strong>
            <small>Forge Knowledge, Build Future.</small>
          </span>
        </>
      ) : (
        <>
          <img
            alt="AralForge"
            className={iconOnly ? 'brand__icon' : 'brand__logo'}
            height={iconOnly ? '512' : '274'}
            src={iconOnly
              ? (inverted ? '/brand/aralforge-icon-dark.png' : '/brand/aralforge-icon.png')
              : (inverted ? '/brand/aralforge-logo-horizontal-dark.png' : '/brand/aralforge-logo-horizontal.png')}
            width={iconOnly ? '512' : '1184'}
          />
          {!compact && !iconOnly ? <small>Forge Knowledge, Build Future.</small> : null}
        </>
      )}
    </Link>
  )
}
