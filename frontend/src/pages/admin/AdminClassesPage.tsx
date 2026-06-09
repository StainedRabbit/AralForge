import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ApiPage,
  ScheduleStudent,
  SchoolYear,
  SchoolYearSemester,
  StudentProfile,
  Subject,
  SubjectSchedule,
  User,
} from '../../types'
import { toOptions } from '../../admin/adminHelpers'
import { formatTime, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

const semesterOptions = [
  { label: '1st Semester', value: 'FIRST' },
  { label: '2nd Semester', value: 'SECOND' },
  { label: 'Summer', value: 'SUMMER' },
]

const STUDENT_PAGE_SIZE = 50

type ClassSetupMode = 'schedule' | 'subject' | 'term'

type StudentImportRow = {
  email: string
  firstName: string
  lastName: string
  section: string
  studentNumber: string
  username: string
  yearLevel: number | null
}

export function AdminClassesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null)
  const activeTerm = getActiveTerm(data.terms)
  const [selectedTermId, setSelectedTermId] = useState(
    activeTerm?.id.toString() ?? '',
  )
  const [query, setQuery] = useState('')
  const selectedSchedule =
    data.schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null
  const visibleSchedules = filterSchedules(data.schedules, query, selectedTermId)
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)

  return (
    <Page>
      <PageHeader
        eyebrow="Academic structure"
        title="Classes"
        description="Find classes, create academic setup, and manage class rosters."
      />

      <section className="classes-setup__grid">
        <div className="classes-setup__panel section-block">
          <SectionHeading
            subtitle={`${visibleSchedules.length} class${visibleSchedules.length === 1 ? '' : 'es'}`}
            title="Find Class"
          />
          <ClassFinder
            query={query}
            schedules={visibleSchedules}
            selectedSchedule={selectedSchedule}
            selectedTermId={selectedTermId}
            setQuery={setQuery}
            setSelectedScheduleId={setSelectedScheduleId}
            setSelectedTermId={setSelectedTermId}
            termOptions={termOptions}
          />
        </div>

        <div className="classes-setup__panel section-block">
          <SectionHeading
            subtitle={selectedSchedule ? classScheduleSummary(selectedSchedule) : 'Create or update setup'}
            title="Class Setup"
          />
          <ClassSetupPanel
            api={api}
            data={data}
            refresh={refresh}
            selectedSchedule={selectedSchedule}
            setSelectedScheduleId={setSelectedScheduleId}
          />
        </div>
      </section>

      <ClassRoster
        api={api}
        data={data}
        refresh={refresh}
        selectedSchedule={selectedSchedule}
      />
    </Page>
  )
}

