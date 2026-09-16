import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, logoutSession, refreshToken } from './api'
import type { Session } from './api'
import { Icon } from './components/Icon'
import { Page, PageHeader, SkeletonList } from './components/ui'
import { EssentialStorageNotice } from './legal/EssentialStorageNotice'
import { clearSession, loadSession, saveSession } from './services/session'
import './App.css'

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp').then(module => ({ default: module.AuthenticatedApp })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))
let initialSessionPromise: Promise<Session> | null = null

function App() {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionRestoreError, setSessionRestoreError] = useState(false)

  const restoreSession = useCallback(() => {
    let active = true
    setSessionReady(false)
    setSessionRestoreError(false)
    initialSessionPromise ??= refreshToken()
    initialSessionPromise
      .then(nextSession => {
        if (active) {
          saveSession(nextSession)
          setSession(nextSession)
        }
      })
      .catch(error => {
        if (error instanceof ApiError && error.status === 401) {
          return
        }
        initialSessionPromise = null
        if (active) {
          setSessionRestoreError(true)
        }
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.warn('Session restore failed.', error)
        }
      })
      .finally(() => { if (active) setSessionReady(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    const timer = window.setTimeout(() => { cleanup = restoreSession() }, 0)
    return () => {
      window.clearTimeout(timer)
      cleanup?.()
    }
  }, [restoreSession])

  const handleLogin = useCallback((nextSession: Session) => {
    setSessionRestoreError(false)
    saveSession(nextSession)
    setSession(nextSession)
  }, [])

  const handleLogout = useCallback(() => {
    void logoutSession().catch(() => undefined)
    clearSession()
    queryClient.clear()
    setSession(null)
  }, [queryClient])

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
              />
            ) : sessionRestoreError ? (
              <SessionReconnect onRetry={restoreSession} onSignIn={() => setSessionRestoreError(false)} />
            ) : <LoginPage onLogin={handleLogin} />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function SessionReconnect({ onRetry, onSignIn }: { onRetry: () => void; onSignIn: () => void }) {
  return (
    <main className="app-main">
      <Page>
        <section className="empty-state empty-state--large" aria-live="polite">
          <span className="empty-state__visual" aria-hidden="true"><Icon name="warning" /></span>
          <PageHeader
            description="Your sign-in could not be renewed because the browser security check failed. Your account has not been signed out."
            eyebrow="Connection interrupted"
            title="Reconnect your session"
          />
          <div className="button-row">
            <button className="button button--primary" onClick={onRetry} type="button"><Icon name="spark" /><span>Retry</span></button>
            <button className="button button--secondary" onClick={onSignIn} type="button"><span>Sign in instead</span></button>
          </div>
        </section>
      </Page>
    </main>
  )
}

export default App
