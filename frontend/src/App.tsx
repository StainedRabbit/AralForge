import { useCallback, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import type { Session } from './api'
import { AuthenticatedApp } from './app/AuthenticatedApp'
import { LoginPage } from './pages/LoginPage'
import { clearSession, loadSession, saveSession } from './services/session'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())

  const handleLogin = useCallback((nextSession: Session) => {
    saveSession(nextSession)
    setSession(nextSession)
  }, [])

  const handleLogout = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  return (
    <BrowserRouter>
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
    </BrowserRouter>
  )
}

export default App