function ClassFinder({
  query,
  schedules,
  selectedSchedule,
  selectedTermId,
  setQuery,
  setSelectedScheduleId,
  setSelectedTermId,
  termOptions,
}: {
  query: string
  schedules: SubjectSchedule[]
  selectedSchedule: SubjectSchedule | null
  selectedTermId: string
  setQuery: (value: string) => void
  setSelectedScheduleId: (value: number) => void
  setSelectedTermId: (value: string) => void
  termOptions: { label: string; value: number | string }[]
}) {
  return (
    <div className="class-finder">
      <div className="class-finder__filters">
        <label className="admin-field">
          <span>School-year semester</span>
          <select
            onChange={(event) => setSelectedTermId(event.target.value)}
            value={selectedTermId}
          >
            <option value="">All terms</option>
            {termOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Search class</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Subject, section, day, room"
            type="search"
            value={query}
          />
        </label>
      </div>

      <div className="class-list">
        {schedules.map((schedule) => (
          <button
            className={
              selectedSchedule?.id === schedule.id
                ? 'class-list__item active'
                : 'class-list__item'
            }
            key={schedule.id}
            onClick={() => setSelectedScheduleId(schedule.id)}
            type="button"
          >
            <span className="class-list__top">
              <strong>{schedule.subject_code}</strong>
              <small>{classScheduleSummary(schedule)}</small>
            </span>
            <span>{schedule.subject_name}</span>
            <small>
              {schedule.term_name} {schedule.room ? `- ${schedule.room}` : ''}
            </small>
          </button>
        ))}
        {!schedules.length ? (
          <p className="admin-empty-line">No classes found.</p>
        ) : null}
      </div>
    </div>
  )
}

function ClassSetupPanel({
  api,
  data,
  refresh,
  selectedSchedule,
  setSelectedScheduleId,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
  selectedSchedule: SubjectSchedule | null
  setSelectedScheduleId: (value: number | null) => void
}) {
  const [mode, setMode] = useState<ClassSetupMode>('schedule')

  return (
    <div className="class-setup">
      <div className="segmented-control" role="tablist" aria-label="Class setup">
        <button
          className={mode === 'schedule' ? 'active' : ''}
          onClick={() => setMode('schedule')}
          type="button"
        >
          Schedule
        </button>
        <button
          className={mode === 'subject' ? 'active' : ''}
          onClick={() => setMode('subject')}
          type="button"
        >
          Subject
        </button>
        <button
          className={mode === 'term' ? 'active' : ''}
          onClick={() => setMode('term')}
          type="button"
        >
          Term
        </button>
      </div>

      {mode === 'schedule' ? (
        <ScheduleForm
          api={api}
          data={data}
          refresh={refresh}
          selectedSchedule={selectedSchedule}
          setSelectedScheduleId={setSelectedScheduleId}
        />
      ) : null}
      {mode === 'subject' ? (
        <SubjectForm api={api} refresh={refresh} />
      ) : null}
      {mode === 'term' ? (
        <TermForm api={api} data={data} refresh={refresh} />
      ) : null}
    </div>
  )
}

function ScheduleForm({
  api,
  data,
  refresh,
  selectedSchedule,
  setSelectedScheduleId,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
  selectedSchedule: SubjectSchedule | null
  setSelectedScheduleId: (value: number | null) => void
}) {
  const [draft, setDraft] = useState(() => scheduleDraft(selectedSchedule))
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)

  useEffect(() => {
    setDraft(scheduleDraft(selectedSchedule))
  }, [selectedSchedule])

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const schedule = await api<SubjectSchedule>(
        selectedSchedule
          ? `/subjects/subject-schedules/${selectedSchedule.id}/`
          : '/subjects/subject-schedules/',
        {
          body: JSON.stringify({
            days: draft.days,
            end_time: draft.end_time,
            is_active: draft.is_active,
            room: draft.room,
            school_year_semester: Number(draft.school_year_semester),
            section: draft.section,
            start_time: draft.start_time,
            subject: Number(draft.subject),
          }),
          method: selectedSchedule ? 'PATCH' : 'POST',
        },
      )
      setSelectedScheduleId(schedule.id)
      setMessage('Schedule saved.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="class-form" onSubmit={submitForm}>
      <div className="class-form__header">
        <strong>{selectedSchedule ? 'Edit schedule' : 'New schedule'}</strong>
        {selectedSchedule ? (
          <button
            className="button button--ghost"
            onClick={() => {
              setSelectedScheduleId(null)
              setDraft(scheduleDraft(null))
            }}
            type="button"
          >
            <Icon name="plus" />
            <span>New</span>
          </button>
        ) : null}
      </div>

      <label className="admin-field">
        <span>Subject</span>
        <select
          onChange={(event) =>
            setDraft((current) => ({ ...current, subject: event.target.value }))
          }
          required
          value={draft.subject}
        >
          <option value="">Select subject</option>
          {subjectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-field">
        <span>Term</span>
        <select
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              school_year_semester: event.target.value,
            }))
          }
          required
          value={draft.school_year_semester}
        >
          <option value="">Select term</option>
          {termOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="class-form__split">
        <label className="admin-field">
          <span>Section</span>
          <input
            onChange={(event) =>
              setDraft((current) => ({ ...current, section: event.target.value }))
            }
            placeholder="BSIT-1A"
            type="text"
            value={draft.section}
          />
        </label>
        <label className="admin-field">
          <span>Room</span>
          <input
            onChange={(event) =>
              setDraft((current) => ({ ...current, room: event.target.value }))
            }
            placeholder="Lab 1"
            type="text"
            value={draft.room}
          />
        </label>
      </div>

      <label className="admin-field">
        <span>Days</span>
        <input
          onChange={(event) =>
            setDraft((current) => ({ ...current, days: event.target.value }))
          }
          placeholder="MWF"
          required
          type="text"
          value={draft.days}
        />
      </label>

      <div className="class-form__split">
        <label className="admin-field">
          <span>Start time</span>
          <input
            onChange={(event) =>
              setDraft((current) => ({ ...current, start_time: event.target.value }))
            }
            required
            type="time"
            value={draft.start_time}
          />
        </label>
        <label className="admin-field">
          <span>End time</span>
          <input
            onChange={(event) =>
              setDraft((current) => ({ ...current, end_time: event.target.value }))
            }
            required
            type="time"
            value={draft.end_time}
          />
        </label>
      </div>

      <label className="admin-check">
        <input
          checked={draft.is_active}
          onChange={(event) =>
            setDraft((current) => ({ ...current, is_active: event.target.checked }))
          }
          type="checkbox"
        />
        <span>Active schedule</span>
      </label>

      {message ? <p className="admin-message">{message}</p> : null}

      <button className="button button--primary class-save-button" disabled={saving} type="submit">
        <Icon name="save" />
        <span>{saving ? 'Saving...' : 'Save schedule'}</span>
      </button>
    </form>
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

function ClassRoster({
  api,
  data,
  refresh,
  selectedSchedule,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
  selectedSchedule: SubjectSchedule | null
}) {
  const [isAdding, setIsAdding] = useState(false)
  const roster = selectedSchedule
    ? data.enrollments.filter(
        (enrollment) =>
          enrollment.schedule === selectedSchedule.id && enrollment.is_active,
      )
    : []

  return (
    <section className="section-block">
      <SectionHeading
        action={
          <button
            className="button button--primary"
            disabled={!selectedSchedule}
            onClick={() => setIsAdding(true)}
            type="button"
          >
            <Icon name="plus" />
            <span>Add students</span>
          </button>
        }
        subtitle={
          selectedSchedule
            ? `${selectedSchedule.subject_code} ${selectedSchedule.section || ''} - ${roster.length} student${roster.length === 1 ? '' : 's'}`
            : 'Select a class'
        }
        title="Roster"
      />

      <div className="table-wrap">
        <table className="admin-table class-roster-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Student number</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((enrollment) => (
              <RosterRow
                api={api}
                enrollment={enrollment}
                key={enrollment.id}
                refresh={refresh}
              />
            ))}
            {!selectedSchedule ? (
              <tr>
                <td colSpan={4}>Select a class to view its roster.</td>
              </tr>
            ) : null}
            {selectedSchedule && !roster.length ? (
              <tr>
                <td colSpan={4}>No active students in this class.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedSchedule && isAdding ? (
        <AddStudentsModal
          api={api}
          data={data}
          refresh={refresh}
          schedule={selectedSchedule}
          onClose={() => setIsAdding(false)}
        />
      ) : null}
    </section>
  )
}

