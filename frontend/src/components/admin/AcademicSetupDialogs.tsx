import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AuthedRequest } from '../../app/types'
import type { SchoolYear, SchoolYearSemester, Subject } from '../../types'
import { toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'

const semesterOptions = [
  { label: '1st Semester', value: 'FIRST' },
  { label: '2nd Semester', value: 'SECOND' },
  { label: 'Summer', value: 'SUMMER' },
] as const

export function SubjectCreateDialog({
  api,
  onClose,
  onCreated,
  refresh,
}: {
  api: AuthedRequest
  onClose: () => void
  onCreated: (subjectId: number) => void
  refresh: () => Promise<void>
}) {
  const [draft, setDraft] = useState({
    code: '',
    description: '',
    is_active: true,
    name: '',
  })
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const subject = await api<Subject>('/subjects/subjects/', {
        body: JSON.stringify(draft),
        method: 'POST',
      })
      await refresh()
      onCreated(subject.id)
      onClose()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AcademicDialog
      busy={saving}
      description="Add a subject without leaving Schedule Setup."
      id="create-subject-title"
      onClose={onClose}
      title="Create subject"
    >
      <form className="academic-create-form" onSubmit={submitForm}>
        <div className="class-form__split">
          <label className="admin-field">
            <span>Code</span>
            <input
              data-autofocus
              maxLength={30}
              onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
              required
              type="text"
              value={draft.code}
            />
          </label>
          <label className="admin-field">
            <span>Name</span>
            <input
              maxLength={150}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              required
              type="text"
              value={draft.name}
            />
          </label>
        </div>
        <label className="admin-field">
          <span>Description</span>
          <textarea
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            rows={3}
            value={draft.description}
          />
        </label>
        <label className="admin-check">
          <input
            checked={draft.is_active}
            onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
            type="checkbox"
          />
          <span>Active subject</span>
        </label>
        {message ? <p className="admin-message academic-dialog-error" role="alert">{message}</p> : null}
        <div className="class-modal-actions">
          <button className="button button--secondary" disabled={saving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="plus" />
            <span>{saving ? 'Creating...' : 'Create subject'}</span>
          </button>
        </div>
      </form>
    </AcademicDialog>
  )
}

export function TermManagementDialog({
  api,
  onClose,
  onSelectTerm,
  refresh,
  schoolYears,
  terms,
}: {
  api: AuthedRequest
  onClose: () => void
  onSelectTerm: (termId: number) => void
  refresh: () => Promise<void>
  schoolYears: SchoolYear[]
  terms: SchoolYearSemester[]
}) {
  const currentYear = new Date().getFullYear()
  const [showYearForm, setShowYearForm] = useState(!schoolYears.length)
  const [yearDraft, setYearDraft] = useState({
    end_year: currentYear + 1,
    is_active: true,
    start_year: currentYear,
  })
  const [termDraft, setTermDraft] = useState({
    is_active: true,
    school_year: String(schoolYears.find((year) => year.is_active)?.id ?? schoolYears[0]?.id ?? ''),
    semester: 'FIRST' as SchoolYearSemester['semester'],
  })
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'error' | 'status'>('status')
  const [pendingActiveTermId, setPendingActiveTermId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setMessageTone('status')

    try {
      const year = await api<SchoolYear>('/subjects/school-years/', {
        body: JSON.stringify(yearDraft),
        method: 'POST',
      })
      await refresh()
      setTermDraft((current) => ({ ...current, school_year: String(year.id) }))
      setShowYearForm(false)
      setMessage(`${year.name} created and selected.`)
    } catch (caughtError) {
      setMessageTone('error')
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function createTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setMessageTone('status')

    try {
      const term = await api<SchoolYearSemester>('/subjects/school-year-semesters/', {
        body: JSON.stringify({
          is_active: false,
          school_year: Number(termDraft.school_year),
          semester: termDraft.semester,
        }),
        method: 'POST',
      })
      if (termDraft.is_active) {
        await setOnlyActiveTerm(api, terms, term.id)
      }
      await refresh()
      onSelectTerm(term.id)
      onClose()
    } catch (caughtError) {
      setMessageTone('error')
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function selectActiveTerm(termId: number) {
    setPendingActiveTermId(termId)
    setSaving(true)
    setMessage('')
    setMessageTone('status')

    try {
      await setOnlyActiveTerm(api, terms, termId)
      await refresh()
      onSelectTerm(termId)
      const term = terms.find((item) => item.id === termId)
      setMessage(`${term?.name ?? 'Term'} is now the active default and is selected.`)
    } catch (caughtError) {
      setMessageTone('error')
      setMessage(toErrorMessage(caughtError))
    } finally {
      setPendingActiveTermId(null)
      setSaving(false)
    }
  }

  return (
    <AcademicDialog
      busy={saving}
      description="Create school years and terms, or choose the active default."
      id="manage-terms-title"
      onClose={onClose}
      title="Manage terms"
    >
      <section className="academic-dialog-section">
        <div className="academic-dialog-section__heading">
          <div>
            <strong>School year</strong>
            <span>Create one only when the required year is not listed.</span>
          </div>
          <button
            aria-controls="new-school-year-form"
            aria-expanded={showYearForm}
            className="button button--secondary button--compact"
            disabled={saving}
            onClick={() => setShowYearForm((current) => !current)}
            type="button"
          >
            <Icon name={showYearForm ? 'close' : 'plus'} />
            <span>{showYearForm ? 'Cancel' : 'New school year'}</span>
          </button>
        </div>
        {showYearForm ? (
          <form className="academic-create-form academic-year-form" id="new-school-year-form" onSubmit={createYear}>
            <div className="class-form__split">
              <label className="admin-field">
                <span>Start year</span>
                <input
                  data-autofocus={!schoolYears.length || undefined}
                  onChange={(event) => {
                    const startYear = Number(event.target.value)
                    setYearDraft((current) => ({
                      ...current,
                      end_year: startYear + 1,
                      start_year: startYear,
                    }))
                  }}
                  required
                  type="number"
                  value={yearDraft.start_year}
                />
              </label>
              <label className="admin-field">
                <span>End year</span>
                <input
                  onChange={(event) => setYearDraft((current) => ({ ...current, end_year: Number(event.target.value) }))}
                  required
                  type="number"
                  value={yearDraft.end_year}
                />
              </label>
            </div>
            <button className="button button--secondary" disabled={saving} type="submit">
              <Icon name="plus" />
              <span>{saving ? 'Creating...' : 'Create school year'}</span>
            </button>
          </form>
        ) : null}
      </section>

      <form className="academic-dialog-section academic-create-form" onSubmit={createTerm}>
        <strong>Create term</strong>
        <div className="class-form__split">
          <label className="admin-field">
            <span>School year</span>
            <select
              aria-label="School year"
              data-autofocus={schoolYears.length ? true : undefined}
              onChange={(event) => setTermDraft((current) => ({ ...current, school_year: event.target.value }))}
              required
              value={termDraft.school_year}
            >
              <option value="">Select school year</option>
              {schoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Semester</span>
            <select
              aria-label="Semester"
              onChange={(event) => setTermDraft((current) => ({
                ...current,
                semester: event.target.value as SchoolYearSemester['semester'],
              }))}
              value={termDraft.semester}
            >
              {semesterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="admin-check">
          <input
            checked={termDraft.is_active}
            onChange={(event) => setTermDraft((current) => ({ ...current, is_active: event.target.checked }))}
            type="checkbox"
          />
          <span>Make this the active default term</span>
        </label>
        <button className="button button--primary" disabled={saving || !termDraft.school_year} type="submit">
          <Icon name="plus" />
          <span>{saving ? 'Creating...' : 'Create term'}</span>
        </button>
      </form>

      <fieldset className="academic-dialog-section academic-term-list" disabled={saving}>
        <legend>Active default term</legend>
        <div className="term-toggle-list">
          {terms.map((term) => (
            <label className="term-toggle-list__item" key={term.id}>
              <span>
                <strong>{term.name}</strong>
                <small>{term.is_active ? 'Current default' : 'Inactive'}</small>
              </span>
              <input
                checked={pendingActiveTermId === null ? term.is_active : pendingActiveTermId === term.id}
                name="active-default-term"
                onChange={() => void selectActiveTerm(term.id)}
                type="radio"
              />
            </label>
          ))}
          {!terms.length ? <p className="admin-empty-line">No terms created yet.</p> : null}
        </div>
      </fieldset>

      {message ? (
        <p
          aria-live="polite"
          className={messageTone === 'error' ? 'admin-message academic-dialog-error' : 'admin-message'}
          role={messageTone === 'error' ? 'alert' : undefined}
        >
          {message}
        </p>
      ) : null}
      <div className="class-modal-actions">
        <span />
        <button className="button button--secondary" disabled={saving} onClick={onClose} type="button">
          Done
        </button>
      </div>
    </AcademicDialog>
  )
}

function AcademicDialog({
  busy,
  children,
  description,
  id,
  onClose,
  title,
}: {
  busy: boolean
  children: ReactNode
  description: string
  id: string
  onClose: () => void
  title: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      const initialTarget = panel?.querySelector<HTMLElement>('[data-autofocus]')
        ?? panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      initialTarget?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]',
      ) ?? [],
    ).filter((element) => !element.closest('[hidden]'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div aria-labelledby={id} aria-modal="true" className="attendance-modal" onKeyDown={handleKeyDown} role="dialog">
      <button
        aria-label={`Close ${title}`}
        className="attendance-modal__backdrop"
        disabled={busy}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="attendance-modal__panel academic-setup-dialog" ref={panelRef}>
        <div className="attendance-modal__header">
          <div>
            <strong id={id}>{title}</strong>
            <span>{description}</span>
          </div>
          <button aria-label={`Close ${title}`} className="icon-button" disabled={busy} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

async function setOnlyActiveTerm(
  api: AuthedRequest,
  terms: SchoolYearSemester[],
  activeTermId: number,
) {
  const includesActiveTerm = terms.some((term) => term.id === activeTermId)

  await Promise.all([
    ...terms.map((term) => api(`/subjects/school-year-semesters/${term.id}/`, {
      body: JSON.stringify({ is_active: term.id === activeTermId }),
      method: 'PATCH',
    })),
    ...(!includesActiveTerm
      ? [api(`/subjects/school-year-semesters/${activeTermId}/`, {
          body: JSON.stringify({ is_active: true }),
          method: 'PATCH',
        })]
      : []),
  ])
}
