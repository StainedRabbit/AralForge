import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { toOptions } from '../../admin/adminHelpers'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type { SchoolYear, SchoolYearSemester, Subject } from '../../types'
import { toErrorMessage } from '../../utils/format'

const semesterOptions = [
  { label: '1st Semester', value: 'FIRST' },
  { label: '2nd Semester', value: 'SECOND' },
  { label: 'Summer', value: 'SUMMER' },
]

export function AdminAcademicSetupPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  return (
    <Page>
      <PageHeader
        eyebrow="Academic structure"
        title="Academic Setup"
        description="Create subjects, school years, and terms used by class schedules."
      />

      <section className="academic-setup__grid">
        <div className="section-block">
          <SectionHeading
            subtitle={`${data.subjects.length} subject${data.subjects.length === 1 ? '' : 's'}`}
            title="Subjects"
          />
          <SubjectForm api={api} refresh={refresh} />
        </div>

        <div className="section-block">
          <SectionHeading
            subtitle={`${data.terms.length} term${data.terms.length === 1 ? '' : 's'}`}
            title="Terms"
          />
          <TermForm api={api} data={data} refresh={refresh} />
        </div>
      </section>
    </Page>
  )
}

function SubjectForm({
  api,
  refresh,
}: {
  api: AuthedRequest
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
      await api<Subject>('/subjects/subjects/', {
        body: JSON.stringify(draft),
        method: 'POST',
      })
      setDraft({ code: '', description: '', is_active: true, name: '' })
      setMessage('Subject created.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="class-form" onSubmit={submitForm}>
      <label className="admin-field">
        <span>Code</span>
        <input
          onChange={(event) =>
            setDraft((current) => ({ ...current, code: event.target.value }))
          }
          required
          type="text"
          value={draft.code}
        />
      </label>
      <label className="admin-field">
        <span>Name</span>
        <input
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
          required
          type="text"
          value={draft.name}
        />
      </label>
      <label className="admin-field">
        <span>Description</span>
        <textarea
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
          rows={3}
          value={draft.description}
        />
      </label>
      <label className="admin-check">
        <input
          checked={draft.is_active}
          onChange={(event) =>
            setDraft((current) => ({ ...current, is_active: event.target.checked }))
          }
          type="checkbox"
        />
        <span>Active subject</span>
      </label>
      {message ? <p className="admin-message">{message}</p> : null}
      <button className="button button--primary class-save-button" disabled={saving} type="submit">
        <Icon name="save" />
        <span>{saving ? 'Saving...' : 'Create subject'}</span>
      </button>
    </form>
  )
}

function TermForm({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [yearDraft, setYearDraft] = useState({
    end_year: new Date().getFullYear() + 1,
    is_active: true,
    start_year: new Date().getFullYear(),
  })
  const [termDraft, setTermDraft] = useState({
    is_active: true,
    school_year: '',
    semester: 'FIRST',
  })
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const schoolYearOptions = toOptions(
    data.schoolYears,
    (year) => year.id,
    (year) => year.name,
  )

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const year = await api<SchoolYear>('/subjects/school-years/', {
        body: JSON.stringify(yearDraft),
        method: 'POST',
      })
      setTermDraft((current) => ({ ...current, school_year: String(year.id) }))
      setMessage('School year created.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function createTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

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
        await setOnlyActiveTerm(api, data.terms, term.id)
      }
      setMessage('Term created.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="class-form">
      <form className="class-form__subform" onSubmit={createYear}>
        <strong>School year</strong>
        <div className="class-form__split">
          <label className="admin-field">
            <span>Start</span>
            <input
              onChange={(event) =>
                setYearDraft((current) => ({
                  ...current,
                  start_year: Number(event.target.value),
                  end_year: Number(event.target.value) + 1,
                }))
              }
              required
              type="number"
              value={yearDraft.start_year}
            />
          </label>
          <label className="admin-field">
            <span>End</span>
            <input
              onChange={(event) =>
                setYearDraft((current) => ({
                  ...current,
                  end_year: Number(event.target.value),
                }))
              }
              required
              type="number"
              value={yearDraft.end_year}
            />
          </label>
        </div>
        <button className="button button--secondary" disabled={saving} type="submit">
          <Icon name="plus" />
          <span>Create school year</span>
        </button>
      </form>

      <form className="class-form__subform" onSubmit={createTerm}>
        <strong>Term</strong>
        <label className="admin-field">
          <span>School year</span>
          <select
            onChange={(event) =>
              setTermDraft((current) => ({
                ...current,
                school_year: event.target.value,
              }))
            }
            required
            value={termDraft.school_year}
          >
            <option value="">Select school year</option>
            {schoolYearOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Semester</span>
          <select
            onChange={(event) =>
              setTermDraft((current) => ({
                ...current,
                semester: event.target.value,
              }))
            }
            value={termDraft.semester}
          >
            {semesterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-check">
          <input
            checked={termDraft.is_active}
            onChange={(event) =>
              setTermDraft((current) => ({
                ...current,
                is_active: event.target.checked,
              }))
            }
            type="checkbox"
          />
          <span>Active term</span>
        </label>
        <button className="button button--primary" disabled={saving} type="submit">
          <Icon name="save" />
          <span>Create term</span>
        </button>
      </form>

      <div className="class-form__subform">
        <strong>Existing terms</strong>
        <div className="term-toggle-list">
          {data.terms.map((term) => (
            <TermToggleRow
              api={api}
              key={term.id}
              refresh={refresh}
              setMessage={setMessage}
              setSaving={setSaving}
              term={term}
              terms={data.terms}
            />
          ))}
          {!data.terms.length ? (
            <p className="admin-empty-line">No terms created yet.</p>
          ) : null}
        </div>
      </div>

      {message ? <p className="admin-message">{message}</p> : null}
    </div>
  )
}

function TermToggleRow({
  api,
  refresh,
  setMessage,
  setSaving,
  term,
  terms,
}: {
  api: AuthedRequest
  refresh: () => Promise<void>
  setMessage: (value: string) => void
  setSaving: (value: boolean) => void
  term: SchoolYearSemester
  terms: SchoolYearSemester[]
}) {
  async function toggleTerm(isActive: boolean) {
    setSaving(true)
    setMessage('')

    try {
      if (isActive) {
        await setOnlyActiveTerm(api, terms, term.id)
      } else {
        await api(`/subjects/school-year-semesters/${term.id}/`, {
          body: JSON.stringify({ is_active: false }),
          method: 'PATCH',
        })
      }
      setMessage(isActive ? `${term.name} is now active.` : `${term.name} deactivated.`)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="term-toggle-list__item">
      <span>
        <strong>{term.name}</strong>
        <small>{term.is_active ? 'Active default' : 'Inactive'}</small>
      </span>
      <input
        checked={term.is_active}
        onChange={(event) => void toggleTerm(event.target.checked)}
        type="checkbox"
      />
    </label>
  )
}

async function setOnlyActiveTerm(
  api: AuthedRequest,
  terms: SchoolYearSemester[],
  activeTermId: number,
) {
  const includesActiveTerm = terms.some((term) => term.id === activeTermId)

  await Promise.all(
    [
      ...terms.map((term) =>
        api(`/subjects/school-year-semesters/${term.id}/`, {
          body: JSON.stringify({ is_active: term.id === activeTermId }),
          method: 'PATCH',
        }),
      ),
      ...(!includesActiveTerm
        ? [
            api(`/subjects/school-year-semesters/${activeTermId}/`, {
              body: JSON.stringify({ is_active: true }),
              method: 'PATCH',
            }),
          ]
        : []),
    ],
  )
}
