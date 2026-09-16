import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, logoutSession, refreshToken } from './api'
import type { Session } from './api'
import { Page, SkeletonList, StatusBanner } from './components/ui'
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
              <SessionRestoreStatus onRetry={restoreSession} />
            ) : <LoginPage onLogin={handleLogin} />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function SessionRestoreStatus({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="app-main">
      <Page>
        <section className="form-stack" aria-live="polite">
          <StatusBanner tone="warning" title="Unable to restore your session" message="The connection could not be renewed. Retry to continue." />
          <div><button className="button button--secondary" onClick={onRetry} type="button">Retry</button></div>
        </section>
      </Page>
    </main>
  )
}

export default App
