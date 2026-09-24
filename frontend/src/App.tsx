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
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const operationVersion = useRef(0)
  const logoutCancelRef = useRef<HTMLButtonElement>(null)
  const logoutTriggerRef = useRef<HTMLElement | null>(null)
  const logoutDialogRef = useRef<HTMLDivElement>(null)

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

  const performLogout = useCallback(() => {
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

  const handleLogout = useCallback(() => {
    logoutTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLogoutConfirmationOpen(true)
  }, [])

  const cancelLogout = useCallback(() => {
    setLogoutConfirmationOpen(false)
    window.requestAnimationFrame(() => logoutTriggerRef.current?.focus())
  }, [])

  const confirmLogout = useCallback(() => {
    setLogoutConfirmationOpen(false)
    performLogout()
  }, [performLogout])

  useEffect(() => {
    if (!logoutConfirmationOpen) return
    const previousOverflow = document.body.style.overflow
    logoutCancelRef.current?.focus()
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelLogout()
        return
      }
      if (event.key !== 'Tab') return
      const controls = logoutDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
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
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleDialogKeyDown)
    }
  }, [cancelLogout, logoutConfirmationOpen])

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
              <SessionRestoreStatus busy={restoring} logoutError={logoutError} onRetry={logoutError ? performLogout : restoreSession} onSignIn={handleSessionExpired} />
            ) : <LoginPage onLogin={handleLogin} />}
          />
        </Routes>
      </Suspense>
      {logoutConfirmationOpen ? <div aria-labelledby="logout-confirmation-title" aria-modal="true" className="logout-confirmation" role="dialog">
        <button aria-label="Cancel sign out" className="logout-confirmation__backdrop" onClick={cancelLogout} type="button" />
        <div className="logout-confirmation__panel" ref={logoutDialogRef}>
          <div>
            <p className="eyebrow">Sign out</p>
            <h2 id="logout-confirmation-title">Are you sure you want to sign out?</h2>
          </div>
          <div className="logout-confirmation__actions">
            <button className="button button--secondary" onClick={cancelLogout} ref={logoutCancelRef} type="button">Cancel</button>
            <button className="button button--primary" onClick={confirmLogout} type="button">Sign out</button>
          </div>
        </div>
      </div> : null}
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
