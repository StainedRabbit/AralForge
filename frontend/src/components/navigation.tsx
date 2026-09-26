import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { ThemePreference, User } from '../types'
import { fullName, initials } from '../utils/student'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type NavItem = {
  to: string
  label: string
  icon: IconName
  matchPrefixes?: string[]
}

export type ThemeControls = {
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  themeSaving: boolean
  themeError: string
}

const themeOptions: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'computer' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

function AppearanceChoices({
  themePreference,
  onThemeChange,
  themeSaving,
  themeError,
  collapsed,
  expanded,
  onToggleCollapsed,
}: ThemeControls & {
  collapsed?: boolean
  expanded?: boolean
  onToggleCollapsed?: () => void
}) {
  return <div className="appearance-control">
    <strong>Appearance</strong>
    <div className="appearance-control__toolbar">
      <div aria-label="Appearance" className="appearance-control__options" role="group">
        {themeOptions.map(({ value, label, icon }) => <button aria-label={label} aria-pressed={themePreference === value} className="appearance-control__option" disabled={themeSaving}
          key={value} onClick={() => onThemeChange(value)} title={label} type="button"><Icon name={icon} /><span>{label}</span></button>)}
      </div>
      {onToggleCollapsed ? <>
        <span aria-hidden="true" className="appearance-control__divider" />
        <button aria-expanded={expanded} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="appearance-control__collapse" onClick={onToggleCollapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'} type="button">
          <Icon name={collapsed ? 'expand' : 'shrink'} />
        </button>
      </> : null}
    </div>
    {themeError ? <small role="alert">{themeError}</small> : null}
  </div>
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
  { to: '/modules', label: 'Modules', icon: 'module', matchPrefixes: ['/modules', '/activities'] },
  { to: '/classes', label: 'Classes', icon: 'users' },
  { to: '/grades', label: 'Grades', icon: 'grade' },
]

const studentMoreItems: NavItem[] = [
  { to: '/attendance', label: 'Attendance', icon: 'check' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
]

const SIDEBAR_COLLAPSED_KEY = 'aralforge.sidebar.collapsed.v1'

function getInitialSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function Sidebar({
  currentUser,
  items = studentNavItems,
  badgePath = '/modules',
  pendingCount,
  onLogout,
  workspaceLabel,
  themePreference,
  onThemeChange,
  themeSaving,
  themeError,
}: {
  currentUser: User | null
  items?: NavItem[]
  badgePath?: string
  pendingCount: number
  onLogout: () => void
  workspaceLabel?: string
} & ThemeControls) {
  const [collapsed, setCollapsed] = useState(getInitialSidebarCollapsed)
  const [previewExpanded, setPreviewExpanded] = useState(false)

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      } catch {
        // Keep the in-memory preference if storage is unavailable.
      }
      return next
    })
  }

  const expanded = !collapsed || previewExpanded
  return (
    <aside
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${previewExpanded && collapsed ? ' sidebar--preview' : ''}`}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewExpanded(false)
      }}
      onFocusCapture={() => setPreviewExpanded(true)}
      onPointerEnter={() => setPreviewExpanded(true)}
      onPointerLeave={() => setPreviewExpanded(false)}
    >
      <div className="sidebar__top">
        <BrandMark homePath={items[0]?.to ?? '/'} inverted sidebar />
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
        <div className="sidebar__appearance"><AppearanceChoices
          themePreference={themePreference}
          onThemeChange={onThemeChange}
          themeSaving={themeSaving}
          themeError={themeError}
          collapsed={collapsed}
          expanded={expanded}
          onToggleCollapsed={toggleCollapsed}
        /></div>
        <div className={`user-chip${currentUser?.role === 'STUDENT' ? ' user-chip--text-only' : ''}`}>
          {currentUser?.role !== 'STUDENT' ? <div className="avatar">{initials(currentUser)}</div> : null}
          <div className="sidebar__user-info">
            <div className="sidebar__user-identity">
              <strong>{fullName(currentUser)}</strong>
              <button aria-label="Sign out" className="user-chip__logout" onClick={onLogout} title="Sign out" type="button">
                <Icon name="logout" />
              </button>
            </div>
            <span>
              {workspaceLabel ||
                currentUser?.role?.toLowerCase() ||
                'Account'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function MobileHeader({
  currentUser,
  badgePath = '/modules',
  homePath = '/',
  pendingCount,
  onOpenMore,
  showAccountAvatar = true,
  sticky = true,
}: {
  currentUser: User | null
  badgePath?: string
  homePath?: string
  pendingCount: number
  onOpenMore: () => void
  showAccountAvatar?: boolean
  sticky?: boolean
}) {
  return (
    <header className={`mobile-header${sticky ? '' : ' mobile-header--scrolling'}`}>
      <BrandMark homePath={homePath} iconOnly />
      <div className="mobile-header__actions">
        {pendingCount ? (
          <Link aria-label={`${pendingCount} pending items`} className="notification-dot" to={badgePath}>
            <span>{pendingCount}</span>
          </Link>
        ) : null}
        <button
          aria-label="Open account and more navigation"
          className="mobile-account-button"
          onClick={onOpenMore}
          type="button"
        >
          {showAccountAvatar ? <span className="avatar">{initials(currentUser)}</span> : null}
          <Icon name="menu" />
        </button>
      </div>
    </header>
  )
}

export function MobileTabbar({
  badgePath = '/modules',
  items = mobileNavItems,
  moreActive = false,
  moreOpen = false,
  onOpenMore,
  pendingCount,
}: {
  badgePath?: string
  items?: NavItem[]
  moreActive?: boolean
  moreOpen?: boolean
  onOpenMore: () => void
  pendingCount: number
}) {
  const location = useLocation()
  return (
    <nav className="mobile-tabbar" aria-label="Primary mobile">
      {items.map((item) => (
        <Link
          aria-current={matchesNavItem(location.pathname, item) ? 'page' : undefined}
          className={matchesNavItem(location.pathname, item) ? 'active' : ''}
          key={item.to}
          to={item.to}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.to === badgePath && pendingCount ? (
            <small>{pendingCount}</small>
          ) : null}
        </Link>
      ))}
      <button
        aria-expanded={moreOpen}
        aria-label="More navigation"
        className={moreActive || moreOpen ? 'active' : ''}
        onClick={onOpenMore}
        type="button"
      >
        <Icon name="more" />
        <span>More</span>
      </button>
    </nav>
  )
}

export function MobileNavigation({
  badgePath = '/modules',
  currentUser,
  items = mobileNavItems,
  moreItems = studentMoreItems,
  onLogout,
  pendingCount,
  stickyHeader = true,
  showAccountAvatar = true,
  workspaceLabel,
  themePreference,
  onThemeChange,
  themeSaving,
  themeError,
}: {
  badgePath?: string
  currentUser: User | null
  items?: NavItem[]
  moreItems?: NavItem[]
  onLogout: () => void
  pendingCount: number
  stickyHeader?: boolean
  showAccountAvatar?: boolean
  workspaceLabel?: string
} & ThemeControls) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const primaryActive = items.some((item) => matchesNavItem(location.pathname, item))
  const moreActive = !primaryActive && moreItems.some((item) => matchesNavItem(location.pathname, item))

  useEffect(() => {
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 })
  }, [location.pathname])

  return (
    <>
      <MobileHeader badgePath={badgePath} currentUser={currentUser} homePath={items[0]?.to ?? '/'} pendingCount={pendingCount} onOpenMore={() => setOpen(true)} showAccountAvatar={showAccountAvatar} sticky={stickyHeader} />
      <MobileTabbar badgePath={badgePath} items={items} moreActive={moreActive} moreOpen={open} onOpenMore={() => setOpen(true)} pendingCount={pendingCount} />
      <MobileMoreSheet currentUser={currentUser} items={moreItems} onClose={() => setOpen(false)} onLogout={onLogout} open={open} workspaceLabel={workspaceLabel} themePreference={themePreference} onThemeChange={onThemeChange} themeSaving={themeSaving} themeError={themeError} />
    </>
  )
}

export function MobileMoreSheet({ currentUser, items, onClose, onLogout, open, workspaceLabel, themePreference, onThemeChange, themeSaving, themeError }: {
  currentUser: User | null
  items: NavItem[]
  onClose: () => void
  onLogout: () => void
  open: boolean
  workspaceLabel?: string
} & ThemeControls) {
  const location = useLocation()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => closeRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
      previous?.focus()
    }
  }, [onClose, open])

  if (!open) return null
  return (
    <div aria-labelledby="mobile-more-title" aria-modal="true" className="mobile-more" role="dialog">
      <button aria-label="Close more navigation" className="mobile-more__backdrop" onClick={onClose} type="button" />
      <div className="mobile-more__panel" ref={panelRef}>
        <div className="mobile-more__handle" />
        <div className="mobile-more__header">
          <div className="user-chip">
            {currentUser?.role !== 'STUDENT' ? <div className="avatar">{initials(currentUser)}</div> : null}
            <div><strong id="mobile-more-title">{fullName(currentUser)}</strong><span>{workspaceLabel || currentUser?.role?.toLowerCase() || 'Account'}</span></div>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </div>
        <nav aria-label="More destinations" className="mobile-more__links">
          {items.map((item) => <Link aria-current={matchesNavItem(location.pathname, item) ? 'page' : undefined} className={matchesNavItem(location.pathname, item) ? 'active' : ''} key={item.to} onClick={onClose} to={item.to}><Icon name={item.icon} /><span><strong>{item.label}</strong><small>Open {item.label.toLowerCase()}</small></span><Icon name="arrow-right" /></Link>)}
        </nav>
        <AppearanceChoices themePreference={themePreference} onThemeChange={onThemeChange} themeSaving={themeSaving} themeError={themeError} />
        <button className="button button--secondary mobile-more__logout" onClick={onLogout} type="button"><Icon name="logout" /><span>Sign out</span></button>
      </div>
    </div>
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
      aria-label={item.label}
      className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
      end={isExactNavItem(item.to)}
      title={item.label}
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

function matchesNavItem(pathname: string, item: NavItem) {
  const candidates = item.matchPrefixes?.length ? item.matchPrefixes : [item.to]
  return candidates.some((candidate) => isExactNavItem(candidate)
    ? pathname === candidate
    : pathname === candidate || pathname.startsWith(`${candidate}/`))
}

export function BrandMark({
  compact = false,
  homePath = '/',
  iconOnly = false,
  inverted = false,
  sidebar = false,
}: {
  compact?: boolean
  homePath?: string
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
    <Link aria-label="AralForge home" className={className} to={homePath}>
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
            className={`${iconOnly ? 'brand__icon' : 'brand__logo'} brand__image--light${inverted ? ' brand__image--inverted' : ''}`}
            height={iconOnly ? '512' : '274'}
            src={iconOnly
              ? (inverted ? '/brand/aralforge-icon-dark.png' : '/brand/aralforge-icon.png')
              : (inverted ? '/brand/aralforge-logo-horizontal-dark.png' : '/brand/aralforge-logo-horizontal.png')}
            width={iconOnly ? '512' : '1184'}
          />
          {!inverted ? <img
            alt=""
            aria-hidden="true"
            className={`${iconOnly ? 'brand__icon' : 'brand__logo'} brand__image--dark`}
            height={iconOnly ? '512' : '274'}
            src={iconOnly ? '/brand/aralforge-icon-dark.png' : '/brand/aralforge-logo-horizontal-dark.png'}
            width={iconOnly ? '512' : '1184'}
          /> : null}
          {!compact && !iconOnly ? <small>Forge Knowledge, Build Future.</small> : null}
        </>
      )}
    </Link>
  )
}
