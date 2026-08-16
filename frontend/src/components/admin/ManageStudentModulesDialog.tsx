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
    () =>
      new Set(
        data.enrollments
          .filter(
            (enrollment) =>
              enrollment.student === studentId && enrollment.is_active,
          )
          .map((enrollment) => enrollment.subject),
      ),
    [data.enrollments, studentId],
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
  const [amountPaid, setAmountPaid] = useState(defaultModule?.price ?? '0.00')
  const [expiresAt, setExpiresAt] = useState(defaultExpiryValue())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [savingId, setSavingId] = useState<number | 'new' | null>(null)
  const grants = data.moduleAccess
    .filter((grant) => grant.student === studentId)
    .sort((first, second) => first.module_title.localeCompare(second.module_title))
  const enrolledModules = data.modules.filter(
    (module) =>
      module.is_published &&
      moduleSubjectIds(module).some((subjectId) =>
        enrolledSubjectIds.has(subjectId),
      ),
  )
  const modules = data.modules.filter((module) => module.is_published)

  function selectModule(nextModuleId: string) {
    const module = data.modules.find(
      (candidate) => candidate.id === Number(nextModuleId),
    )
    setModuleId(nextModuleId)
    setAmountPaid(module?.price ?? '0.00')
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const module = data.modules.find(
      (candidate) => candidate.id === Number(moduleId),
    )
    if (!module) return

    const accessType = moduleSubjectIds(module).some((subjectId) =>
      enrolledSubjectIds.has(subjectId),
    )
      ? 'PAYMENT'
      : 'ADVANCE_STUDY'
    const existing = grants.find(
      (grant) =>
        grant.module === module.id && grant.access_type === accessType,
    )
    setSavingId(existing?.id ?? 'new')
    setMessage('')

    try {
      await api(
        existing ? `/modules/access/${existing.id}/` : '/modules/access/',
        {
          body: JSON.stringify({
            access_type: accessType,
            amount_paid: amountPaid,
            expires_at: expiresAt
              ? new Date(expiresAt).toISOString()
              : null,
            is_active: true,
            module: module.id,
            notes,
            payment_reference: reference,
            payment_status: 'PAID',
            student: studentId,
          }),
          method: existing ? 'PATCH' : 'POST',
        },
      )
      setMessage('Cash payment recorded and module access activated.')
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
      await api(`/modules/access/${grant.id}/`, {
        body: JSON.stringify({ is_active: false }),
        method: 'PATCH',
      })
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
    setAmountPaid(grant.amount_paid)
    setExpiresAt(defaultExpiryValue())
    setReference(grant.payment_reference)
    setNotes(grant.notes)
    setMessage('Review the payment details and record the new activation.')
  }

  return (
    <div
      aria-labelledby="manage-student-modules-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <button
        aria-label="Close module payment"
        className="attendance-modal__backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="attendance-modal__panel attendance-modal__panel--wide student-module-access-dialog">
        <div className="attendance-modal__header">
          <div>
            <strong id="manage-student-modules-title">Module Payment And Access</strong>
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
            <p>Enrolled modules remain locked until cash payment is recorded.</p>
          </div>
          <div className="student-module-access-list">
            {enrolledModules.map((module) => {
              const grant = grants.find(
                (candidate) =>
                  candidate.module === module.id &&
                  candidate.access_type === 'PAYMENT',
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
            <p className="eyebrow">Cash activation</p>
            <h3>Record Module Payment</h3>
            <p>Selecting a non-enrolled module records an advance-module purchase.</p>
          </div>
          <form className="student-module-grant-form" onSubmit={activate}>
            <label className="admin-field">
              <span>Module</span>
              <select
                onChange={(event) => selectModule(event.target.value)}
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
              <span>Amount paid</span>
              <input
                min="0"
                onChange={(event) => setAmountPaid(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amountPaid}
              />
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
            <label className="admin-field">
              <span>Receipt / reference</span>
              <input
                onChange={(event) => setReference(event.target.value)}
                type="text"
                value={reference}
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
              <span>{savingId ? 'Saving...' : 'Record Payment'}</span>
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
                    <small>Paid {Number(grant.amount_paid).toFixed(2)}</small>
                  </div>
                  <div className="student-module-access-list__actions">
                    <span className={grant.is_available ? 'status-pill status-pill--success' : 'status-pill'}>
                      {grant.is_available ? 'Active' : grant.is_active ? 'Expired' : 'Revoked'}
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
              <p className="admin-empty-line">No module payments recorded.</p>
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
