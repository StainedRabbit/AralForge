import type { Session } from '../api'
import { migrateAralForgeStorage, migrateStorageValue } from '../utils/storageMigration'

export const SESSION_KEY = 'aralforge.session'
export const LEGACY_SESSION_KEY = 'ezoryx.session'

export function loadSession() {
  migrateAralForgeStorage()
  const raw = migrateStorageValue(SESSION_KEY, LEGACY_SESSION_KEY, isStoredSession)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as Session
  } catch {
    clearSession()
    return null
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(LEGACY_SESSION_KEY)
}

function isStoredSession(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Session> | null
    return Boolean(
      parsed
      && typeof parsed === 'object'
      && typeof parsed.access === 'string'
      && typeof parsed.refresh === 'string',
    )
  } catch {
    return false
  }
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
