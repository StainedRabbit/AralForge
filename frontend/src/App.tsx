import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { activateSession, ApiError, invalidateActiveSession, logoutSession, refreshToken, subscribeToSignOut } from './api'
import type { Session } from './api'
import { Page, SkeletonList, StatusBanner } from './components/ui'
import { EssentialStorageNotice } from './legal/EssentialStorageNotice'
import { clearSession, loadSession, saveSession } from './services/session'
import './App.css'

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp').then(module => ({ default: module.AuthenticatedApp })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))

function App() {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionRestoreError, setSessionRestoreError] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [logoutError, setLogoutError] = useState(false)
  const operationVersion = useRef(0)

  const restoreSession = useCallback(() => {
    const version = ++operationVersion.current
    setRestoring(true)
    setLogoutError(false)
    refreshToken()
      .then(nextSession => {
        if (version === operationVersion.current) {
          saveSession(nextSession)
          setSession(nextSession)
          setSessionRestoreError(false)
        }
      })
      .catch(error => {
        if (version !== operationVersion.current) return
        if (error instanceof ApiError && error.status === 401) {
          setSession(null)
          setSessionRestoreError(false)
          return
        }
        setSessionRestoreError(true)
        console.warn('Session restore failed.', error)
      })
      .finally(() => {
        if (version === operationVersion.current) {
          setSessionReady(true)
          setRestoring(false)
        }
      })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { restoreSession() }, 0)
    return () => {
      window.clearTimeout(timer)
      operationVersion.current += 1
    }
  }, [restoreSession])

  const handleLogin = useCallback((nextSession: Session) => {
    operationVersion.current += 1
    activateSession(nextSession)
    queryClient.clear()
    setSessionRestoreError(false)
    setLogoutError(false)
    setRestoring(false)
    setSessionReady(true)
    saveSession(nextSession)
    setSession(nextSession)
  }, [queryClient])

  const handleSessionExpired = useCallback(() => {
    operationVersion.current += 1
    invalidateActiveSession()
    clearSession()
    queryClient.clear()
    setSessionRestoreError(false)
    setLogoutError(false)
    setRestoring(false)
    setSessionReady(true)
    setSession(null)
  }, [queryClient])

  useEffect(() => subscribeToSignOut(handleSessionExpired), [handleSessionExpired])

  const handleLogout = useCallback(() => {
    handleSessionExpired()
    const version = operationVersion.current
    setRestoring(true)
    void logoutSession()
      .catch(error => {
        if (version === operationVersion.current) setLogoutError(true)
        console.warn('Sign out could not be completed.', error)
      })
      .finally(() => { if (version === operationVersion.current) setRestoring(false) })
  }, [handleSessionExpired])

  return (
    <BrowserRouter>
      <EssentialStorageNotice />
      <Suspense fallback={<main className="app-main"><Page><SkeletonList count={4} /></Page></main>}>
        <Routes>
          <Route
            path="*"
            element={!sessionReady ? <main className="app-main"><Page><SkeletonList count={4} /></Page></main> : session ? (
              <AuthenticatedApp
                session={session}
                setSession={setSession}
                onLogout={handleLogout}
                onSessionExpired={handleSessionExpired}
              />
            ) : sessionRestoreError || logoutError ? (
              <SessionRestoreStatus busy={restoring} logoutError={logoutError} onRetry={logoutError ? handleLogout : restoreSession} onSignIn={handleSessionExpired} />
            ) : <LoginPage onLogin={handleLogin} />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function SessionRestoreStatus({ busy, logoutError, onRetry, onSignIn }: {
  busy: boolean; logoutError: boolean; onRetry: () => void; onSignIn: () => void
}) {
  return (
    <main className="app-main">
      <Page>
        <section className="form-stack" aria-live="polite">
          <StatusBanner tone="warning" title={logoutError ? 'Unable to complete sign out' : 'Unable to restore your session'} message={logoutError ? 'The connection failed before your session could be revoked. Retry sign out to finish.' : 'The connection could not be renewed. Retry or go to sign in to continue.'} />
          <div>
            <button className="button button--secondary" disabled={busy} onClick={onRetry} type="button">{busy ? 'Retrying...' : logoutError ? 'Retry sign out' : 'Retry'}</button>
            <button className="button button--secondary" onClick={onSignIn} type="button">Go to sign in</button>
          </div>
        </section>
      </Page>
    </main>
  )
}

export default App