function RosterRow({
  api,
  enrollment,
  refresh,
}: {
  api: AuthedRequest
  enrollment: ScheduleStudent
  refresh: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  async function removeStudent() {
    setSaving(true)

    try {
      await api(`/subjects/schedule-students/${enrollment.id}/`, {
        body: JSON.stringify({ is_active: false }),
        method: 'PATCH',
      })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>{enrollment.student_name}</td>
      <td>{enrollment.student_number || 'None'}</td>
      <td>{enrollment.is_active ? 'Active' : 'Inactive'}</td>
      <td>
        <button
          className="button button--secondary"
          disabled={saving}
          onClick={() => void removeStudent()}
          type="button"
        >
          <Icon name="trash" />
          <span>Remove</span>
        </button>
      </td>
    </tr>
  )
}

function AddStudentsModal({
  api,
  data,
  onClose,
  refresh,
  schedule,
}: {
  api: AuthedRequest
  data: WorkspaceData
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [query, setQuery] = useState('')
  const [importRows, setImportRows] = useState<StudentImportRow[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [students, setStudents] = useState<User[]>([])
  const [studentCount, setStudentCount] = useState(0)
  const [nextStudentOffset, setNextStudentOffset] = useState<number | null>(0)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentError, setStudentError] = useState('')
  const hasMoreStudents = nextStudentOffset !== null

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void loadAvailableStudents({
        offset: 0,
        reset: true,
        signal: controller.signal,
      })
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [query, schedule.id, data.enrollments])

  async function loadAvailableStudents({
    offset,
    reset,
    signal,
  }: {
    offset: number
    reset: boolean
    signal?: AbortSignal
  }) {
    setLoadingStudents(true)
    setStudentError('')

    try {
      const page = await api<ApiPage<User>>(
        buildAvailableStudentsPath(schedule.id, query, offset),
        { signal },
      )

      setStudents((current) =>
        reset ? page.results : mergeStudents(current, page.results),
      )
      setStudentCount(page.count)
      setNextStudentOffset(page.next)
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        setStudentError(toErrorMessage(caughtError))
      }
    } finally {
      setLoadingStudents(false)
    }
  }

  async function addStudents() {
    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        selectedIds.map((studentId) =>
          api('/subjects/schedule-students/', {
            body: JSON.stringify({
              is_active: true,
              schedule: schedule.id,
              student: studentId,
            }),
            method: 'POST',
          }),
        ),
      )
      setMessage('Students added.')
      setSelectedIds([])
      await refresh()
      await loadAvailableStudents({ offset: 0, reset: true })
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function importStudents() {
    if (!importRows.length) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      let createdCount = 0
      let existingCount = 0
      let enrolledCount = 0
      let skippedCount = 0

      for (const row of importRows) {
        const existingProfile = findProfileByStudentNumber(
          data.profiles,
          row.studentNumber,
        )
        let studentId = existingProfile?.user ?? null

        if (studentId) {
          existingCount += 1
        } else {
          const user = await api<User>('/accounts/users/', {
            body: JSON.stringify({
              email: row.email,
              first_name: row.firstName,
              is_active: true,
              last_name: row.lastName,
              password: row.studentNumber,
              role: 'STUDENT',
              username: row.studentNumber,
            }),
            method: 'POST',
          })

          studentId = user.id
          createdCount += 1

          await api<StudentProfile>('/accounts/students/', {
            body: JSON.stringify({
              is_active: true,
              section: row.section || schedule.section,
              student_number: row.studentNumber,
              user: user.id,
              year_level: row.yearLevel,
            }),
            method: 'POST',
          })
        }

        const existingEnrollment = data.enrollments.find(
          (enrollment) =>
            enrollment.schedule === schedule.id && enrollment.student === studentId,
        )

        if (existingEnrollment?.is_active) {
          skippedCount += 1
          continue
        }

        if (existingEnrollment) {
          await api(`/subjects/schedule-students/${existingEnrollment.id}/`, {
            body: JSON.stringify({ is_active: true }),
            method: 'PATCH',
          })
        } else {
          await api('/subjects/schedule-students/', {
            body: JSON.stringify({
              is_active: true,
              schedule: schedule.id,
              student: studentId,
            }),
            method: 'POST',
          })
        }

        enrolledCount += 1
      }

      setImportRows([])
      setMessage(
        `Imported ${enrolledCount} enrollment${enrolledCount === 1 ? '' : 's'}. ${createdCount} new, ${existingCount} existing, ${skippedCount} already enrolled.`,
      )
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function readImportFile(file: File | null) {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const rows = parseStudentImport(text)
      setImportRows(rows)
      setMessage(`${rows.length} student${rows.length === 1 ? '' : 's'} ready to import.`)
    } catch (caughtError) {
      setImportRows([])
      setMessage(toErrorMessage(caughtError))
    }
  }

  return (
    <div
      aria-labelledby="add-students-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide">
        <div className="attendance-modal__header">
          <div>
            <strong id="add-students-title">Add students</strong>
            <span>{schedule.subject_code} {schedule.section || ''}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <Icon name="close" />
          </button>
        </div>

        <label className="admin-field">
          <span>Search students</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or username"
            type="search"
            value={query}
          />
        </label>

        <div className="class-import-panel">
          <div>
            <strong>Import roster</strong>
            <span>
              CSV columns: student_number, first_name, last_name, email, section,
              year_level, username.
            </span>
          </div>
          <label className="admin-field">
            <span>Student list CSV</span>
            <input
              accept=".csv,text/csv,text/plain"
              onChange={(event) => void readImportFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          {importRows.length ? (
            <button
              className="button button--secondary"
              disabled={saving}
              onClick={() => void importStudents()}
              type="button"
            >
              <Icon name="upload" />
              <span>
                {saving ? 'Importing...' : `Import ${importRows.length} students`}
              </span>
            </button>
          ) : null}
        </div>

        {studentError ? <p className="admin-message">{studentError}</p> : null}

        <div className="student-picker-list">
          {loadingStudents && !students.length ? (
            <p className="admin-empty-line">Loading students...</p>
          ) : null}
          {students.map((student) => (
            <label className="student-picker-list__item" key={student.id}>
              <input
                checked={selectedIds.includes(student.id)}
                onChange={(event) =>
                  setSelectedIds((current) =>
                    event.target.checked
                      ? [...current, student.id]
                      : current.filter((id) => id !== student.id),
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{fullName(student)}</strong>
                <small>{student.username}</small>
              </span>
            </label>
          ))}
          {!loadingStudents && !students.length ? (
            <p className="admin-empty-line">No available students found.</p>
          ) : null}
        </div>

        <div className="student-picker-footer">
          <span>
            {studentCount
              ? `${students.length} of ${studentCount} available students shown`
              : 'No available students shown'}
          </span>
          {hasMoreStudents ? (
            <button
              className="button button--secondary"
              disabled={loadingStudents || saving}
              onClick={() =>
                void loadAvailableStudents({
                  offset: nextStudentOffset,
                  reset: false,
                })
              }
              type="button"
            >
              <Icon name="plus" />
              <span>{loadingStudents ? 'Loading...' : 'Load more'}</span>
            </button>
          ) : null}
        </div>

        {message ? <p className="admin-message">{message}</p> : null}

        <div className="class-modal-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={saving || !selectedIds.length}
            onClick={() => void addStudents()}
            type="button"
          >
            <Icon name="save" />
            <span>{saving ? 'Adding...' : `Add ${selectedIds.length}`}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function scheduleDraft(schedule: SubjectSchedule | null) {
  return {
    days: schedule?.days ?? '',
    end_time: schedule?.end_time ?? '',
    is_active: schedule?.is_active ?? true,
    room: schedule?.room ?? '',
    school_year_semester: schedule?.school_year_semester
      ? String(schedule.school_year_semester)
      : '',
    section: schedule?.section ?? '',
    start_time: schedule?.start_time ?? '',
    subject: schedule?.subject ? String(schedule.subject) : '',
  }
}

function filterSchedules(
  schedules: SubjectSchedule[],
  query: string,
  selectedTermId: string,
) {
  const normalizedQuery = query.trim().toLowerCase()
  const termFiltered = selectedTermId
    ? schedules.filter(
        (schedule) => schedule.school_year_semester === Number(selectedTermId),
      )
    : schedules

  if (!normalizedQuery) {
    return termFiltered
  }

  return termFiltered.filter((schedule) =>
    `${schedule.subject_code} ${schedule.subject_name} ${schedule.section} ${schedule.days} ${schedule.room} ${schedule.term_name}`
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

function classScheduleSummary(schedule: SubjectSchedule) {
  return [
    schedule.section,
    schedule.days,
    `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`,
  ]
    .filter(Boolean)
    .join(' ')
}

function buildAvailableStudentsPath(
  scheduleId: number,
  query: string,
  offset: number,
) {
  const params = new URLSearchParams({
    limit: String(STUDENT_PAGE_SIZE),
    offset: String(offset),
    schedule: String(scheduleId),
  })
  const normalizedQuery = query.trim()

  if (normalizedQuery) {
    params.set('search', normalizedQuery)
  }

  return `/accounts/users/available_students/?${params.toString()}`
}

function mergeStudents(current: User[], incoming: User[]) {
  const seen = new Set(current.map((student) => student.id))
  return [
    ...current,
    ...incoming.filter((student) => {
      if (seen.has(student.id)) {
        return false
      }

      seen.add(student.id)
      return true
    }),
  ]
}

function isAbortError(caughtError: unknown) {
  return (
    caughtError instanceof DOMException
    && caughtError.name === 'AbortError'
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

function getActiveTerm(terms: SchoolYearSemester[]) {
  return terms.find((term) => term.is_active) ?? terms[0] ?? null
}

function findProfileByStudentNumber(
  profiles: StudentProfile[],
  studentNumber: string,
) {
  const normalizedNumber = normalizeStudentNumber(studentNumber)
  return profiles.find(
    (profile) => normalizeStudentNumber(profile.student_number) === normalizedNumber,
  )
}

function normalizeStudentNumber(value: string) {
  return value.trim().toLowerCase()
}

function parseStudentImport(text: string): StudentImportRow[] {
  const rows = parseCsvRows(text).filter((row) =>
    row.some((cell) => cell.trim()),
  )

  if (!rows.length) {
    throw new Error('The imported file is empty.')
  }

  const headers = rows[0].map(normalizeImportHeader)
  const hasHeader = headers.includes('student_number')
  const dataRows = hasHeader ? rows.slice(1) : rows

  const parsedRows = dataRows.map((row, index) => {
    const getCell = (name: string, fallbackIndex: number) => {
      const headerIndex = headers.indexOf(name)
      return (row[hasHeader ? headerIndex : fallbackIndex] ?? '').trim()
    }
    const studentNumber = getCell('student_number', 0)

    if (!studentNumber) {
      throw new Error(`Row ${index + (hasHeader ? 2 : 1)} is missing a student number.`)
    }

    return {
      email: getCell('email', 3),
      firstName: getCell('first_name', 1),
      lastName: getCell('last_name', 2),
      section: getCell('section', 4),
      studentNumber,
      username: getCell('username', 6),
      yearLevel: parseOptionalNumber(getCell('year_level', 5)),
    }
  })

  const seenNumbers = new Set<string>()

  return parsedRows.filter((row) => {
    const number = normalizeStudentNumber(row.studentNumber)

    if (seenNumbers.has(number)) {
      return false
    }

    seenNumbers.add(number)
    return true
  })
}

function normalizeImportHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function parseOptionalNumber(value: string) {
  if (!value) {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  rows.push(row)
  return rows
}
