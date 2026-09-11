import type { Session } from '../api'
import { migrateAralForgeStorage } from '../utils/storageMigration'

export const SESSION_KEY = 'aralforge.session'
export const LEGACY_SESSION_KEY = 'ezoryx.session'

declare global {
  interface Window {
    __ARALFORGE_E2E_ACCESS_TOKEN__?: string
  }
}

export function loadSession() {
  migrateAralForgeStorage()
  // JWTs from older releases are deliberately removed. The current access token
  // lives only in memory; the refresh credential is an HttpOnly cookie.
  clearSession()
  return null
}

export function saveSession(_session: Session) {
  // Intentionally memory-only. App owns the current access token state.
  if (import.meta.env.DEV) window.__ARALFORGE_E2E_ACCESS_TOKEN__ = _session.access
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(LEGACY_SESSION_KEY)
  if (import.meta.env.DEV) delete window.__ARALFORGE_E2E_ACCESS_TOKEN__
}

export function readJwtUserId(token: string) {
  const parts = token.split('.')

  if (parts.length < 2) {
    return null
  }

  try {
    const payload = JSON.parse(atob(parts[1])) as { user_id?: number }
    return payload.user_id ?? null
  } catch {
    return null
  }
}
