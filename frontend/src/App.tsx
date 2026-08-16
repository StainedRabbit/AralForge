import { lazy, Suspense, useCallback, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from './api'
import { Page, SkeletonList } from './components/ui'
import { clearSession, loadSession, saveSession } from './services/session'
import './App.css'

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp').then(module => ({ default: module.AuthenticatedApp })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))

function App() {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(() => loadSession())

  const handleLogin = useCallback((nextSession: Session) => {
    saveSession(nextSession)
    setSession(nextSession)
  }, [])

  const handleLogout = useCallback(() => {
    clearSession()
    queryClient.clear()
    setSession(null)
  }, [queryClient])

  return (
    <BrowserRouter>
      <Suspense fallback={<main className="app-main"><Page><SkeletonList count={4} /></Page></main>}>
        {session ? (
          <AuthenticatedApp
            session={session}
            setSession={setSession}
            onLogout={handleLogout}
          />
        ) : (
          <Routes>
            <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
          </Routes>
        )}
      </Suspense>
    </BrowserRouter>
  )
}

export default App
