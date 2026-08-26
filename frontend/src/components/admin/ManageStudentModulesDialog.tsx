import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { Module, ModuleAccess } from '../../types'
import { formatDateTime, toErrorMessage } from '../../utils/format'
import { moduleSubjectLabel } from '../../utils/student'
import { Icon } from '../Icon'

export function ManageStudentModulesDialog({
  api,
  data,
  defaultSubjectId,
  onClose,
  refresh,
  studentId,
  studentName,
}: {
  api: AuthedRequest
  data: RouteData
  defaultSubjectId?: number
  onClose: () => void
  refresh: () => Promise<void>
  studentId: number
  studentName: string
}) {
  const enrolledSubjectIds = useMemo(
    () => {
      const activeScheduleIds = new Set(
        data.schedules
          .filter((schedule) => schedule.is_active)
          .map((schedule) => schedule.id),
      )
      return new Set(
        data.enrollments
          .filter(
            (enrollment) =>
              enrollment.student === studentId &&
              enrollment.is_active &&
              activeScheduleIds.has(enrollment.schedule),
          )
          .map((enrollment) => enrollment.subject),
      )
    },
    [data.enrollments, data.schedules, studentId],
  )
  const defaultModule = data.modules.find(
    (module) =>
      module.is_published &&
      defaultSubjectId &&
      moduleSubjectIds(module).includes(defaultSubjectId),
  )
  const [moduleId, setModuleId] = useState(
    defaultModule ? String(defaultModule.id) : '',
  )
  const [expiresAt, setExpiresAt] = useState(defaultExpiryValue())
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [savingId, setSavingId] = useState<number | 'new' | null>(null)
  const [grantUpdates, setGrantUpdates] = useState<ModuleAccess[]>([])
  const grants = useMemo(
    () => studentModuleGrants(
      [
        ...data.moduleAccess.filter(
          (grant) => !grantUpdates.some((saved) => saved.id === grant.id),
        ),
        ...grantUpdates,
      ],
      studentId,
    ),
    [data.moduleAccess, grantUpdates, studentId],
  )
  const enrolledModules = data.modules.filter(
    (module) =>
      module.is_published &&
      moduleSubjectIds(module).some((subjectId) =>
        enrolledSubjectIds.has(subjectId),
      ),
  )
  const modules = data.modules.filter((module) => module.is_published)

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const module = data.modules.find(
      (candidate) => candidate.id === Number(moduleId),
    )
    if (!module) return

    const accessType = moduleSubjectIds(module).some((subjectId) =>
      enrolledSubjectIds.has(subjectId),
    )
      ? 'ENROLLED'
      : 'ADVANCE_STUDY'
    const moduleGrants = grants.filter((grant) => grant.module === module.id)
    const existing = moduleGrants.find(
      (grant) =>
        grant.access_type === accessType,
    ) ?? (moduleGrants.length === 1 ? moduleGrants[0] : undefined)
    setSavingId(existing?.id ?? 'new')
    setMessage('')

    try {
      const saved = await api<ModuleAccess>(
        existing ? `/modules/access/${existing.id}/` : '/modules/access/',
        {
          body: JSON.stringify({
            access_type: accessType,
            expires_at: expiresAt
              ? new Date(expiresAt).toISOString()
              : null,
            is_active: true,
            module: module.id,
            notes,
            student: studentId,
          }),
          method: existing ? 'PATCH' : 'POST',
        },
      )
      setGrantUpdates((current) => upsertGrant(current, saved))
      setMessage('Module access activated.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingId(null)
    }
  }

  async function revoke(grant: ModuleAccess) {
    setSavingId(grant.id)
    setMessage('')
    try {
      const saved = await api<ModuleAccess>(`/modules/access/${grant.id}/`, {
        body: JSON.stringify({ is_active: false }),
        method: 'PATCH',
      })
      setGrantUpdates((current) => upsertGrant(current, saved))
      setMessage('Module access revoked.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSavingId(null)
    }
  }

  function prepareRenewal(grant: ModuleAccess) {
    setModuleId(String(grant.module))
    setExpiresAt(defaultExpiryValue())
    setNotes(grant.notes)
    setMessage('Review the access details and renew the activation.')
  }

  return (
    <div
      aria-labelledby="manage-student-modules-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <button
        aria-label="Close module access"
        className="attendance-modal__backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="attendance-modal__panel attendance-modal__panel--wide student-module-access-dialog">
        <div className="attendance-modal__header">
          <div>
            <strong id="manage-student-modules-title">Module Access</strong>
            <span>{studentName}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <Icon name="close" />
          </button>
        </div>

        <section className="student-module-access-section">
          <div>
            <p className="eyebrow">Class enrollment</p>
            <h3>Enrolled Modules</h3>
            <p>Enrolled modules remain locked until a teacher activates access.</p>
          </div>
          <div className="student-module-access-list">
            {enrolledModules.map((module) => {
              const grant = grants.find(
                (candidate) =>
                  candidate.module === module.id &&
                  candidate.access_type === 'ENROLLED',
              )
              return (
                <article key={module.id}>
                  <span className="student-module-access-list__icon">
                    <Icon name="module" />
                  </span>
                  <div>
                    <strong>{module.title}</strong>
                    <span>{moduleSubjectLabel(data, module)}</span>
                  </div>
                  <small>
                    {grant?.is_available
                      ? 'Active'
                      : grant?.is_active
                        ? 'Expired'
                        : 'Locked'}
                  </small>
                </article>
              )
            })}
            {!enrolledModules.length ? (
              <p className="admin-empty-line">No enrolled modules.</p>
            ) : null}
          </div>
        </section>

        <section className="student-module-access-section">
          <div>
            <p className="eyebrow">Teacher activation</p>
            <h3>Activate Module Access</h3>
            <p>Selecting a non-enrolled module grants advance-study access.</p>
          </div>
          <form className="student-module-grant-form" onSubmit={activate}>
            <label className="admin-field">
              <span>Module</span>
              <select
                onChange={(event) => setModuleId(event.target.value)}
                required
                value={moduleId}
              >
                <option value="">Select a module</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {moduleSubjectLabel(data, module)} - {module.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Access expires</span>
              <input
                onChange={(event) => setExpiresAt(event.target.value)}
                required
                type="datetime-local"
                value={expiresAt}
              />
            </label>
            <label className="admin-field admin-field--wide">
              <span>Note</span>
              <input
                onChange={(event) => setNotes(event.target.value)}
                type="text"
                value={notes}
              />
            </label>
            <button className="button button--primary" disabled={savingId !== null} type="submit">
              <Icon name="shield" />
              <span>{savingId ? 'Saving...' : 'Activate Access'}</span>
            </button>
          </form>

          {message ? <p className="admin-message">{message}</p> : null}

          <div className="student-module-access-list">
            {grants.map((grant) => {
              const module = data.modules.find(
                (candidate) => candidate.id === grant.module,
              )
              return (
                <article key={grant.id}>
                  <span className="student-module-access-list__icon student-module-access-list__icon--advance">
                    <Icon name="shield" />
                  </span>
                  <div>
                    <strong>{grant.module_title}</strong>
                    <span>
                      {module ? moduleSubjectLabel(data, module) : 'Module'}
                      {grant.access_type === 'ADVANCE_STUDY'
                        ? ' · Advance module'
                        : ' · Enrolled module'}
                      {grant.expires_at
                        ? ` · Expires ${formatDateTime(grant.expires_at)}`
                        : ''}
                    </span>
                    <small>{grant.status}</small>
                  </div>
                  <div className="student-module-access-list__actions">
                    <span className={grant.is_available ? 'status-pill status-pill--success' : 'status-pill'}>
                      {grant.status === 'ACTIVE' ? 'Active' : grant.status === 'EXPIRED' ? 'Expired' : 'Revoked'}
                    </span>
                    {grant.is_available ? (
                      <button
                        className="button button--secondary button--compact"
                        disabled={savingId !== null}
                        onClick={() => void revoke(grant)}
                        type="button"
                      >
                        <Icon name="close" />
                        <span>Revoke</span>
                      </button>
                    ) : (
                      <button
                        className="button button--secondary button--compact"
                        disabled={savingId !== null}
                        onClick={() => prepareRenewal(grant)}
                        type="button"
                      >
                        <Icon name="check" />
                        <span>Renew</span>
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
            {!grants.length ? (
              <p className="admin-empty-line">No module access grants recorded.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function moduleSubjectIds(module: Module) {
  return Array.from(
    new Set([
      ...(module.subject ? [module.subject] : []),
      ...module.subjects,
    ]),
  )
}

function studentModuleGrants(grants: ModuleAccess[], studentId: number) {
  return grants
    .filter((grant) => grant.student === studentId)
    .sort((first, second) => first.module_title.localeCompare(second.module_title))
}

function upsertGrant(grants: ModuleAccess[], saved: ModuleAccess) {
  return studentModuleGrants(
    [...grants.filter((grant) => grant.id !== saved.id), saved],
    saved.student,
  )
}

function defaultExpiryValue() {
  const now = new Date()
  const targetMonth = now.getMonth() + 5
  const target = new Date(
    now.getFullYear(),
    targetMonth,
    Math.min(
      now.getDate(),
      new Date(now.getFullYear(), targetMonth + 1, 0).getDate(),
    ),
    now.getHours(),
    now.getMinutes(),
  )
  const local = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}
