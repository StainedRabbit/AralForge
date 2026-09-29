import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, RouteData } from '../app/types'
import { Icon } from '../components/Icon'
import { PasswordInput } from '../components/PasswordInput'
import { EmptyState, MetaStrip, Page, PageHeader, SectionHeading } from '../components/ui'
import { formatDateTime, toErrorMessage } from '../utils/format'
import { fullName } from '../utils/student'
import { studentQrImage, studentQrPayload } from '../utils/studentQr'

export function ProfilePage({ api, data }: { api: AuthedRequest; data: RouteData }) {
  const user = data.currentUser
  const profile = data.profile
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [attendanceQr, setAttendanceQr] = useState('')
  const [attendanceQrError, setAttendanceQrError] = useState(false)
  const studentNumber = profile?.student_number?.trim() ?? ''
  const studentName = fullName(user)

  useEffect(() => {
    let cancelled = false
    if (!studentNumber) return
    void studentQrImage(studentQrPayload(studentNumber))
      .then((image) => {
        if (!cancelled) {
          setAttendanceQr(image)
          setAttendanceQrError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setAttendanceQrError(true)
      })
    return () => { cancelled = true }
  }, [studentNumber])

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword !== confirmPassword) {
      setPasswordError('Your new passwords do not match.')
      return
    }

    setSavingPassword(true)
    try {
      await api<{ detail: string }>('/accounts/users/change-password/', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess('Your password has been changed successfully.')
    } catch (caughtError) {
      setPasswordError(readPasswordError(caughtError))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Review your student details and manage your account security."
      />

      <section className="content-grid">
        <div className="profile-panel">
          <div>
            <h2>{fullName(user)}</h2>
            <p className="muted">@{user?.username ?? 'user'}</p>
          </div>
        </div>

        <div className="section-block">
          <SectionHeading subtitle="Student profile details." title="Enrollment" />
          {profile ? (
            <>
              <MetaStrip
                stacked
                items={[
                  ['Student number', profile.student_number],
                  ['Joined', formatDateTime(profile.joined_at)],
                ]}
              />
              {studentNumber ? (
                <div className="profile-attendance-qr">
                  <div>
                    <h3>Attendance QR code</h3>
                    <p>Show this code to your teacher during attendance.</p>
                  </div>
                  <div className="profile-attendance-qr__image">
                    {attendanceQr && !attendanceQrError
                      ? <img alt={`Attendance QR code for ${studentName}`} src={attendanceQr} />
                      : <span role={attendanceQrError ? 'alert' : 'status'}>{attendanceQrError ? 'QR code could not load.' : 'Generating QR code...'}</span>}
                  </div>
                  <strong>{studentNumber}</strong>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon="profile"
              title="No student profile"
              message="Admin and teacher accounts may not have a student profile."
            />
          )}
        </div>

        <div className="section-block profile-password-panel">
          <SectionHeading
            subtitle="Use a strong password that you do not use for another account."
            title="Change password"
          />
          <form className="form-stack profile-password-form" onSubmit={changePassword}>
            <PasswordInput
              autoComplete="current-password"
              label="Current password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              value={currentPassword}
            />
            <PasswordInput
              autoComplete="new-password"
              label="New password"
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              value={newPassword}
              visibilityLabel="new password"
            />
            <PasswordInput
              autoComplete="new-password"
              label="Confirm new password"
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              value={confirmPassword}
              visibilityLabel="password confirmation"
            />

            {passwordError ? (
              <div className="inline-alert" role="alert">
                <Icon name="warning" />
                <span>{passwordError}</span>
              </div>
            ) : null}
            {passwordSuccess ? (
              <div className="inline-alert inline-alert--success" role="status">
                <Icon name="check" />
                <span>{passwordSuccess}</span>
              </div>
            ) : null}

            <button className="button button--primary" disabled={savingPassword} type="submit">
              <Icon name="shield" />
              <span>{savingPassword ? 'Changing password...' : 'Change password'}</span>
            </button>
          </form>
        </div>

      </section>
    </Page>
  )
}

function readPasswordError(error: unknown) {
  const message = toErrorMessage(error)

  try {
    const payload = JSON.parse(message) as Record<string, string | string[]>
    const firstError = Object.values(payload)[0]
    if (Array.isArray(firstError)) return firstError[0] ?? message
    if (typeof firstError === 'string') return firstError
  } catch {
    // The API already returned a plain-language error.
  }

  return message
}
