import type { Session } from '../api'

const SESSION_KEY = 'ezoryx.session'

export function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY)

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
