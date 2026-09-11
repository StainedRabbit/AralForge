import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, logoutSession, refreshToken } from './api'
import type { Session } from './api'
import { Page, SkeletonList } from './components/ui'
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

  useEffect(() => {
    let active = true
    initialSessionPromise ??= refreshToken()
    initialSessionPromise
      .then(nextSession => {
        if (active) {
          saveSession(nextSession)
          setSession(nextSession)
        }
      })
      .catch(error => {
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.warn('Session restore failed.', error)
        }
      })
      .finally(() => { if (active) setSessionReady(true) })
    return () => { active = false }
  }, [])

  const handleLogin = useCallback((nextSession: Session) => {
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
            ) : <LoginPage onLogin={handleLogin} />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
