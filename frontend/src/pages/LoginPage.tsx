import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { completePasswordSetup, getApiBaseUrl, login as loginRequest } from '../api'
import type { Session } from '../api'
import heroImage from '../assets/academic-dashboard.webp'
import { BrandMark } from '../components/navigation'
import { Icon } from '../components/Icon'
import { toErrorMessage } from '../utils/format'

export function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordSetupToken, setPasswordSetupToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const nextSession = await loginRequest(username.trim(), password)
      if ('must_change_password' in nextSession) {
        setPasswordSetupToken(nextSession.password_setup_token)
        setPassword('')
        return
      }
      onLogin(nextSession)
      navigate('/', { replace: true })
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const nextSession = await completePasswordSetup(passwordSetupToken, newPassword, confirmPassword)
      onLogin(nextSession)
      navigate('/', { replace: true })
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Ezoryx preview">
        <img src={heroImage} alt="" decoding="async" fetchPriority="high" height="640" width="1280" />
        <div className="login-visual__content">
          <BrandMark />
          <div>
            <p className="eyebrow">Academic coding platform</p>
            <h1>Learn, build, submit, and track progress in one place.</h1>
          </div>
          <div className="login-proof-grid" aria-label="Platform highlights">
            <div>
              <strong>Modules</strong>
              <span>Lessons and activities</span>
            </div>
            <div>
              <strong>Coding</strong>
              <span>Blank-based practice</span>
            </div>
            <div>
              <strong>Grades</strong>
              <span>Progress visibility</span>
            </div>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="Sign in">
        <div className="login-card">
          <BrandMark compact />
          <div>
            <p className="eyebrow">Welcome back</p>
            <h2>{passwordSetupToken ? 'Create your password' : 'Sign in to Ezoryx'}</h2>
            <p className="muted">
              {passwordSetupToken
                ? 'Replace your temporary password before continuing to Ezoryx.'
                : 'Use your username or student number.'}
            </p>
          </div>

          <form className="form-stack" onSubmit={passwordSetupToken ? handlePasswordSetup : handleSubmit}>
            {!passwordSetupToken ? (
              <>
            <label>
              <span>Username or student number</span>
              <input
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="student01"
                required
                type="text"
                value={username}
              />
            </label>

            <label>
              <span>Password</span>
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
                type="password"
                value={password}
              />
            </label>
              </>
            ) : (
              <>
                <label>
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                    type="password"
                    value={newPassword}
                  />
                </label>
                <label>
                  <span>Confirm new password</span>
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    type="password"
                    value={confirmPassword}
                  />
                </label>
              </>
            )}

            {error ? (
              <div className="inline-alert" role="alert">
                <Icon name="warning" />
                <span>{error}</span>
              </div>
            ) : null}

            <button className="button button--primary" disabled={loading} type="submit">
              <Icon name="shield" />
              <span>{loading ? 'Please wait...' : passwordSetupToken ? 'Set password and continue' : 'Sign in'}</span>
            </button>
          </form>

          <p className="login-meta">
            API endpoint: <code>{getApiBaseUrl()}</code>
          </p>
        </div>
      </section>
    </main>
  )
}
