import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { asArray } from '../../api'
import { Icon } from '../../components/Icon'
import { ClassAttendanceDialog } from '../../components/admin/ClassAttendanceDialog'
import { ManageStudentModulesDialog } from '../../components/admin/ManageStudentModulesDialog'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ApiPage,
  ApiList,
  GradeCategory,
  GradeItem,
  Module,
  ScheduleStudent,
  SchoolYearSemester,
  StudentGradeItemScore,
  SubjectSchedule,
  User,
} from '../../types'
import { toOptions } from '../../admin/adminHelpers'
import { formatTime, numeric, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

const STUDENT_PAGE_SIZE = 50
const weekdays = [
  { code: 'MO', label: 'Monday', short: 'Mon' },
  { code: 'TU', label: 'Tuesday', short: 'Tue' },
  { code: 'WE', label: 'Wednesday', short: 'Wed' },
  { code: 'TH', label: 'Thursday', short: 'Thu' },
  { code: 'FR', label: 'Friday', short: 'Fri' },
  { code: 'SA', label: 'Saturday', short: 'Sat' },
  { code: 'SU', label: 'Sunday', short: 'Sun' },
] as const
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

type ImportPreview = {
  valid: boolean
  row_count: number
  ready_count: number
  rows: Array<{
    row: number
    student_number?: string
    student_name?: string
    status: 'ready' | 'error'
    error?: string
  }>
  added_count?: number
  reactivated_count?: number
  already_active_count?: number
}

type RosterApiItem = ScheduleStudent & {
  email: string
  grade_summary: Partial<Record<
    'prelim' | 'midterm' | 'prefinal' | 'final' | 'overall' | 'remarks',
    string | number | null
  >>
}

type RosterApiPage = ApiPage<RosterApiItem> & {
  total_count: number
  active_count: number
  inactive_count: number
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
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingScheduleIdRef = useRef<number | null>(null)
  const activeTerm = getActiveTerm(data.terms)
  const [selectedTermId, setSelectedTermId] = useState(
    searchParams.get('term') ?? activeTerm?.id.toString() ?? '',
  )
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const requestedScheduleId = Number(searchParams.get('schedule'))
  const requestedWorkspaceSchedule = data.schedules.find(
    (schedule) => schedule.id === requestedScheduleId,
  )
  const queryTermId = requestedWorkspaceSchedule
    ? String(requestedWorkspaceSchedule.school_year_semester)
    : selectedTermId
  const queryClient = useQueryClient()
  const scheduleListQuery = useQuery({
    queryKey: ['classes', queryTermId, query],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100', status: 'all' })
      if (queryTermId) params.set('term', queryTermId)
      if (query.trim()) params.set('search', query.trim())
      return api<ApiList<SubjectSchedule>>(
        `/subjects/subject-schedules/?${params.toString()}`,
      )
    },
  })
  const routeSchedules = scheduleListQuery.data
    ? asArray(scheduleListQuery.data)
    : data.schedules
  const selectedSchedule =
    routeSchedules.find((schedule) => schedule.id === requestedScheduleId)
    ?? requestedWorkspaceSchedule
    ?? null
  const effectiveTermId = selectedSchedule
    ? String(selectedSchedule.school_year_semester)
    : selectedTermId
  const visibleSchedules = filterSchedules(
    routeSchedules,
    query,
    effectiveTermId,
  )
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)

  const refreshClasses = useCallback(async () => {
    await refresh()
    await queryClient.invalidateQueries({ queryKey: ['classes'] })
  }, [queryClient, refresh])

  const selectSchedule = useCallback((value: number | null) => {
    pendingScheduleIdRef.current = value
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('schedule', String(value))
      else next.delete('schedule')
      return next
    })
  }, [setSearchParams])

  const selectTerm = useCallback((value: string) => {
    setSelectedTermId(value)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('term', value)
      else next.delete('term')
      return next
    }, { replace: true })
    if (value && selectedSchedule && selectedSchedule.school_year_semester !== Number(value)) {
      selectSchedule(null)
    }
  }, [selectSchedule, selectedSchedule, setSearchParams])

  const updateQuery = useCallback((value: string) => {
    setQuery(value)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value.trim()) next.set('q', value)
      else next.delete('q')
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (!selectedTermId && !searchParams.has('term') && activeTerm) {
      queueMicrotask(() => setSelectedTermId(String(activeTerm.id)))
    }
  }, [activeTerm, searchParams, selectedTermId])

  useEffect(() => {
    if (data.loading) return
    if (selectedSchedule) {
      if (pendingScheduleIdRef.current === selectedSchedule.id) {
        pendingScheduleIdRef.current = null
      }
      return
    }
    if (requestedScheduleId && pendingScheduleIdRef.current === requestedScheduleId) return
    if (searchParams.has('schedule') && !selectedSchedule) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('schedule')
        return next
      }, { replace: true })
    }
  }, [data.loading, requestedScheduleId, searchParams, selectedSchedule, setSearchParams])

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
            selectedTermId={effectiveTermId}
            setQuery={updateQuery}
            setSelectedScheduleId={selectSchedule}
            setSelectedTermId={selectTerm}
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
            defaultTermId={activeTerm?.id ?? null}
            key={selectedSchedule?.id ?? 'new'}
            refresh={refreshClasses}
            selectedSchedule={selectedSchedule}
            setSelectedScheduleId={selectSchedule}
          />
        </div>
      </section>

      <ClassRoster
        api={api}
        data={data}
        refresh={refreshClasses}
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
            {!termOptions.length ? (
              <option value="">No terms available</option>
            ) : null}
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
              {!schedule.is_active ? ' - Archived' : ''}
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
  defaultTermId,
  refresh,
  selectedSchedule,
  setSelectedScheduleId,
}: {
  api: AuthedRequest
  data: WorkspaceData
  defaultTermId: number | null
  refresh: () => Promise<void>
  selectedSchedule: SubjectSchedule | null
  setSelectedScheduleId: (value: number | null) => void
}) {
  const [initialDraft, setInitialDraft] = useState(() =>
    scheduleDraft(selectedSchedule, defaultTermId),
  )
  const [draft, setDraft] = useState(() => scheduleDraft(selectedSchedule, defaultTermId))
  const [changingStatus, setChangingStatus] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft)

  useEffect(() => {
    if (!isDirty) return
    function preventAccidentalExit(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', preventAccidentalExit)
    return () => window.removeEventListener('beforeunload', preventAccidentalExit)
  }, [isDirty])

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.days) {
      setMessage('Select at least one meeting day.')
      return
    }
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
      const savedDraft = scheduleDraft(schedule, defaultTermId)
      setInitialDraft(savedDraft)
      setDraft(savedDraft)
      setSelectedScheduleId(schedule.id)
      setMessage('Schedule saved.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function changeClassStatus() {
    if (!selectedSchedule) {
      return
    }
    setChangingStatus(true)
    setMessage('')

    try {
      await api(`/subjects/subject-schedules/${selectedSchedule.id}/${selectedSchedule.is_active ? 'archive' : 'restore'}/`, {
        method: 'POST',
      })
      setMessage(selectedSchedule.is_active ? 'Class archived.' : 'Class restored.')
      setShowArchiveConfirm(false)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setChangingStatus(false)
    }
  }

  return (
    <>
    <form className="class-form" onSubmit={submitForm}>
      <div className="class-form__header">
        <strong>{selectedSchedule ? 'Edit schedule' : 'New schedule'}</strong>
        {selectedSchedule ? (
          <button
            className="button button--ghost"
            disabled={changingStatus || saving}
            onClick={() => {
              setSelectedScheduleId(null)
              setDraft(scheduleDraft(null, defaultTermId))
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

      <fieldset className="admin-field class-days-field">
        <legend>Days</legend>
        <div className="class-day-options">
          {weekdays.map((day) => {
            const selected = parseClassDays(draft.days).has(day.code)
            return (
              <label className={selected ? 'class-day-option active' : 'class-day-option'} key={day.code}>
                <input
                  aria-label={day.label}
                  checked={selected}
                  onChange={() => {
                    setDraft((current) => ({
                      ...current,
                      days: toggleClassDay(current.days, day.code),
                    }))
                    setMessage('')
                  }}
                  type="checkbox"
                />
                <span>{day.short}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

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

      {selectedSchedule ? (
        <p className="admin-status-line">
          Status: <strong>{selectedSchedule.is_active ? 'Active' : 'Archived'}</strong>
        </p>
      ) : null}

      {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}

      <div className="class-form__actions">
        <button
          className="button button--primary class-save-button"
          disabled={changingStatus || saving}
          type="submit"
        >
          <Icon name="save" />
          <span>{saving ? 'Saving...' : 'Save schedule'}</span>
        </button>
        {selectedSchedule ? (
          <button
            className={selectedSchedule.is_active
              ? 'button button--secondary button--danger class-delete-button'
              : 'button button--secondary class-delete-button'}
            disabled={changingStatus || saving}
            onClick={() => {
              if (selectedSchedule.is_active) setShowArchiveConfirm(true)
              else void changeClassStatus()
            }}
            type="button"
          >
            <Icon name={selectedSchedule.is_active ? 'archive' : 'check'} />
            <span>
              {changingStatus
                ? 'Saving...'
                : selectedSchedule.is_active ? 'Archive class' : 'Restore class'}
            </span>
          </button>
        ) : null}
      </div>
    </form>
    {selectedSchedule && showArchiveConfirm ? (
      <ConfirmDialog
        confirmLabel="Archive class"
        description={`Archive ${selectedSchedule.subject_code} ${selectedSchedule.section || ''}? Its roster, attendance, and grades will be preserved.`}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={() => void changeClassStatus()}
        title="Archive this class?"
      />
    ) : null}
    </>
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
  const location = useLocation()
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false)
  const [rosterQuery, setRosterQuery] = useState('')
  const [rosterStatus, setRosterStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [rosterMessage, setRosterMessage] = useState('')
  const [gradeRow, setGradeRow] = useState<RosterRowData | null>(null)
  const [moduleRow, setModuleRow] = useState<RosterRowData | null>(null)
  const localRoster = selectedSchedule
    ? data.enrollments.filter(
        (enrollment) => enrollment.schedule === selectedSchedule.id,
      )
    : []
  const rosterPageQuery = useQuery({
    enabled: Boolean(selectedSchedule),
    queryKey: ['class-roster', selectedSchedule?.id, rosterQuery, rosterStatus],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100', status: rosterStatus })
      if (rosterQuery.trim()) params.set('search', rosterQuery.trim())
      return api<RosterApiPage>(
        `/subjects/subject-schedules/${selectedSchedule!.id}/roster/?${params.toString()}`,
      )
    },
  })
  const rosterRows = rosterPageQuery.data
    ? rosterPageQuery.data.results.map(apiRosterRow)
    : localRoster.map((enrollment) => getRosterRow(enrollment, data))
  const visibleRows = rosterPageQuery.data
    ? rosterRows
    : filterRosterRows(rosterRows, rosterQuery, rosterStatus)
  const activeCount = rosterPageQuery.data?.active_count
    ?? localRoster.filter((enrollment) => enrollment.is_active).length
  const inactiveCount = rosterPageQuery.data?.inactive_count
    ?? localRoster.length - activeCount
  const totalCount = rosterPageQuery.data?.total_count ?? localRoster.length
  const refreshClassRoster = useCallback(async () => {
    await refresh()
    await queryClient.invalidateQueries({
      queryKey: ['class-roster', selectedSchedule?.id],
    })
  }, [queryClient, refresh, selectedSchedule?.id])

  async function updateVisibleEnrollmentStatus(isActive: boolean) {
    if (!selectedSchedule || !visibleRows.length) return
    setBulkSaving(true)
    setRosterMessage('')
    try {
      const result = await api<{ changed_count: number }>(
        `/subjects/subject-schedules/${selectedSchedule.id}/update-enrollments/`,
        {
          body: JSON.stringify({
            enrollment_ids: visibleRows.map((row) => row.enrollment.id),
            is_active: isActive,
          }),
          method: 'POST',
        },
      )
      setRosterMessage(`${result.changed_count} enrollment${result.changed_count === 1 ? '' : 's'} updated.`)
      await refreshClassRoster()
    } catch (caughtError) {
      setRosterMessage(toErrorMessage(caughtError))
    } finally {
      setBulkSaving(false)
    }
  }
  const classModules = selectedSchedule
    ? modulesForSubject(data.modules, selectedSchedule.subject)
    : []
  const primaryClassModule = classModules[0] ?? null
  const moduleProgressUrl = selectedSchedule && primaryClassModule
    ? `/admin/modules/${primaryClassModule.id}/progress?schedule=${selectedSchedule.id}&returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`
    : null
  const rosterSubtitle = selectedSchedule
    ? `${selectedSchedule.subject_code} ${selectedSchedule.section || ''} - ${activeCount} active student${activeCount === 1 ? '' : 's'}`
    : 'Select a class'

  return (
    <section className="section-block">
      <SectionHeading
        action={
          <div className="class-roster-actions">
            <button
              className="button button--primary"
              disabled={!selectedSchedule?.is_active || !activeCount}
              onClick={() => setIsAttendanceOpen(true)}
              type="button"
            >
              <Icon name="check" />
              <span>Attendance</span>
            </button>
            <button
              className="button button--secondary"
              disabled={!selectedSchedule}
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Icon name="plus" />
              <span>Add students</span>
            </button>
            <RosterActionsMenu
              attendanceReportsTo={selectedSchedule ? `/admin/attendance?schedule=${selectedSchedule.id}` : null}
              exportDisabled={!selectedSchedule || !visibleRows.length}
              gradebookTo={selectedSchedule ? gradebookUrl(selectedSchedule.id) : null}
              moduleProgressTo={moduleProgressUrl}
              onExport={() => {
                if (selectedSchedule) exportRosterCsv(selectedSchedule, visibleRows)
              }}
            />
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
            <span>
              <strong>{inactiveCount}</strong>
              Inactive students
            </span>
          </div>
          <label className="admin-field class-roster-status-filter">
            <span>Roster status</span>
            <select
              onChange={(event) => setRosterStatus(event.target.value as 'active' | 'inactive' | 'all')}
              value={rosterStatus}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All students</option>
            </select>
          </label>
          <div className="class-roster-bulk-actions">
            {rosterStatus !== 'active' ? (
              <button
                className="button button--secondary button--compact"
                disabled={bulkSaving || !visibleRows.length}
                onClick={() => void updateVisibleEnrollmentStatus(true)}
                type="button"
              >
                Activate shown
              </button>
            ) : null}
            {rosterStatus !== 'inactive' ? (
              <button
                className="button button--secondary button--compact"
                disabled={bulkSaving || !visibleRows.length}
                onClick={() => void updateVisibleEnrollmentStatus(false)}
                type="button"
              >
                Deactivate shown
              </button>
            ) : null}
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

      {rosterMessage ? (
        <p aria-live="polite" className="admin-message">{rosterMessage}</p>
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
                onOpenModules={setModuleRow}
                refresh={refreshClassRoster}
                schedule={selectedSchedule!}
              />
            ))}
            {!selectedSchedule ? (
              <tr>
                <td colSpan={10}>Select a class to view and manage enrolled students.</td>
              </tr>
            ) : null}
            {selectedSchedule && !totalCount ? (
              <tr>
                <td colSpan={10}>No active students in this class yet. Add students to build the roster.</td>
              </tr>
            ) : null}
            {selectedSchedule && totalCount && !visibleRows.length ? (
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
          refresh={refreshClassRoster}
          schedule={selectedSchedule}
          onClose={() => setIsAdding(false)}
        />
      ) : null}

      {selectedSchedule && isAttendanceOpen ? (
        <ClassAttendanceDialog
          api={api}
          data={data}
          initialTab="take"
          key={selectedSchedule.id}
          refresh={refreshClassRoster}
          schedule={selectedSchedule}
          onClose={() => setIsAttendanceOpen(false)}
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

      {moduleRow ? (
        <ManageStudentModulesDialog
          api={api}
          data={data}
          defaultSubjectId={selectedSchedule?.subject}
          onClose={() => setModuleRow(null)}
          refresh={refreshClassRoster}
          studentId={moduleRow.enrollment.student}
          studentName={moduleRow.studentName}
        />
      ) : null}

    </section>
  )
}

function ConfirmDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: {
  confirmLabel: string
  description: string
  onCancel: () => void
  onConfirm: () => void
  title: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
    )
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

  return (
    <div
      aria-labelledby="class-confirm-title"
      aria-describedby="class-confirm-description"
      aria-modal="true"
      className="attendance-modal"
      onKeyDown={handleKeyDown}
      role="dialog"
    >
      <button
        aria-label="Dismiss confirmation"
        className="attendance-modal__backdrop"
        onClick={onCancel}
        type="button"
      />
      <div className="attendance-modal__panel class-confirm-dialog" ref={panelRef}>
        <div>
          <strong id="class-confirm-title">{title}</strong>
          <p id="class-confirm-description">{description}</p>
        </div>
        <div className="class-modal-actions">
          <button className="button button--secondary" onClick={onCancel} ref={cancelRef} type="button">
            Cancel
          </button>
          <button className="button button--danger" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function RosterActionsMenu({
  attendanceReportsTo,
  exportDisabled,
  gradebookTo,
  moduleProgressTo,
  onExport,
}: {
  attendanceReportsTo: string | null
  exportDisabled: boolean
  gradebookTo: string | null
  moduleProgressTo: string | null
  onExport: () => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function closeMenu() {
    setOpen(false)
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
    )
    if (!items.length) return

    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home') items[0].focus()
    else if (event.key === 'End') items[items.length - 1].focus()
    else if (event.key === 'ArrowDown') items[(currentIndex + 1) % items.length].focus()
    else items[(currentIndex - 1 + items.length) % items.length].focus()
  }

  return (
    <div className="roster-actions-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="button button--secondary"
        disabled={!gradebookTo}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        <Icon name="more" />
        <span>More actions</span>
      </button>
      {open ? (
        <div className="roster-actions-menu__popover" onKeyDown={handleMenuKeyDown} ref={menuRef} role="menu">
          <button
            disabled={exportDisabled}
            onClick={() => {
              onExport()
              closeMenu()
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="file" />
            <span>Export roster CSV</span>
          </button>
          {gradebookTo ? (
            <Link onClick={closeMenu} role="menuitem" to={gradebookTo}>
              <Icon name="grade" />
              <span>Open Gradebook</span>
            </Link>
          ) : null}
          {attendanceReportsTo ? (
            <Link onClick={closeMenu} role="menuitem" to={attendanceReportsTo}>
              <Icon name="calendar" />
              <span>Attendance reports</span>
            </Link>
          ) : null}
          {moduleProgressTo ? (
            <Link onClick={closeMenu} role="menuitem" to={moduleProgressTo}>
              <Icon name="module" />
              <span>View Module Progress</span>
            </Link>
          ) : (
            <button disabled role="menuitem" type="button">
              <Icon name="module" />
              <span>Module Progress unavailable</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function RosterRow({
  api,
  onOpenGrades,
  onOpenModules,
  row,
  refresh,
  schedule,
}: {
  api: AuthedRequest
  onOpenGrades: (row: RosterRowData) => void
  onOpenModules: (row: RosterRowData) => void
  row: RosterRowData
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const { enrollment } = row

  async function toggleEnrollment() {
    setSaving(true)
    setMessage('')

    try {
      await api(`/subjects/schedule-students/${enrollment.id}/`, {
        body: JSON.stringify({ is_active: !enrollment.is_active }),
        method: 'PATCH',
      })
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function removeEnrollment() {
    setRemoving(true)
    setShowRemoveConfirm(false)
    setMessage('')

    try {
      await api(`/subjects/schedule-students/${enrollment.id}/`, {
        method: 'DELETE',
      })
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
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
          <RosterRowMenu
            busy={saving || removing}
            enrollment={enrollment}
            onOpenModules={() => onOpenModules(row)}
            onRemove={() => setShowRemoveConfirm(true)}
            onToggle={() => void toggleEnrollment()}
            studentName={row.studentName}
          />
        </div>
        {message ? <span className="roster-row-error" role="alert">{message}</span> : null}
      </td>
    </tr>
    {showRemoveConfirm ? createPortal(
      <ConfirmDialog
        confirmLabel="Remove from active roster"
        description={`Deactivate ${row.studentName} in ${schedule.subject_code} ${schedule.section || ''}? Existing grades and attendance will be preserved.`}
        onCancel={() => setShowRemoveConfirm(false)}
        onConfirm={() => void removeEnrollment()}
        title="Remove this student?"
      />,
      document.body,
    ) : null}
    </>
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
  const finalGrade = findFinalGrade(data, schedule.id, row.enrollment.student)
  const categories = data.gradeCategories.filter(
    (category) => category.subject === schedule.subject,
  )
  const categoryGrades = data.categoryGrades.filter(
    (grade) =>
      grade.subject === schedule.subject &&
      grade.schedule === schedule.id &&
      grade.student === row.enrollment.student,
  )
  const itemScores = data.gradeItemScores.filter(
    (score) =>
      score.subject === schedule.subject &&
      score.schedule === schedule.id &&
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
                            .filter((item) => item.grade_category === category.id && item.schedule === schedule.id)
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
    raw_score: string | null
    total_score: string | null
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
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [students, setStudents] = useState<User[]>([])
  const [studentCount, setStudentCount] = useState(0)
  const [nextStudentOffset, setNextStudentOffset] = useState<number | null>(0)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentError, setStudentError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasMoreStudents = nextStudentOffset !== null

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    searchInputRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href]',
      ) ?? [],
    )
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
      const result = await api<{
        added_count: number
        reactivated_count: number
        already_active_count: number
      }>(`/subjects/subject-schedules/${schedule.id}/enroll-students/`, {
        body: JSON.stringify({ student_ids: selectedIds }),
        method: 'POST',
      })
      setMessage(
        `${result.added_count} added, ${result.reactivated_count} reactivated, ${result.already_active_count} already active.`,
      )
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
      const result = await api<ImportPreview>(
        `/subjects/subject-schedules/${schedule.id}/import-roster/`,
        {
          body: JSON.stringify({
            rows: importRows.map((row) => ({ student_number: row.studentNumber })),
          }),
          method: 'POST',
        },
      )

      setImportRows([])
      setImportPreview(null)
      setMessage(
        `${result.added_count ?? 0} added, ${result.reactivated_count ?? 0} reactivated, ${result.already_active_count ?? 0} already active.`,
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
      const preview = await api<ImportPreview>(
        `/subjects/subject-schedules/${schedule.id}/import-roster/`,
        {
          body: JSON.stringify({
            dry_run: true,
            rows: rows.map((row) => ({ student_number: row.studentNumber })),
          }),
          method: 'POST',
        },
      )
      setImportRows(rows)
      setImportPreview(preview)
      setMessage(
        preview.valid
          ? `${preview.ready_count} student${preview.ready_count === 1 ? '' : 's'} ready to import.`
          : 'Fix the roster file errors before importing.',
      )
    } catch (caughtError) {
      setImportRows([])
      setImportPreview(null)
      setMessage(toErrorMessage(caughtError))
    }
  }

  return (
    <div
      aria-labelledby="add-students-title"
      aria-modal="true"
      className="attendance-modal"
      onKeyDown={handleDialogKeyDown}
      role="dialog"
    >
      <button
        aria-label="Close add students dialog"
        className="attendance-modal__backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="attendance-modal__panel attendance-modal__panel--wide" ref={dialogRef}>
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
            ref={searchInputRef}
            type="search"
            value={query}
          />
        </label>

        <div className="class-import-panel">
          <div>
            <strong>Import roster</strong>
            <span>
              Existing accounts are matched by student_number. Other CSV columns are ignored.
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
              disabled={saving || !importPreview?.valid}
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

        {importPreview ? (
          <div className="class-import-preview" aria-label="Roster import preview">
            <strong>
              {importPreview.ready_count} of {importPreview.row_count} rows ready
            </strong>
            {importPreview.rows.some((row) => row.status === 'error') ? (
              <ul>
                {importPreview.rows.filter((row) => row.status === 'error').map((row) => (
                  <li key={`${row.row}-${row.student_number ?? 'missing'}`}>
                    Row {row.row}{row.student_number ? ` (${row.student_number})` : ''}: {row.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

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

        {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}

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

function scheduleDraft(schedule: SubjectSchedule | null, defaultTermId: number | null) {
  return {
    days: schedule ? normalizeClassDays(schedule.days) : '',
    end_time: schedule?.end_time ?? '',
    is_active: schedule?.is_active ?? true,
    room: schedule?.room ?? '',
    school_year_semester: schedule?.school_year_semester
      ? String(schedule.school_year_semester)
      : defaultTermId?.toString() ?? '',
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
    formatClassDays(schedule.days),
    `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`,
  ]
    .filter(Boolean)
    .join(' ')
}

function RosterRowMenu({
  busy,
  enrollment,
  onOpenModules,
  onRemove,
  onToggle,
  studentName,
}: {
  busy: boolean
  enrollment: ScheduleStudent
  onOpenModules: () => void
  onRemove: () => void
  onToggle: () => void
  studentName: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function closeAndRun(action: () => void) {
    setOpen(false)
    action()
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home') items[0].focus()
    else if (event.key === 'End') items[items.length - 1].focus()
    else if (event.key === 'ArrowDown') items[(currentIndex + 1) % items.length].focus()
    else items[(currentIndex - 1 + items.length) % items.length].focus()
  }

  return (
    <div className="roster-actions-menu roster-row-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`More actions for ${studentName}`}
        className="button button--secondary button--compact"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        ref={buttonRef}
        type="button"
      >
        <Icon name="more" />
        <span>More</span>
      </button>
      {open ? (
        <div className="roster-actions-menu__popover roster-row-menu__popover" onKeyDown={handleMenuKeyDown} ref={menuRef} role="menu">
          <Link onClick={() => setOpen(false)} role="menuitem" to={gradebookUrl(enrollment.schedule, enrollment.student)}>
            <Icon name="edit" />
            <span>Record score</span>
          </Link>
          <button onClick={() => closeAndRun(onOpenModules)} role="menuitem" type="button">
            <Icon name="module" />
            <span>Modules</span>
          </button>
          <button onClick={() => closeAndRun(onToggle)} role="menuitem" type="button">
            <Icon name={enrollment.is_active ? 'close' : 'check'} />
            <span>{enrollment.is_active ? 'Deactivate' : 'Activate'}</span>
          </button>
          <button className="roster-menu-danger" onClick={() => closeAndRun(onRemove)} role="menuitem" type="button">
            <Icon name="trash" />
            <span>Remove from roster</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function parseClassDays(value: string) {
  const normalized = value.trim().toUpperCase()
  const selected = new Set<string>()
  if (!normalized) return selected

  if (/[\s,;/|-]/.test(normalized)) {
    normalized.split(/[\s,;/|-]+/).filter(Boolean).forEach((token) => {
      const match = weekdayAlias(token)
      if (match) selected.add(match)
    })
    return selected
  }

  let index = 0
  while (index < normalized.length) {
    const pair = normalized.slice(index, index + 2)
    if (weekdays.some((day) => day.code === pair)) {
      selected.add(pair)
      index += 2
      continue
    }
    const match = weekdayAlias(normalized[index])
    if (match) selected.add(match)
    index += 1
  }
  return selected
}

function weekdayAlias(value: string) {
  const aliases: Record<string, string> = {
    F: 'FR', FR: 'FR', FRI: 'FR', FRIDAY: 'FR',
    M: 'MO', MO: 'MO', MON: 'MO', MONDAY: 'MO',
    R: 'TH', TH: 'TH', THU: 'TH', THURSDAY: 'TH',
    S: 'SA', SA: 'SA', SAT: 'SA', SATURDAY: 'SA',
    SU: 'SU', SUN: 'SU', SUNDAY: 'SU',
    T: 'TU', TU: 'TU', TUE: 'TU', TUESDAY: 'TU',
    W: 'WE', WE: 'WE', WED: 'WE', WEDNESDAY: 'WE',
  }
  return aliases[value] ?? null
}

function normalizeClassDays(value: string) {
  const selected = parseClassDays(value)
  return weekdays.filter((day) => selected.has(day.code)).map((day) => day.code).join(',')
}

function toggleClassDay(value: string, code: string) {
  const selected = parseClassDays(value)
  if (selected.has(code)) selected.delete(code)
  else selected.add(code)
  return weekdays.filter((day) => selected.has(day.code)).map((day) => day.code).join(',')
}

function formatClassDays(value: string) {
  const selected = parseClassDays(value)
  return weekdays.filter((day) => selected.has(day.code)).map((day) => day.short).join(' / ')
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
    grades: getPrimaryGradeSummary(data, enrollment.schedule, enrollment.student),
    studentName: enrollment.student_name || fullName(user ?? null),
    studentNumber: enrollment.student_number || profile?.student_number || 'None',
  }
}

function getPrimaryGradeSummary(
  data: WorkspaceData,
  scheduleId: number,
  studentId: number,
): PrimaryGradeSummary {
  const finalGrade = findFinalGrade(data, scheduleId, studentId)

  return {
    finalPeriod: gradeValue(
      finalGrade?.final_period_grade ?? findPeriodGrade(data, scheduleId, studentId, 'FINAL'),
    ),
    midterm: gradeValue(
      finalGrade?.midterm_grade ?? findPeriodGrade(data, scheduleId, studentId, 'MIDTERM'),
    ),
    overall: gradeValue(finalGrade?.final_grade ?? null),
    prefinal: gradeValue(
      finalGrade?.prefinal_grade ?? findPeriodGrade(data, scheduleId, studentId, 'PREFINAL'),
    ),
    prelim: gradeValue(
      finalGrade?.prelim_grade ?? findPeriodGrade(data, scheduleId, studentId, 'PRELIM'),
    ),
    remarks: finalGrade?.remarks || '',
  }
}

function findFinalGrade(data: WorkspaceData, scheduleId: number, studentId: number) {
  return data.finalGrades.find(
    (grade) => grade.schedule === scheduleId && grade.student === studentId,
  )
}

function findPeriodGrade(
  data: WorkspaceData,
  scheduleId: number,
  studentId: number,
  period: (typeof gradingPeriods)[number],
) {
  return data.periodGrades.find(
    (grade) =>
      grade.schedule === scheduleId &&
      grade.student === studentId &&
      grade.grading_period === period,
  )?.raw_score ?? null
}

function gradeValue(value: string | null) {
  return value ? formatGradeValue(value) : '-'
}

function formatGradeValue(value: string | number | null) {
  if (value === null) return '-'
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

function filterRosterRows(
  rows: RosterRowData[],
  query: string,
  status: 'active' | 'inactive' | 'all',
) {
  const normalizedQuery = query.trim().toLowerCase()
  const statusRows = status === 'all'
    ? rows
    : rows.filter((row) =>
        status === 'active' ? row.enrollment.is_active : !row.enrollment.is_active,
      )

  if (!normalizedQuery) {
    return statusRows
  }

  return statusRows.filter((row) =>
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
  const safeValue = /^\s*[=+\-@]/.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }

  return safeValue
}

function apiRosterRow(enrollment: RosterApiItem): RosterRowData {
  const summary = enrollment.grade_summary
  return {
    email: enrollment.email || 'None',
    enrollment,
    grades: {
      finalPeriod: apiGradeValue(summary.final),
      midterm: apiGradeValue(summary.midterm),
      overall: apiGradeValue(summary.overall),
      prefinal: apiGradeValue(summary.prefinal),
      prelim: apiGradeValue(summary.prelim),
      remarks: typeof summary.remarks === 'string' ? summary.remarks : '',
    },
    studentName: enrollment.student_name,
    studentNumber: enrollment.student_number || 'None',
  }
}

function apiGradeValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? '-' : formatGradeValue(value)
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

function modulesForSubject(modules: Module[], subjectId: number) {
  return modules
    .filter(
      (module) =>
        module.is_published &&
        (module.subject === subjectId || module.subjects.includes(subjectId)),
    )
    .sort((first, second) => first.title.localeCompare(second.title))
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

  return parsedRows
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
