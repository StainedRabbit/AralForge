import { useCallback } from 'react'
import { ApiError, getActiveAccessToken, getActiveSessionVersion, refreshToken, requestWithToken } from '../api'
import type { RequestOptions, Session } from '../api'
import type { AuthedRequest } from '../app/types'
import { saveSession } from '../services/session'

export function useAuthenticatedRequest(
  session: Session,
  setSession: (session: Session) => void,
  onSessionExpired: () => void,
) {
  return useCallback<AuthedRequest>(
    async <T,>(path: string, options: RequestOptions = {}) => {
      const version = getActiveSessionVersion()
      const access = getActiveAccessToken()
      if (!access) throw new DOMException('The session is no longer active.', 'AbortError')
      try {
        const result = await requestWithToken<T>(path, access, options)
        if (version !== getActiveSessionVersion()) {
          throw new DOMException('The session changed during this request.', 'AbortError')
        }
        return result
      } catch (caughtError) {
        if (!(caughtError instanceof ApiError) || caughtError.status !== 401) {
          throw caughtError
        }
        if (version !== getActiveSessionVersion()) throw caughtError

        let refreshed: { access: string }
        try {
          refreshed = await refreshToken(access)
        } catch (refreshError) {
          if (version === getActiveSessionVersion() && refreshError instanceof ApiError && refreshError.status === 401) {
            onSessionExpired()
          }
          throw refreshError
        }
        if (version !== getActiveSessionVersion() || getActiveAccessToken() !== refreshed.access) {
          throw new DOMException('The session changed while reconnecting.', 'AbortError')
        }

        const nextSession = { ...session, access: refreshed.access }
        saveSession(nextSession)
        setSession(nextSession)
        const result = await requestWithToken<T>(path, nextSession.access, options)
        if (version !== getActiveSessionVersion()) {
          throw new DOMException('The session changed during this request.', 'AbortError')
        }
        return result
      }
    },
    [onSessionExpired, session, setSession],
  )
}
