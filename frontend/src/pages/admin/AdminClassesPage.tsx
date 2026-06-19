import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ApiPage,
  GradeCategory,
  GradeItem,
  ScheduleStudent,
  SchoolYearSemester,
  StudentGradeItemScore,
  StudentProfile,
  SubjectSchedule,
  User,
} from '../../types'
import { toOptions } from '../../admin/adminHelpers'
import { formatTime, numeric, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

const STUDENT_PAGE_SIZE = 50
const gradingPeriods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
const gradingPeriodLabels: Record<(typeof gradingPeriods)[number], string> = {
  FINAL: 'Final',
  MIDTERM: 'Midterm',
  PREFINAL: 'Prefinal',
  PRELIM: 'Prelim',
}

type StudentImportRow = {
  email: string
  firstName: string
  lastName: string
  section: string
  studentNumber: string
  username: string
  yearLevel: number | null
}

type RosterRowData = {
  email: string
  enrollment: ScheduleStudent
  grades: PrimaryGradeSummary
  studentName: string
  studentNumber: string
}

type PrimaryGradeSummary = {
  finalPeriod: string
  midterm: string
  overall: string
  prefinal: string
  prelim: string
  remarks: string
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
        description="Select a class, edit its schedule, and manage its roster."
      />

      <section className="classes-setup__grid">
        <div className="classes-setup__panel section-block">
          <SectionHeading
            subtitle={`${visibleSchedules.length} class${visibleSchedules.length === 1 ? '' : 'es'}`}
            title="Select Class"
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
            subtitle={selectedSchedule ? classScheduleSummary(selectedSchedule) : 'Create or update schedule'}
            title="Schedule Setup"
          />
          <ScheduleForm
            api={api}
            data={data}
            key={selectedSchedule?.id ?? 'new'}
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
  const [rosterQuery, setRosterQuery] = useState('')
  const [gradeRow, setGradeRow] = useState<RosterRowData | null>(null)
  const roster = selectedSchedule
    ? data.enrollments.filter(
        (enrollment) => enrollment.schedule === selectedSchedule.id,
      )
    : []
  const rosterRows = roster.map((enrollment) => getRosterRow(enrollment, data))
  const visibleRows = filterRosterRows(rosterRows, rosterQuery)
  const activeCount = roster.filter((enrollment) => enrollment.is_active).length
  const rosterSubtitle = selectedSchedule
    ? `${selectedSchedule.subject_code} ${selectedSchedule.section || ''} - ${activeCount} active student${activeCount === 1 ? '' : 's'}`
    : 'Select a class'

  return (
    <section className="section-block">
      <SectionHeading
        action={
          <div className="class-roster-actions">
            <button
              className="button button--secondary"
              disabled={!selectedSchedule || !visibleRows.length}
              onClick={() => exportRosterCsv(selectedSchedule, visibleRows)}
              type="button"
            >
              <Icon name="file" />
              <span>Export CSV</span>
            </button>
            {selectedSchedule ? (
              <Link
                className="button button--secondary"
                to={gradebookUrl(selectedSchedule.id)}
              >
                <Icon name="grade" />
                <span>Open Gradebook</span>
              </Link>
            ) : null}
            <button
              className="button button--primary"
              disabled={!selectedSchedule}
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Icon name="plus" />
              <span>Add students</span>
            </button>
          </div>
        }
        subtitle={rosterSubtitle}
        title="Roster"
      />

      {selectedSchedule ? (
        <div className="class-roster-tools">
          <div className="class-roster-summary">
            <span>
              <strong>{activeCount}</strong>
              Active students
            </span>
          </div>
          <label className="admin-search class-roster-search">
            <Icon name="search" />
            <input
              onChange={(event) => setRosterQuery(event.target.value)}
              placeholder="Search roster by name or student number"
              type="search"
              value={rosterQuery}
            />
          </label>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="admin-table class-roster-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Student number</th>
              <th>Email</th>
              <th>Prelim</th>
              <th>Midterm</th>
              <th>Prefinal</th>
              <th>Final</th>
              <th>Overall</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <RosterRow
                api={api}
                row={row}
                key={row.enrollment.id}
                onOpenGrades={setGradeRow}
                refresh={refresh}
              />
            ))}
            {!selectedSchedule ? (
              <tr>
                <td colSpan={10}>Select a class to view and manage enrolled students.</td>
              </tr>
            ) : null}
            {selectedSchedule && !roster.length ? (
              <tr>
                <td colSpan={10}>No active students in this class yet. Add students to build the roster.</td>
              </tr>
            ) : null}
            {selectedSchedule && roster.length && !visibleRows.length ? (
              <tr>
                <td colSpan={10}>No roster matches found for this search.</td>
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

      {selectedSchedule && gradeRow ? (
        <GradeDetailsModal
          data={data}
          row={gradeRow}
          schedule={selectedSchedule}
          onClose={() => setGradeRow(null)}
        />
      ) : null}
    </section>
  )
}

function RosterRow({
  api,
  onOpenGrades,
  row,
  refresh,
}: {
  api: AuthedRequest
  onOpenGrades: (row: RosterRowData) => void
  row: RosterRowData
  refresh: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const { enrollment } = row

  async function toggleEnrollment() {
    setSaving(true)

    try {
      await api(`/subjects/schedule-students/${enrollment.id}/`, {
        body: JSON.stringify({ is_active: !enrollment.is_active }),
        method: 'PATCH',
      })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function removeEnrollment() {
    setRemoving(true)

    try {
      await api(`/subjects/schedule-students/${enrollment.id}/`, {
        method: 'DELETE',
      })
      await refresh()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <tr>
      <td>
        <strong>{row.studentName}</strong>
      </td>
      <td>{row.studentNumber}</td>
      <td>{row.email}</td>
      <td><GradeCell value={row.grades.prelim} /></td>
      <td><GradeCell value={row.grades.midterm} /></td>
      <td><GradeCell value={row.grades.prefinal} /></td>
      <td><GradeCell value={row.grades.finalPeriod} /></td>
      <td><GradeCell value={row.grades.overall} strong /></td>
      <td>
        <span className={enrollment.is_active ? 'roster-status roster-status--active' : 'roster-status'}>
          {enrollment.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <div className="roster-row-actions">
          <button
            className="button button--secondary button--compact"
            disabled={saving || removing}
            onClick={() => onOpenGrades(row)}
            type="button"
          >
            <Icon name="grade" />
            <span>Grades</span>
          </button>
          <Link
            className="button button--secondary button--compact"
            to={gradebookUrl(enrollment.schedule, enrollment.student)}
          >
            <Icon name="edit" />
            <span>Record Score</span>
          </Link>
          <button
            className="button button--secondary button--compact"
            disabled={saving || removing}
            onClick={() => void toggleEnrollment()}
            type="button"
          >
            <Icon name={enrollment.is_active ? 'close' : 'check'} />
            <span>
              {saving
                ? 'Saving...'
                : enrollment.is_active
                  ? 'Deactivate'
                  : 'Activate'}
            </span>
          </button>
          <button
            className="button button--secondary button--compact roster-remove-button"
            disabled={saving || removing}
            onClick={() => void removeEnrollment()}
            type="button"
          >
            <Icon name="trash" />
            <span>{removing ? 'Removing...' : 'Remove'}</span>
          </button>
        </div>
      </td>
    </tr>
  )
}

function GradeCell({ strong = false, value }: { strong?: boolean; value: string }) {
  return (
    <span className={strong ? 'roster-grade roster-grade--strong' : 'roster-grade'}>
      {value}
    </span>
  )
}

function GradeDetailsModal({
  data,
  onClose,
  row,
  schedule,
}: {
  data: WorkspaceData
  onClose: () => void
  row: RosterRowData
  schedule: SubjectSchedule
}) {
  const finalGrade = findFinalGrade(data, schedule.subject, row.enrollment.student)
  const categories = data.gradeCategories.filter(
    (category) => category.subject === schedule.subject,
  )
  const categoryGrades = data.categoryGrades.filter(
    (grade) =>
      grade.subject === schedule.subject &&
      grade.student === row.enrollment.student,
  )
  const itemScores = data.gradeItemScores.filter(
    (score) =>
      score.subject === schedule.subject &&
      score.student === row.enrollment.student,
  )

  return (
    <div
      aria-labelledby="grade-details-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide">
        <div className="attendance-modal__header">
          <div>
            <strong id="grade-details-title">Grade details</strong>
            <span>
              {row.studentName} - {row.studentNumber} - {schedule.subject_code}
            </span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="grade-modal-meta">
          <span className={row.enrollment.is_active ? 'roster-status roster-status--active' : 'roster-status'}>
            {row.enrollment.is_active ? 'Active enrollment' : 'Inactive enrollment'}
          </span>
          <span>{schedule.subject_name}</span>
          <span>{classScheduleSummary(schedule) || 'No schedule summary'}</span>
        </div>

        <section className="grade-summary-grid">
          <GradeSummaryItem label="Prelim" value={row.grades.prelim} />
          <GradeSummaryItem label="Midterm" value={row.grades.midterm} />
          <GradeSummaryItem label="Prefinal" value={row.grades.prefinal} />
          <GradeSummaryItem label="Final period" value={row.grades.finalPeriod} />
          <GradeSummaryItem label="Overall" value={row.grades.overall} />
        </section>

        {!hasAnyPeriodGrade(row.grades) ? (
          <p className="admin-empty-line">No period grades recorded for this student yet.</p>
        ) : null}
        {!finalGrade ? (
          <p className="admin-empty-line">No final grade record yet.</p>
        ) : null}
        {finalGrade?.remarks ? (
          <p className="grade-remarks">
            <strong>Remarks</strong>
            <span>{finalGrade.remarks}</span>
          </p>
        ) : null}

        <section className="grade-breakdown-panel">
          <SectionHeading
            subtitle={`${itemScores.length} item score${itemScores.length === 1 ? '' : 's'} recorded`}
            title="Grade Breakdown"
          />
          {!categories.length ? (
            <p className="admin-empty-line">No grade categories configured for this subject yet.</p>
          ) : (
            gradingPeriods.map((period) => {
              const periodCategories = categories.filter(
                (category) => category.grading_period === period,
              )

              if (!periodCategories.length) {
                return null
              }

              return (
                <div className="grade-period-block" key={period}>
                  <strong>{gradingPeriodLabels[period]}</strong>
                  <div className="table-wrap">
                    <table className="admin-table grade-breakdown-table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Raw / Total</th>
                          <th>Transmuted</th>
                          <th>Weighted / Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodCategories.map((category) => {
                          const grade = categoryGrades.find(
                            (candidate) => candidate.grade_category === category.id,
                          )
                          const gradeItems = data.gradeItems
                            .filter((item) => item.grade_category === category.id)
                            .sort((left, right) => left.order - right.order || left.id - right.id)
                          const rows = gradeItems
                            .map((item) => ({
                              item,
                              score: itemScores.find((score) => score.grade_item === item.id) ?? null,
                            }))
                            .filter((entry) => entry.score)

                          return (
                            <GradeCategoryBreakdownRows
                              category={category}
                              grade={grade ?? null}
                              itemRows={rows}
                              key={category.id}
                            />
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })
          )}
          {categories.length && !categoryGrades.length ? (
            <p className="admin-empty-line">No category grades recorded for this student yet.</p>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function GradeCategoryBreakdownRows({
  category,
  grade,
  itemRows,
}: {
  category: GradeCategory
  grade: {
    raw_score: string
    total_score: string
    transmuted_grade: string | null
    weighted_score: string | null
  } | null
  itemRows: { item: GradeItem; score: StudentGradeItemScore | null }[]
}) {
  if (!itemRows.length) {
    return (
      <tr>
        <td>
          <strong>{category.name}</strong>
          <span>{category.category} - {formatGradeValue(category.weight)}%</span>
        </td>
        <td>{grade ? `${formatGradeValue(grade.raw_score)} / ${formatGradeValue(grade.total_score)}` : '-'}</td>
        <td>{gradeValue(grade?.transmuted_grade ?? null)}</td>
        <td>{gradeValue(grade?.weighted_score ?? null)}</td>
      </tr>
    )
  }

  return (
    <>
      {itemRows.map(({ item, score }) => (
        <tr key={item.id}>
          <td>
            <strong>{item.source_title || item.title}</strong>
            <span>{sourceTypeLabel(item.source_type)} - {category.name}</span>
          </td>
          <td>{score ? `${formatGradeValue(score.raw_score)} / ${formatGradeValue(score.total_score)}` : '-'}</td>
          <td>{gradeValue(score?.transmuted_grade ?? null)}</td>
          <td>{score?.remarks || '-'}</td>
        </tr>
      ))}
      <tr className="grade-category-total-row">
        <td>
          <strong>{category.name} total</strong>
          <span>{category.category} - {formatGradeValue(category.weight)}%</span>
        </td>
        <td>{grade ? `${formatGradeValue(grade.raw_score)} / ${formatGradeValue(grade.total_score)}` : '-'}</td>
        <td>{gradeValue(grade?.transmuted_grade ?? null)}</td>
        <td>{gradeValue(grade?.weighted_score ?? null)}</td>
      </tr>
    </>
  )
}

function GradeSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grade-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

  const loadAvailableStudents = useCallback(async function loadAvailableStudents({
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
  }, [api, query, schedule.id])

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
  }, [data.enrollments, loadAvailableStudents])

  async function addStudents() {
    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        selectedIds.map((studentId) => {
          const existingEnrollment = data.enrollments.find(
            (enrollment) =>
              enrollment.schedule === schedule.id && enrollment.student === studentId,
          )

          if (existingEnrollment) {
            return api(`/subjects/schedule-students/${existingEnrollment.id}/`, {
              body: JSON.stringify({ is_active: true }),
              method: 'PATCH',
            })
          }

          return api('/subjects/schedule-students/', {
            body: JSON.stringify({
              is_active: true,
              schedule: schedule.id,
              student: studentId,
            }),
            method: 'POST',
          })
        }),
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

function getRosterRow(enrollment: ScheduleStudent, data: WorkspaceData): RosterRowData {
  const profile = data.profiles.find((candidate) => candidate.user === enrollment.student)
  const user = data.users.find((candidate) => candidate.id === enrollment.student)

  return {
    email: user?.email || 'None',
    enrollment,
    grades: getPrimaryGradeSummary(data, enrollment.subject, enrollment.student),
    studentName: enrollment.student_name || fullName(user ?? null),
    studentNumber: enrollment.student_number || profile?.student_number || 'None',
  }
}

function getPrimaryGradeSummary(
  data: WorkspaceData,
  subjectId: number,
  studentId: number,
): PrimaryGradeSummary {
  const finalGrade = findFinalGrade(data, subjectId, studentId)

  return {
    finalPeriod: gradeValue(
      finalGrade?.final_period_grade ?? findPeriodGrade(data, subjectId, studentId, 'FINAL'),
    ),
    midterm: gradeValue(
      finalGrade?.midterm_grade ?? findPeriodGrade(data, subjectId, studentId, 'MIDTERM'),
    ),
    overall: gradeValue(finalGrade?.final_grade ?? null),
    prefinal: gradeValue(
      finalGrade?.prefinal_grade ?? findPeriodGrade(data, subjectId, studentId, 'PREFINAL'),
    ),
    prelim: gradeValue(
      finalGrade?.prelim_grade ?? findPeriodGrade(data, subjectId, studentId, 'PRELIM'),
    ),
    remarks: finalGrade?.remarks || '',
  }
}

function findFinalGrade(data: WorkspaceData, subjectId: number, studentId: number) {
  return data.finalGrades.find(
    (grade) => grade.subject === subjectId && grade.student === studentId,
  )
}

function findPeriodGrade(
  data: WorkspaceData,
  subjectId: number,
  studentId: number,
  period: (typeof gradingPeriods)[number],
) {
  return data.periodGrades.find(
    (grade) =>
      grade.subject === subjectId &&
      grade.student === studentId &&
      grade.grading_period === period,
  )?.raw_score ?? null
}

function gradeValue(value: string | null) {
  return value ? formatGradeValue(value) : '-'
}

function formatGradeValue(value: string | number) {
  return numeric(value).toFixed(2)
}

function sourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    ASSESSMENT: 'Assessment',
    ATTENDANCE: 'Attendance',
    CODING: 'Coding',
    MANUAL: 'Manual',
    MODULE_ACTIVITY: 'Module activity',
  }

  return labels[value] ?? value
}

function hasAnyPeriodGrade(grades: PrimaryGradeSummary) {
  return [
    grades.finalPeriod,
    grades.midterm,
    grades.prefinal,
    grades.prelim,
  ].some((value) => value !== '-')
}

function filterRosterRows(rows: RosterRowData[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return rows
  }

  return rows.filter((row) =>
    `${row.studentName} ${row.studentNumber}`.toLowerCase().includes(normalizedQuery),
  )
}

function exportRosterCsv(
  schedule: SubjectSchedule | null,
  rows: RosterRowData[],
) {
  if (!schedule || !rows.length) {
    return
  }

  const headers = [
    'Student',
    'Student number',
    'Email',
    'Prelim',
    'Midterm',
    'Prefinal',
    'Final',
    'Overall',
    'Status',
  ]
  const csvRows = rows.map((row) => [
    row.studentName,
    row.studentNumber,
    row.email,
    row.grades.prelim,
    row.grades.midterm,
    row.grades.prefinal,
    row.grades.finalPeriod,
    row.grades.overall,
    row.enrollment.is_active ? 'Active' : 'Inactive',
  ])
  const csv = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `${schedule.subject_code}-${schedule.section || 'class'}-roster.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

function gradebookUrl(scheduleId: number, studentId?: number) {
  const params = new URLSearchParams({ schedule: String(scheduleId) })

  if (studentId) {
    params.set('student', String(studentId))
  }

  return `/admin/gradebook?${params.toString()}`
}

function isAbortError(caughtError: unknown) {
  return (
    caughtError instanceof DOMException
    && caughtError.name === 'AbortError'
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
