import { lazy, Suspense, useCallback, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from './api'
import { Page, SkeletonList } from './components/ui'
import { EssentialStorageNotice } from './legal/EssentialStorageNotice'
import { clearSession, loadSession, saveSession } from './services/session'
import './App.css'

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp').then(module => ({ default: module.AuthenticatedApp })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))
const LegalRoutes = lazy(() => import('./legal/LegalPages').then(module => ({ default: module.LegalRoutes })))

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
      <EssentialStorageNotice />
      <Suspense fallback={<main className="app-main"><Page><SkeletonList count={4} /></Page></main>}>
        <Routes>
          <Route path="/legal/*" element={<LegalRoutes />} />
          <Route
            path="*"
            element={session ? (
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
