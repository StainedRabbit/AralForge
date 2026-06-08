import { useCallback } from 'react'
import { ApiError, refreshToken, requestWithToken } from '../api'
import type { RequestOptions, Session } from '../api'
import type { AuthedRequest } from '../app/types'
import { saveSession } from '../services/session'

export function useAuthenticatedRequest(
  session: Session,
  setSession: (session: Session) => void,
  onLogout: () => void,
) {
  return useCallback<AuthedRequest>(
    async <T,>(path: string, options: RequestOptions = {}) => {
      try {
        return await requestWithToken<T>(path, session.access, options)
      } catch (caughtError) {
        if (!(caughtError instanceof ApiError) || caughtError.status !== 401) {
          throw caughtError
        }

        try {
          const refreshed = await refreshToken(session.refresh)
          const nextSession = { ...session, access: refreshed.access }
          saveSession(nextSession)
          setSession(nextSession)
          return await requestWithToken<T>(path, nextSession.access, options)
        } catch (refreshError) {
          onLogout()
          throw refreshError
        }
      }
    },
    [onLogout, session, setSession],
  )
}
