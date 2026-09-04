import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthedRequest, RouteData } from '../../app/types'
import { ApiError } from '../../api'
import { Icon } from '../../components/Icon'
import { SubjectCreateDialog, TermManagementDialog } from '../../components/admin/AcademicSetupDialogs'
import { ClassAttendanceDialog } from '../../components/admin/ClassAttendanceDialog'
import { ClassScoresDialog } from '../../components/admin/ClassScoresDialog'
import { ManageStudentModulesDialog } from '../../components/admin/ManageStudentModulesDialog'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  ApiPage,
  GradeCategory,
  GradeItem,
  Module,
  ScheduleStudent,
  SchoolYearSemester,
  StudentGradeItemScore,
  StudentProfile,
  SubjectSchedule,
  User,
  AttendanceRecord,
  AttendanceSession,
  StudentCategoryGrade,
  PeriodGrade,
  FinalGrade,
} from '../../types'
import { toOptions } from '../../admin/adminHelpers'
import { formatTime, numeric, toErrorMessage } from '../../utils/format'
import { cleanImportedPersonName } from '../../utils/importCleaning'
import { modulesForSubject as allModulesForSubject } from '../../utils/modules'
import { fullName } from '../../utils/student'
import {
  compatibilityEncodingNotice,
  countReplacementCharacters,
  decodeTextFile,
  replacementCharacterWarning,
} from '../../utils/textFile'

const AVAILABLE_STUDENT_LIMIT = 8
const CLASS_PAGE_SIZE = 10
const ROSTER_PAGE_SIZE = 10
const ROSTER_EXPORT_PAGE_SIZE = 100
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
  firstName: string
  lastName: string
  middleName: string
  studentNumber: string
}

type ImportPreview = {
  valid: boolean
  row_count: number
  ready_count: number
  rows: Array<{
    row: number
    student_number?: string
    student_name?: string
    status: 'create' | 'enroll' | 'reactivate' | 'already_enrolled' | 'error'
    error?: string
  }>
  create_count?: number
  enroll_count?: number
  reactivate_count?: number
  added_count?: number
  reactivated_count?: number
  already_active_count?: number
  created_count?: number
  credentials?: Array<{ student_number: string; temporary_password: string }>
}

type AvailableStudent = {
  id: number
  display_name: string
  student_number: string
  enrollment_status: 'not_enrolled' | 'inactive'
}

type StudentPickerTab = 'choose' | 'create' | 'import'

type ExistingRosterStudent = Omit<AvailableStudent, 'enrollment_status'> & {
  enrollment_status: 'active' | 'inactive' | 'not_enrolled' | 'unavailable'
}

type CreatedRosterStudent = {
  student: Omit<ExistingRosterStudent, 'enrollment_status'> & { enrollment_status: 'active' }
  enrollment: ScheduleStudent
  credentials: {
    username: string
    temporary_password: string
    must_change_password: true
  }
}

type CreateStudentConflict = {
  code: 'student_exists' | 'student_unavailable'
  detail: string
  student?: ExistingRosterStudent
}

type CreateStudentField = 'email' | 'first_name' | 'last_name' | 'student_number'
type CreateStudentErrors = Partial<Record<CreateStudentField, string>>

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

type ClassWorkspace = {
  users: User[]
  profiles: StudentProfile[]
  enrollments: ScheduleStudent[]
  attendance_sessions: AttendanceSession[]
  attendance_records: AttendanceRecord[]
  grade_categories: GradeCategory[]
  grade_items: GradeItem[]
  grade_item_scores: StudentGradeItemScore[]
  category_grades: StudentCategoryGrade[]
  period_grades: PeriodGrade[]
  final_grades: FinalGrade[]
}

function mergeClassWorkspace(data: RouteData, workspace?: ClassWorkspace): RouteData {
  if (!workspace) return data
  return {
    ...data,
    users: workspace.users,
    profiles: workspace.profiles,
    enrollments: workspace.enrollments,
    attendanceSessions: workspace.attendance_sessions,
    attendanceRecords: workspace.attendance_records,
    gradeCategories: workspace.grade_categories,
    gradeItems: workspace.grade_items,
    gradeItemScores: workspace.grade_item_scores,
    categoryGrades: workspace.category_grades,
    periodGrades: workspace.period_grades,
    finalGrades: workspace.final_grades,
  }
}

export function AdminClassesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const pendingScheduleIdRef = useRef<number | null>(null)
  const activeTerm = getActiveTerm(data.terms)
  const [selectedTermId, setSelectedTermId] = useState(
    searchParams.get('term') ?? activeTerm?.id.toString() ?? '',
  )
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [scheduleMessage, setScheduleMessage] = useState('')
  const requestedScheduleId = Number(searchParams.get('schedule'))
  const requestedScheduleQuery = useQuery({
    queryKey: ['class-schedule', requestedScheduleId],
    queryFn: ({ signal }) => api<SubjectSchedule>(
      `/subjects/subject-schedules/${requestedScheduleId}/`, { signal },
    ),
    enabled: Boolean(requestedScheduleId),
    staleTime: 60_000,
  })
  const requestedWorkspaceSchedule = requestedScheduleQuery.data ?? null
  const queryTermId = requestedWorkspaceSchedule
    ? String(requestedWorkspaceSchedule.school_year_semester)
    : selectedTermId
  const queryClient = useQueryClient()
  const scheduleListQuery = useInfiniteQuery({
    initialPageParam: 0,
    queryKey: ['classes', queryTermId, query],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        limit: String(CLASS_PAGE_SIZE),
        offset: String(pageParam),
        status: 'all',
      })
      if (queryTermId) params.set('term', queryTermId)
      if (query.trim()) params.set('search', query.trim())
      return api<ApiPage<SubjectSchedule>>(
        `/subjects/subject-schedules/?${params.toString()}`,
        { signal },
      )
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
    retry: false,
  })
  const routeSchedules = scheduleListQuery.data
    ? uniqueSchedules(scheduleListQuery.data.pages.flatMap((page) => page.results))
    : []
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
  const selectedScheduleMatchesFilters = selectedSchedule
    ? filterSchedules([selectedSchedule], query, effectiveTermId).length > 0
    : false
  const finderSchedules = selectedScheduleMatchesFilters
    ? uniqueSchedules([selectedSchedule!, ...visibleSchedules])
    : visibleSchedules
  const classCount = scheduleListQuery.data?.pages[0]?.count
    ?? 0
  const termOptions = toOptions(data.terms, (term) => term.id, (term) => term.name)

  const refreshClasses = useCallback(async () => {
    await refresh()
    await queryClient.invalidateQueries({ queryKey: ['classes'] })
  }, [queryClient, refresh])

  const selectSchedule = useCallback((value: number | null) => {
    pendingScheduleIdRef.current = value
    setScheduleMessage('')
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
    if (requestedScheduleId && requestedScheduleQuery.isPending) return
    if (requestedScheduleId && pendingScheduleIdRef.current === requestedScheduleId) return
    if (searchParams.has('schedule') && !selectedSchedule) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('schedule')
        return next
      }, { replace: true })
    }
  }, [
    data.loading,
    requestedScheduleId,
    requestedScheduleQuery.isPending,
    searchParams,
    selectedSchedule,
    setSearchParams,
  ])

  return (
    <Page>
      <PageHeader
        eyebrow="Academic structure"
        title="Classes"
        description="Select a class, edit its schedule, and manage its roster."
      />

      <section className="classes-setup__grid">
        <div className="classes-setup__panel classes-setup__panel--finder section-block">
          <SectionHeading
            subtitle={`${classCount} class${classCount === 1 ? '' : 'es'}`}
            title="Select Class"
          />
          <ClassFinder
            classCount={classCount}
            errorMessage={scheduleListQuery.isError ? toErrorMessage(scheduleListQuery.error) : ''}
            hasNextPage={scheduleListQuery.hasNextPage}
            isFetchingNextPage={scheduleListQuery.isFetchingNextPage}
            isNextPageError={scheduleListQuery.isFetchNextPageError}
            isPending={scheduleListQuery.isPending}
            loadNextPage={() => void scheduleListQuery.fetchNextPage()}
            query={query}
            retry={() => {
              if (scheduleListQuery.isFetchNextPageError) {
                void scheduleListQuery.fetchNextPage()
              } else {
                void scheduleListQuery.refetch()
              }
            }}
            schedules={finderSchedules}
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
            message={scheduleMessage}
            refresh={refreshClasses}
            selectedSchedule={selectedSchedule}
            setMessage={setScheduleMessage}
            setSelectedScheduleId={selectSchedule}
          />
        </div>
      </section>

      <ClassRoster
        api={api}
        data={data}
        key={selectedSchedule?.id ?? 'no-class'}
        selectedSchedule={selectedSchedule}
      />
    </Page>
  )
}

function ClassFinder({
  classCount,
  errorMessage,
  hasNextPage,
  isFetchingNextPage,
  isNextPageError,
  isPending,
  loadNextPage,
  query,
  retry,
  schedules,
  selectedSchedule,
  selectedTermId,
  setQuery,
  setSelectedScheduleId,
  setSelectedTermId,
  termOptions,
}: {
  classCount: number
  errorMessage: string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isNextPageError: boolean
  isPending: boolean
  loadNextPage: () => void
  query: string
  retry: () => void
  schedules: SubjectSchedule[]
  selectedSchedule: SubjectSchedule | null
  selectedTermId: string
  setQuery: (value: string) => void
  setSelectedScheduleId: (value: number) => void
  setSelectedTermId: (value: string) => void
  termOptions: { label: string; value: number | string }[]
}) {
  const classListRef = useRef<HTMLDivElement>(null)
  const classLoadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = classListRef.current
    const target = classLoadMoreRef.current
    if (!root || !target || !hasNextPage || isNextPageError) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        loadNextPage()
      }
    }, { root, rootMargin: '0px 0px 160px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isNextPageError, loadNextPage])

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

      <div
        className="class-list"
        ref={classListRef}
        onScroll={(event) => {
          const target = event.currentTarget
          if (
            target.scrollTop + target.clientHeight >= target.scrollHeight - 160
            && hasNextPage
            && !isFetchingNextPage
            && !isNextPageError
          ) {
            loadNextPage()
          }
        }}
      >
        {errorMessage && !isNextPageError ? (
          <div className="class-list__feedback" role="alert">
            <span>{errorMessage}</span>
            <button
              className="button button--secondary button--compact"
              onClick={retry}
              type="button"
            >
              Retry classes
            </button>
          </div>
        ) : null}
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
        {isPending && !schedules.length ? (
          <p className="admin-empty-line">Loading classes...</p>
        ) : null}
        {!isPending && !errorMessage && !schedules.length ? (
          <p className="admin-empty-line">No classes found.</p>
        ) : null}
        {schedules.length ? (
          <div className="class-list__pagination" ref={classLoadMoreRef}>
            <span aria-live="polite">
              Showing {schedules.length} of {classCount} class{classCount === 1 ? '' : 'es'}
            </span>
            {hasNextPage && !isNextPageError ? (
              <button
                className="button button--secondary button--compact"
                disabled={isFetchingNextPage}
                onClick={loadNextPage}
                type="button"
              >
                {isFetchingNextPage ? 'Loading more...' : 'Load more'}
              </button>
            ) : null}
            {isNextPageError ? (
              <button
                className="button button--secondary button--compact"
                onClick={retry}
                type="button"
              >
                Retry loading more
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ScheduleForm({
  api,
  data,
  defaultTermId,
  message,
  refresh,
  selectedSchedule,
  setMessage,
  setSelectedScheduleId,
}: {
  api: AuthedRequest
  data: RouteData
  defaultTermId: number | null
  message: string
  refresh: () => Promise<void>
  selectedSchedule: SubjectSchedule | null
  setMessage: (value: string) => void
  setSelectedScheduleId: (value: number | null) => void
}) {
  const [initialDraft, setInitialDraft] = useState(() =>
    scheduleDraft(selectedSchedule, defaultTermId),
  )
  const [draft, setDraft] = useState(() => scheduleDraft(selectedSchedule, defaultTermId))
  const [changingStatus, setChangingStatus] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showSubjectDialog, setShowSubjectDialog] = useState(false)
  const [showTermDialog, setShowTermDialog] = useState(false)
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
            className="button button--secondary"
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

      <div className="admin-field">
        <label htmlFor="schedule-subject">Subject</label>
        <div className="class-setup-select">
          <select
            id="schedule-subject"
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
          <button
            aria-label="Create subject"
            className="button button--secondary class-setup-select__add"
            disabled={changingStatus || saving}
            onClick={() => setShowSubjectDialog(true)}
            title="Create subject"
            type="button"
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div className="admin-field">
        <label htmlFor="schedule-term">Term</label>
        <div className="class-setup-select">
          <select
            id="schedule-term"
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
          <button
            aria-label="Manage terms"
            className="button button--secondary class-setup-select__add"
            disabled={changingStatus || saving}
            onClick={() => setShowTermDialog(true)}
            title="Manage terms"
            type="button"
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>

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
    {showSubjectDialog ? (
      <SubjectCreateDialog
        api={api}
        refresh={refresh}
        onClose={() => setShowSubjectDialog(false)}
        onCreated={(subjectId) => {
          setDraft((current) => ({ ...current, subject: String(subjectId) }))
          setMessage('Subject created and selected.')
        }}
      />
    ) : null}
    {showTermDialog ? (
      <TermManagementDialog
        api={api}
        refresh={refresh}
        schoolYears={data.schoolYears}
        terms={data.terms}
        onClose={() => setShowTermDialog(false)}
        onSelectTerm={(termId) => {
          setDraft((current) => ({ ...current, school_year_semester: String(termId) }))
          setMessage('Term selected for this schedule.')
        }}
      />
    ) : null}
    </>
  )
}

function ClassRoster({
  api,
  data,
  selectedSchedule,
}: {
  api: AuthedRequest
  data: RouteData
  selectedSchedule: SubjectSchedule | null
}) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(
    searchParams.get('action') === 'attendance',
  )
  const [isScoresOpen, setIsScoresOpen] = useState(false)
  const scoresButtonRef = useRef<HTMLButtonElement>(null)
  const rosterLoadMoreRef = useRef<HTMLDivElement>(null)
  const [rosterQuery, setRosterQuery] = useState('')
  const [rosterStatus, setRosterStatus] = useState<'active' | 'inactive'>('active')
  const [rosterMessage, setRosterMessage] = useState('')
  const [exportingRoster, setExportingRoster] = useState(false)
  const [gradeRow, setGradeRow] = useState<RosterRowData | null>(null)
  const [moduleRow, setModuleRow] = useState<RosterRowData | null>(null)
  const attendanceWorkspaceQuery = useQuery({
    queryKey: ['class-workspace', selectedSchedule?.id, 'attendance'],
    queryFn: ({ signal }) => api<ClassWorkspace>(
      `/subjects/subject-schedules/${selectedSchedule!.id}/workspace/?section=attendance`, { signal },
    ),
    enabled: Boolean(selectedSchedule && isAttendanceOpen),
    staleTime: 30_000,
  })
  const scoreWorkspaceQuery = useQuery({
    queryKey: ['class-workspace', selectedSchedule?.id, 'scores'],
    queryFn: ({ signal }) => api<ClassWorkspace>(
      `/subjects/subject-schedules/${selectedSchedule!.id}/workspace/?section=scores`, { signal },
    ),
    enabled: Boolean(selectedSchedule && isScoresOpen),
    staleTime: 30_000,
  })
  const gradeWorkspaceQuery = useQuery({
    queryKey: ['class-workspace', selectedSchedule?.id, 'grades'],
    queryFn: ({ signal }) => api<ClassWorkspace>(
      `/subjects/subject-schedules/${selectedSchedule!.id}/workspace/?section=grades`, { signal },
    ),
    enabled: Boolean(selectedSchedule && gradeRow),
    staleTime: 30_000,
  })
  const attendanceData = mergeClassWorkspace(data, attendanceWorkspaceQuery.data)
  const scoreData = mergeClassWorkspace(data, scoreWorkspaceQuery.data)
  const gradeData = mergeClassWorkspace(data, gradeWorkspaceQuery.data)
  const localRoster: ScheduleStudent[] = []
  const normalizedRosterQuery = rosterQuery.trim()
  const localRosterRows = localRoster.map((enrollment) => getRosterRow(enrollment, data))
  const localFilteredRows = filterRosterRows(localRosterRows, normalizedRosterQuery, rosterStatus)
  const rosterPageQuery = useInfiniteQuery({
    enabled: Boolean(selectedSchedule),
    initialPageParam: 0,
    queryKey: ['class-roster', selectedSchedule?.id, normalizedRosterQuery, rosterStatus],
    queryFn: ({ pageParam, signal }) => api<RosterApiPage>(
      buildRosterPath(
        selectedSchedule!.id,
        rosterStatus,
        normalizedRosterQuery,
        ROSTER_PAGE_SIZE,
        pageParam,
      ),
      { signal },
    ),
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  })
  const {
    fetchNextPage: fetchNextRosterPage,
    hasNextPage: hasNextRosterPage,
    isFetchingNextPage: isFetchingNextRosterPage,
    isFetchNextPageError: isNextRosterPageError,
  } = rosterPageQuery
  const firstRosterPage = rosterPageQuery.data?.pages[0]
  const visibleRows = rosterPageQuery.data
    ? rosterPageQuery.data.pages.flatMap((page) => page.results.map(apiRosterRow))
    : localFilteredRows.slice(0, ROSTER_PAGE_SIZE)
  const filteredCount = firstRosterPage?.count ?? localFilteredRows.length
  const activeCount = firstRosterPage?.active_count
    ?? localRoster.filter((enrollment) => enrollment.is_active).length
  const inactiveCount = firstRosterPage?.inactive_count
    ?? localRoster.length - activeCount
  const totalCount = firstRosterPage?.total_count ?? localRoster.length

  const refreshClassRoster = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['class-roster', selectedSchedule?.id] }),
      queryClient.invalidateQueries({ queryKey: ['class-workspace', selectedSchedule?.id] }),
    ])
  }, [queryClient, selectedSchedule?.id])

  const refreshAttendanceWorkspace = useCallback(async () => {
    await queryClient.invalidateQueries({
      exact: true,
      queryKey: ['class-workspace', selectedSchedule?.id, 'attendance'],
    })
  }, [queryClient, selectedSchedule?.id])

  useEffect(() => {
    const target = rosterLoadMoreRef.current
    if (!target || !hasNextRosterPage || isNextRosterPageError) return

    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting
        && hasNextRosterPage
        && !isFetchingNextRosterPage
      ) {
        void fetchNextRosterPage()
      }
    }, { rootMargin: '0px 0px 160px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [
    fetchNextRosterPage,
    hasNextRosterPage,
    isFetchingNextRosterPage,
    isNextRosterPageError,
  ])

  async function exportFilteredRoster() {
    if (!selectedSchedule || exportingRoster) return

    setExportingRoster(true)
    setRosterMessage('Preparing the complete filtered roster CSV...')
    try {
      const rows = await fetchCompleteRoster(
        api,
        selectedSchedule.id,
        rosterStatus,
        normalizedRosterQuery,
      )
      exportRosterCsv(selectedSchedule, rows)
      setRosterMessage(`Exported ${rows.length} student${rows.length === 1 ? '' : 's'}.`)
    } catch (caughtError) {
      setRosterMessage(`Roster export failed: ${toErrorMessage(caughtError)}`)
    } finally {
      setExportingRoster(false)
    }
  }

  const classModules = selectedSchedule
    ? modulesForSubject(data.modules, selectedSchedule.subject)
    : []
  const selectedClassModule = selectedSchedule
    ? allModulesForSubject(data.modules, selectedSchedule.subject)[0] ?? null
    : null
  const classModuleUrl = selectedSchedule && selectedClassModule
    ? `/admin/modules?subject=${selectedSchedule.subject}`
    : null
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
            {classModuleUrl ? (
              <Link className="button button--secondary" to={classModuleUrl}>
                <Icon name="module" />
                <span>Open Module</span>
              </Link>
            ) : (
              <button
                aria-label={
                  selectedSchedule
                    ? 'Open Module unavailable: no module is linked to this subject'
                    : 'Open Module unavailable: select a class first'
                }
                className="button button--secondary"
                disabled
                title={
                  selectedSchedule
                    ? 'No module is linked to this subject.'
                    : 'Select a class to open its module.'
                }
                type="button"
              >
                <Icon name="module" />
                <span>Open Module</span>
              </button>
            )}
            <button
              className="button button--secondary"
              disabled={!selectedSchedule?.is_active || !activeCount}
              onClick={() => setIsScoresOpen(true)}
              ref={scoresButtonRef}
              type="button"
            >
              <Icon name="grade" />
              <span>Scores</span>
            </button>
            <button
              className="button button--secondary"
              disabled={!selectedSchedule?.is_active}
              onClick={() => setIsAdding(true)}
              type="button"
            >
              <Icon name="plus" />
              <span>Add students</span>
            </button>
            <RosterActionsMenu
              attendanceReportsTo={selectedSchedule ? `/admin/attendance?schedule=${selectedSchedule.id}` : null}
              exportDisabled={!selectedSchedule || !filteredCount || exportingRoster}
              gradebookTo={selectedSchedule ? gradebookUrl(selectedSchedule.id) : null}
              moduleProgressTo={moduleProgressUrl}
              onExport={() => void exportFilteredRoster()}
            />
          </div>
        }
        subtitle={rosterSubtitle}
        title="Roster"
      />

      {selectedSchedule ? (
        <div className="class-roster-tools">
          <div aria-label="Filter roster by status" className="class-roster-summary" role="group">
            <button
              aria-pressed={rosterStatus === 'active'}
              className={`class-roster-summary__item class-roster-summary__item--active${rosterStatus === 'active' ? ' is-selected' : ''}`}
              onClick={() => setRosterStatus('active')}
              type="button"
            >
              <Icon name="check" />
              <strong>{activeCount}</strong>
              <small>Active</small>
            </button>
            <button
              aria-pressed={rosterStatus === 'inactive'}
              className={`class-roster-summary__item class-roster-summary__item--inactive${rosterStatus === 'inactive' ? ' is-selected' : ''}`}
              onClick={() => setRosterStatus('inactive')}
              type="button"
            >
              <Icon name="minus" />
              <strong>{inactiveCount}</strong>
              <small>Inactive</small>
            </button>
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

      {rosterMessage ? <p aria-live="polite" className="admin-message">{rosterMessage}</p> : null}
      {rosterPageQuery.isError && !rosterPageQuery.data ? (
        <div className="class-roster-feedback" role="alert">
          <span>{toErrorMessage(rosterPageQuery.error)}</span>
          <button
            className="button button--secondary button--compact"
            onClick={() => void rosterPageQuery.refetch()}
            type="button"
          >
            Retry roster
          </button>
        </div>
      ) : null}

      <div
        className="table-wrap class-roster-scroll"
        onScroll={(event) => {
          const target = event.currentTarget
          if (
            target.scrollTop + target.clientHeight >= target.scrollHeight - 160
            && hasNextRosterPage
            && !isFetchingNextRosterPage
            && !isNextRosterPageError
          ) {
            void fetchNextRosterPage()
          }
        }}
      >
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
            {selectedSchedule && rosterPageQuery.isPending && !visibleRows.length ? (
              <tr>
                <td colSpan={10}>Loading roster...</td>
              </tr>
            ) : null}
            {selectedSchedule && !rosterPageQuery.isPending && !totalCount ? (
              <tr>
                <td colSpan={10}>No active students in this class yet. Add students to build the roster.</td>
              </tr>
            ) : null}
            {selectedSchedule && !rosterPageQuery.isPending && totalCount && !visibleRows.length ? (
              <tr>
                <td colSpan={10}>
                  {rosterQuery.trim()
                    ? 'No roster matches found for this search.'
                    : rosterStatus === 'inactive'
                      ? 'No inactive students in this class.'
                      : 'No active students in this class yet. Add students to build the roster.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {selectedSchedule && visibleRows.length ? (
          <div className="class-roster-pagination" ref={rosterLoadMoreRef}>
            <span aria-live="polite">
              Showing {visibleRows.length} of {filteredCount} student{filteredCount === 1 ? '' : 's'}
            </span>
            {hasNextRosterPage && !isNextRosterPageError ? (
              <button
                className="button button--secondary button--compact"
                disabled={isFetchingNextRosterPage}
                onClick={() => void fetchNextRosterPage()}
                type="button"
              >
                {isFetchingNextRosterPage ? 'Loading more...' : 'Load more'}
              </button>
            ) : null}
            {isNextRosterPageError ? (
              <button
                className="button button--secondary button--compact"
                onClick={() => void fetchNextRosterPage()}
                type="button"
              >
                Retry loading more
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedSchedule && isAdding ? (
        <AddStudentsModal
          api={api}
          refresh={refreshClassRoster}
          schedule={selectedSchedule}
          onClose={() => setIsAdding(false)}
        />
      ) : null}

      {selectedSchedule && isAttendanceOpen && attendanceWorkspaceQuery.isPending ? (
        <p aria-live="polite" className="admin-message">Loading attendance workspace...</p>
      ) : null}
      {selectedSchedule && isAttendanceOpen && attendanceWorkspaceQuery.isError ? (
        <p className="admin-message" role="alert">{toErrorMessage(attendanceWorkspaceQuery.error)}</p>
      ) : null}
      {selectedSchedule && isAttendanceOpen && attendanceWorkspaceQuery.data ? (
        <ClassAttendanceDialog
          api={api}
          data={attendanceData}
          initialTab="take"
          key={selectedSchedule.id}
          refresh={refreshAttendanceWorkspace}
          schedule={selectedSchedule}
          onClose={() => setIsAttendanceOpen(false)}
        />
      ) : null}

      {selectedSchedule && isScoresOpen && scoreWorkspaceQuery.isPending ? (
        <p aria-live="polite" className="admin-message">Loading score workspace...</p>
      ) : null}
      {selectedSchedule && isScoresOpen && scoreWorkspaceQuery.isError ? (
        <p className="admin-message" role="alert">{toErrorMessage(scoreWorkspaceQuery.error)}</p>
      ) : null}
      {selectedSchedule && isScoresOpen && scoreWorkspaceQuery.data ? (
        <ClassScoresDialog
          api={api}
          data={scoreData}
          key={selectedSchedule.id}
          refresh={refreshClassRoster}
          schedule={selectedSchedule}
          onClose={() => {
            setIsScoresOpen(false)
            window.requestAnimationFrame(() => scoresButtonRef.current?.focus())
          }}
        />
      ) : null}

      {selectedSchedule && gradeRow && gradeWorkspaceQuery.isPending ? (
        <p aria-live="polite" className="admin-message">Loading grade details...</p>
      ) : null}
      {selectedSchedule && gradeRow && gradeWorkspaceQuery.isError ? (
        <p className="admin-message" role="alert">{toErrorMessage(gradeWorkspaceQuery.error)}</p>
      ) : null}
      {selectedSchedule && gradeRow && gradeWorkspaceQuery.data ? (
        <GradeDetailsModal
          data={gradeData}
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
  const nameReplacementCount = countReplacementCharacters(row.studentName)

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
        <span className="student-name-with-warning">
          <strong>{row.studentName}</strong>
          {nameReplacementCount ? (
            <small className="name-correction-warning" role="status">
              Name needs correction. <Link to="/admin/students">Edit the User Account in Student Management.</Link>
            </small>
          ) : null}
        </span>
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
  data: RouteData
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
                    <table className="admin-table grade-breakdown-table mobile-card-table">
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
        <td data-label="Category">
          <strong>{category.name}</strong>
          <span>{category.category} - {formatGradeValue(category.weight)}%</span>
        </td>
        <td data-label="Raw / Total">{grade ? `${formatGradeValue(grade.raw_score)} / ${formatGradeValue(grade.total_score)}` : '-'}</td>
        <td data-label="Transmuted">{gradeValue(grade?.transmuted_grade ?? null)}</td>
        <td data-label="Weighted / Remarks">{gradeValue(grade?.weighted_score ?? null)}</td>
      </tr>
    )
  }

  return (
    <>
      {itemRows.map(({ item, score }) => (
        <tr key={item.id}>
          <td data-label="Category">
            <strong>{item.source_title || item.title}</strong>
            <span>{sourceTypeLabel(item.source_type)} - {category.name}</span>
          </td>
          <td data-label="Raw / Total">{score ? `${formatGradeValue(score.raw_score)} / ${formatGradeValue(score.total_score)}` : '-'}</td>
          <td data-label="Transmuted">{gradeValue(score?.transmuted_grade ?? null)}</td>
          <td data-label="Weighted / Remarks">{score?.remarks || '-'}</td>
        </tr>
      ))}
      <tr className="grade-category-total-row">
        <td data-label="Category">
          <strong>{category.name} total</strong>
          <span>{category.category} - {formatGradeValue(category.weight)}%</span>
        </td>
        <td data-label="Raw / Total">{grade ? `${formatGradeValue(grade.raw_score)} / ${formatGradeValue(grade.total_score)}` : '-'}</td>
        <td data-label="Transmuted">{gradeValue(grade?.transmuted_grade ?? null)}</td>
        <td data-label="Weighted / Remarks">{gradeValue(grade?.weighted_score ?? null)}</td>
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
  onClose,
  refresh,
  schedule,
}: {
  api: AuthedRequest
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [activeTab, setActiveTab] = useState<StudentPickerTab>('choose')
  const [query, setQuery] = useState('')
  const [createStudentNumber, setCreateStudentNumber] = useState('')
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createdStudent, setCreatedStudent] = useState<CreatedRosterStudent | null>(null)
  const [existingStudent, setExistingStudent] = useState<ExistingRosterStudent | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [createErrors, setCreateErrors] = useState<CreateStudentErrors>({})
  const [importRows, setImportRows] = useState<StudentImportRow[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importEncodingNotice, setImportEncodingNotice] = useState('')
  const [importReplacementWarning, setImportReplacementWarning] = useState('')
  const [newCredentials, setNewCredentials] = useState<Array<{ student_number: string; temporary_password: string }>>([])
  const [selectedStudents, setSelectedStudents] = useState<AvailableStudent[]>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [students, setStudents] = useState<AvailableStudent[]>([])
  const [studentCount, setStudentCount] = useState(0)
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentError, setStudentError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const createStudentNumberRef = useRef<HTMLInputElement>(null)
  const createRequestRef = useRef(false)
  const selectedIds = selectedStudents.map((student) => student.id)
  const normalizedQuery = query.trim()
  const suggestions = students.filter(
    (student) => !selectedStudents.some((selected) => selected.id === student.id),
  )
  const showSuggestions = activeTab === 'choose' && normalizedQuery.length >= 2

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

  const loadAvailableStudents = useCallback(async function loadAvailableStudents(signal?: AbortSignal) {
    setLoadingStudents(true)
    setStudentError('')

    try {
      const page = await api<ApiPage<AvailableStudent>>(
        buildAvailableStudentsPath(schedule.id, query),
        { signal },
      )

      setStudents(page.results)
      setStudentCount(page.count)
      setActiveOptionIndex(page.results.length ? 0 : -1)
    } catch (caughtError) {
      if (!isAbortError(caughtError)) {
        setStudentError(toErrorMessage(caughtError))
      }
    } finally {
      setLoadingStudents(false)
    }
  }, [api, query, schedule.id])

  useEffect(() => {
    if (activeTab !== 'choose' || normalizedQuery.length < 2) {
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void loadAvailableStudents(controller.signal)
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [activeTab, loadAvailableStudents, normalizedQuery.length])

  function selectStudent(student: AvailableStudent) {
    setSelectedStudents((current) =>
      current.some((selected) => selected.id === student.id) ? current : [...current, student],
    )
    setQuery('')
    setStudents([])
    setStudentCount(0)
    setActiveOptionIndex(-1)
    searchInputRef.current?.focus()
  }

  function selectTab(tab: StudentPickerTab, focusTab = false) {
    setActiveTab(tab)
    if (focusTab) {
      window.setTimeout(() => document.getElementById(`${tab}-students-tab`)?.focus(), 0)
    } else if (tab === 'choose') {
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
    } else if (tab === 'create' && !createdStudent) {
      window.setTimeout(() => createStudentNumberRef.current?.focus(), 0)
    }
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: StudentPickerTab[] = ['choose', 'create', 'import']
    const currentIndex = tabs.indexOf(activeTab)
    let nextTab: StudentPickerTab
    if (event.key === 'Home') nextTab = tabs[0]
    else if (event.key === 'End') nextTab = tabs[tabs.length - 1]
    else if (event.key === 'ArrowLeft') nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
    else nextTab = tabs[(currentIndex + 1) % tabs.length]
    selectTab(nextTab, true)
  }

  function handleComboboxKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && showSuggestions) {
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      setStudents([])
      setActiveOptionIndex(-1)
      return
    }
    if (!suggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveOptionIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveOptionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeOptionIndex >= 0) {
      event.preventDefault()
      selectStudent(suggestions[activeOptionIndex])
    } else if (event.key === 'Tab') {
      setActiveOptionIndex(-1)
    }
  }

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
      setSelectedStudents([])
      setQuery('')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function createAndAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createRequestRef.current) return
    createRequestRef.current = true
    setSaving(true)
    setMessage('')
    setExistingStudent(null)
    setCopyMessage('')
    setCreateErrors({})

    try {
      const result = await api<CreatedRosterStudent>(
        `/subjects/subject-schedules/${schedule.id}/create-student/`,
        {
          body: JSON.stringify({
            student_number: createStudentNumber,
            first_name: createFirstName,
            last_name: createLastName,
            email: createEmail,
          }),
          method: 'POST',
        },
      )
      setCreatedStudent(result)
      await refresh()
    } catch (caughtError) {
      if (
        caughtError instanceof ApiError &&
        caughtError.status === 409 &&
        isCreateStudentConflict(caughtError.data)
      ) {
        setExistingStudent(caughtError.data.student ?? null)
        setMessage(caughtError.data.detail)
      } else if (caughtError instanceof ApiError && caughtError.status === 400) {
        const errors = createStudentFieldErrors(caughtError.data)
        setCreateErrors(errors)
        setMessage(Object.keys(errors).length ? 'Check the highlighted student details.' : caughtError.message)
      } else {
        setMessage(toErrorMessage(caughtError))
      }
    } finally {
      createRequestRef.current = false
      setSaving(false)
    }
  }

  function useExistingStudent() {
    if (!existingStudent || !['inactive', 'not_enrolled'].includes(existingStudent.enrollment_status)) return
    const availableStudent: AvailableStudent = {
      id: existingStudent.id,
      display_name: existingStudent.display_name,
      student_number: existingStudent.student_number,
      enrollment_status: existingStudent.enrollment_status as AvailableStudent['enrollment_status'],
    }
    setSelectedStudents((current) =>
      current.some((student) => student.id === availableStudent.id)
        ? current
        : [...current, availableStudent],
    )
    setExistingStudent(null)
    setMessage(`${availableStudent.display_name} is selected and ready to add.`)
    selectTab('choose')
  }

  function resetCreateStudent() {
    setCreateStudentNumber('')
    setCreateFirstName('')
    setCreateLastName('')
    setCreateEmail('')
    setCreatedStudent(null)
    setExistingStudent(null)
    setCopyMessage('')
    setCreateErrors({})
    setMessage('')
    window.setTimeout(() => createStudentNumberRef.current?.focus(), 0)
  }

  async function copyCreatedCredentials() {
    if (!createdStudent) return
    const copied = await copyTextToClipboard(
      `Username: ${createdStudent.credentials.username}\nTemporary password: ${createdStudent.credentials.temporary_password}`,
    )
    setCopyMessage(copied ? 'Credentials copied.' : 'Copy is unavailable. Select and copy the credentials below.')
  }

  async function importStudents() {
    if (!importRows.length || importReplacementWarning) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const result = await api<ImportPreview>(
        `/subjects/subject-schedules/${schedule.id}/import-roster/`,
        {
          body: JSON.stringify({
            rows: importRows.map(importRowPayload),
          }),
          method: 'POST',
        },
      )

      const credentials = result.credentials ?? []
      setNewCredentials(credentials)
      if (credentials.length) downloadNewStudentCredentials(credentials)
      setMessage(
        `${result.created_count ?? 0} accounts created, ${result.added_count ?? 0} enrolled, ${result.reactivated_count ?? 0} reactivated.`,
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

    setImportRows([])
    setImportPreview(null)
    setImportEncodingNotice('')
    setImportReplacementWarning('')
    setNewCredentials([])
    setMessage('')

    try {
      const decoded = await decodeTextFile(file)
      setImportEncodingNotice(
        decoded.usedCompatibilityFallback ? compatibilityEncodingNotice(file.name) : '',
      )
      const replacementCount = countReplacementCharacters(decoded.text)
      if (replacementCount) {
        setImportReplacementWarning(replacementCharacterWarning(replacementCount))
        return
      }

      const rows = parseStudentImport(decoded.text)
      const preview = await api<ImportPreview>(
        `/subjects/subject-schedules/${schedule.id}/import-roster/`,
        {
          body: JSON.stringify({
            dry_run: true,
            rows: rows.map(importRowPayload),
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
        disabled={saving}
        onClick={onClose}
        type="button"
      />
      <div className="attendance-modal__panel attendance-modal__panel--wide" ref={dialogRef}>
        <div className="attendance-modal__header">
          <div>
            <strong id="add-students-title">Add students</strong>
            <span>{schedule.subject_code} {schedule.section || ''}</span>
          </div>
          <button className="icon-button" disabled={saving} onClick={onClose} title="Close" type="button">
            <Icon name="close" />
          </button>
        </div>

        <div aria-label="Add students method" className="student-picker-tabs" role="tablist">
          <button
            aria-controls="choose-students-panel"
            aria-selected={activeTab === 'choose'}
            className={activeTab === 'choose' ? 'is-active' : ''}
            disabled={saving}
            id="choose-students-tab"
            onClick={() => selectTab('choose')}
            onKeyDown={handleTabKeyDown}
            role="tab"
            type="button"
          >
            <Icon name="users" />
            <span>Choose students</span>
          </button>
          <button
            aria-controls="create-students-panel"
            aria-selected={activeTab === 'create'}
            className={activeTab === 'create' ? 'is-active' : ''}
            disabled={saving}
            id="create-students-tab"
            onClick={() => selectTab('create')}
            onKeyDown={handleTabKeyDown}
            role="tab"
            type="button"
          >
            <Icon name="plus" />
            <span>Create new</span>
          </button>
          <button
            aria-controls="import-students-panel"
            aria-selected={activeTab === 'import'}
            className={activeTab === 'import' ? 'is-active' : ''}
            disabled={saving}
            id="import-students-tab"
            onClick={() => selectTab('import')}
            onKeyDown={handleTabKeyDown}
            role="tab"
            type="button"
          >
            <Icon name="upload" />
            <span>Import CSV</span>
          </button>
        </div>

        <div
          aria-labelledby="choose-students-tab"
          className="student-picker-panel"
          hidden={activeTab !== 'choose'}
          id="choose-students-panel"
          role="tabpanel"
        >
          <div className="student-combobox">
            <label className="admin-field" htmlFor="student-picker-search">
              <span>Find a student</span>
            </label>
            <div className="student-combobox__input">
              <Icon name="search" />
              <input
                aria-activedescendant={activeOptionIndex >= 0 ? `student-option-${suggestions[activeOptionIndex]?.id}` : undefined}
                aria-autocomplete="list"
                aria-controls="available-students-listbox"
                aria-expanded={showSuggestions}
                autoComplete="off"
                id="student-picker-search"
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setQuery(nextQuery)
                  setActiveOptionIndex(-1)
                  if (nextQuery.trim().length < 2) {
                    setStudents([])
                    setStudentCount(0)
                    setStudentError('')
                  }
                }}
                onKeyDown={handleComboboxKeyDown}
                placeholder="Search by name or student number"
                ref={searchInputRef}
                role="combobox"
                type="search"
                value={query}
              />
            </div>
            {showSuggestions ? (
              <div className="student-combobox__results" id="available-students-listbox" role="listbox">
                {loadingStudents ? <p>Searching students...</p> : null}
                {!loadingStudents && studentError ? <p role="alert">{studentError}</p> : null}
                {!loadingStudents && !studentError && suggestions.map((student, index) => (
                  <button
                    aria-selected={index === activeOptionIndex}
                    className={index === activeOptionIndex ? 'is-highlighted' : ''}
                    id={`student-option-${student.id}`}
                    key={student.id}
                    onClick={() => selectStudent(student)}
                    onMouseEnter={() => setActiveOptionIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span>
                      <strong>{student.display_name}</strong>
                      <small>
                        {student.student_number || 'No student number'}
                      </small>
                    </span>
                    {student.enrollment_status === 'inactive' ? <em>Will reactivate</em> : null}
                  </button>
                ))}
                {!loadingStudents && !studentError && !suggestions.length ? (
                  <p>No available students found.</p>
                ) : null}
                {!loadingStudents && studentCount > AVAILABLE_STUDENT_LIMIT ? (
                  <small className="student-combobox__refine">More students found—refine your search.</small>
                ) : null}
              </div>
            ) : (
              <small className="student-picker-hint">Enter at least two characters to search existing student accounts.</small>
            )}
          </div>

          <section aria-label="Selected students" className="student-picker-selection">
            <div className="student-picker-selection__heading">
              <strong>Selected ({selectedStudents.length})</strong>
              {selectedStudents.length ? (
                <button onClick={() => setSelectedStudents([])} type="button">Clear all</button>
              ) : null}
            </div>
            {selectedStudents.length ? (
              <ul>
                {selectedStudents.map((student) => (
                  <li key={student.id}>
                    <span>
                      <strong>{student.display_name}</strong>
                      <small>{student.student_number || 'No student number'}</small>
                    </span>
                    <button
                      aria-label={`Remove ${student.display_name}`}
                      onClick={() => setSelectedStudents((current) => current.filter((item) => item.id !== student.id))}
                      type="button"
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No students selected yet.</p>
            )}
          </section>
        </div>

        <div
          aria-labelledby="create-students-tab"
          className="student-picker-panel"
          hidden={activeTab !== 'create'}
          id="create-students-panel"
          role="tabpanel"
        >
          {createdStudent ? (
            <section aria-label="Student created" className="student-create-success" role="status">
              <span className="student-create-success__icon"><Icon name="check" /></span>
              <div className="student-create-success__heading">
                <p className="eyebrow">Created and enrolled</p>
                <h2>{createdStudent.student.display_name}</h2>
                <p>{createdStudent.student.student_number} is now active in {schedule.subject_code} {schedule.section || ''}.</p>
              </div>
              <dl className="student-create-credentials">
                <div><dt>Username</dt><dd>{createdStudent.credentials.username}</dd></div>
                <div><dt>Temporary password</dt><dd>{createdStudent.credentials.temporary_password}</dd></div>
              </dl>
              <p className="student-create-success__note">The student must create a secure password after their first sign-in.</p>
              {copyMessage ? <p aria-live="polite" className="student-create-copy-message">{copyMessage}</p> : null}
              <div className="student-create-success__actions">
                <button className="button button--secondary" onClick={() => void copyCreatedCredentials()} type="button"><Icon name="file" /><span>Copy credentials</span></button>
                <button className="button button--secondary" onClick={resetCreateStudent} type="button"><Icon name="plus" /><span>Add another</span></button>
                <button className="button button--primary" onClick={onClose} type="button">Done</button>
              </div>
            </section>
          ) : (
            <>
              <form className="student-create-form" onSubmit={createAndAddStudent}>
                <div className="student-create-form__heading"><p className="eyebrow">New student account</p><h2>Create and add in one step</h2><p>The student number becomes the initial username and temporary password.</p></div>
                <div className="student-create-form__fields">
                  <label className="admin-field"><span>Student number</span><input aria-describedby={createErrors.student_number ? 'create-student-number-error' : undefined} aria-invalid={Boolean(createErrors.student_number)} autoComplete="off" disabled={saving} maxLength={30} onChange={(event) => { setCreateStudentNumber(event.target.value); setCreateErrors((current) => ({ ...current, student_number: undefined })) }} ref={createStudentNumberRef} required type="text" value={createStudentNumber} />{createErrors.student_number ? <small className="student-create-field-error" id="create-student-number-error">{createErrors.student_number}</small> : null}</label>
                  <label className="admin-field"><span>Email <small>Optional</small></span><input aria-describedby={createErrors.email ? 'create-student-email-error' : undefined} aria-invalid={Boolean(createErrors.email)} autoComplete="email" disabled={saving} onChange={(event) => { setCreateEmail(event.target.value); setCreateErrors((current) => ({ ...current, email: undefined })) }} type="email" value={createEmail} />{createErrors.email ? <small className="student-create-field-error" id="create-student-email-error">{createErrors.email}</small> : null}</label>
                  <label className="admin-field"><span>First name</span><input aria-describedby={createErrors.first_name ? 'create-first-name-error' : undefined} aria-invalid={Boolean(createErrors.first_name)} autoComplete="given-name" disabled={saving} maxLength={150} onChange={(event) => { setCreateFirstName(event.target.value); setCreateErrors((current) => ({ ...current, first_name: undefined })) }} required type="text" value={createFirstName} />{createErrors.first_name ? <small className="student-create-field-error" id="create-first-name-error">{createErrors.first_name}</small> : null}</label>
                  <label className="admin-field"><span>Last name</span><input aria-describedby={createErrors.last_name ? 'create-last-name-error' : undefined} aria-invalid={Boolean(createErrors.last_name)} autoComplete="family-name" disabled={saving} maxLength={150} onChange={(event) => { setCreateLastName(event.target.value); setCreateErrors((current) => ({ ...current, last_name: undefined })) }} required type="text" value={createLastName} />{createErrors.last_name ? <small className="student-create-field-error" id="create-last-name-error">{createErrors.last_name}</small> : null}</label>
                </div>
                <button className="button button--primary student-create-form__submit" disabled={saving} type="submit"><Icon name="plus" /><span>{saving ? 'Creating and adding...' : 'Create and add student'}</span></button>
              </form>

              {existingStudent ? (
                <section aria-label="Existing student account" className="student-existing-account">
                  <div><p className="eyebrow">Student account found</p><strong>{existingStudent.display_name}</strong><span>{existingStudent.student_number}</span></div>
                  <span className={`student-existing-account__status student-existing-account__status--${existingStudent.enrollment_status}`}>{existingStudentStatusLabel(existingStudent.enrollment_status)}</span>
                  {existingStudent.enrollment_status === 'inactive' || existingStudent.enrollment_status === 'not_enrolled' ? <button className="button button--secondary" onClick={useExistingStudent} type="button">Use existing student</button> : null}
                  {existingStudent.enrollment_status === 'unavailable' ? <Link className="button button--secondary" onClick={onClose} to="/admin/students">Open Student Management</Link> : null}
                </section>
              ) : null}
            </>
          )}
        </div>

        <div
          aria-labelledby="import-students-tab"
          className="student-picker-panel"
          hidden={activeTab !== 'import'}
          id="import-students-panel"
          role="tabpanel"
        >
          <div className="class-import-panel">
            <div className="class-import-panel__heading">
              <div>
                <strong>Import roster</strong>
                <span>Use Student Number, Last Name, First Name, and Middle Name. Other columns are ignored.</span>
              </div>
              <button
                className="button button--secondary button--compact"
                onClick={downloadRosterImportTemplate}
                type="button"
              >
                <Icon name="file" />
                <span>Download CSV template</span>
              </button>
            </div>
            <label className="admin-field">
              <span>Student list CSV</span>
              <input
                accept=".csv,text/csv,text/plain"
                onChange={(event) => void readImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            {importEncodingNotice ? (
              <p className="admin-message text-import-notice" role="status">{importEncodingNotice}</p>
            ) : null}
            {importReplacementWarning ? (
              <p className="admin-message text-import-warning" role="alert">{importReplacementWarning}</p>
            ) : null}
            {importRows.length ? (
              <button
                className="button button--secondary"
                disabled={saving || !importPreview?.valid || Boolean(importReplacementWarning)}
                onClick={() => void importStudents()}
                type="button"
              >
                <Icon name="upload" />
                <span>{saving ? 'Importing...' : `Import ${importRows.length} students`}</span>
              </button>
            ) : null}
          </div>

          {importPreview ? (
            <div className="class-import-preview" aria-label="Roster import preview">
              <strong>{importPreview.ready_count} of {importPreview.row_count} rows ready</strong>
              <span>
                {importPreview.create_count ?? 0} create · {importPreview.enroll_count ?? 0} enroll · {importPreview.reactivate_count ?? 0} reactivate · {importPreview.already_active_count ?? 0} already enrolled
              </span>
              <ul>
                {importPreview.rows.map((row) => (
                  <li className={row.status === 'error' ? 'is-error' : ''} key={`${row.row}-${row.student_number ?? 'missing'}`}>
                    Row {row.row}{row.student_number ? ` (${row.student_number})` : ''}: {row.error ?? importStatusLabel(row.status)}
                    {!row.error && row.student_name ? ` - ${row.student_name}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {newCredentials.length ? (
            <div className="class-import-credentials" role="status">
              <strong>New students use their student number to sign in</strong>
              <span>The initial username and password are the student number. A secure password is required after first login.</span>
              <button
                className="button button--secondary"
                onClick={() => downloadNewStudentCredentials(newCredentials)}
                type="button"
              >
                <Icon name="file" />
                <span>Download credentials again</span>
              </button>
            </div>
          ) : null}
        </div>

        {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}

        {!(activeTab === 'create' && createdStudent) ? (
          <div className="class-modal-actions">
            <button className="button button--secondary" disabled={saving} onClick={onClose} type="button">
              Cancel
            </button>
            {activeTab === 'choose' ? (
              <button
                className="button button--primary"
                disabled={saving || !selectedIds.length}
                onClick={() => void addStudents()}
                type="button"
              >
                <Icon name="save" />
                <span>{saving ? 'Adding...' : `Add ${selectedIds.length}`}</span>
              </button>
            ) : null}
          </div>
        ) : null}
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

function uniqueSchedules(schedules: SubjectSchedule[]) {
  return Array.from(
    new Map(schedules.map((schedule) => [schedule.id, schedule])).values(),
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
) {
  const params = new URLSearchParams({
    limit: String(AVAILABLE_STUDENT_LIMIT),
    schedule: String(scheduleId),
  })
  const normalizedQuery = query.trim()

  if (normalizedQuery) {
    params.set('search', normalizedQuery)
  }

  return `/accounts/users/available_students/?${params.toString()}`
}

function getRosterRow(enrollment: ScheduleStudent, data: RouteData): RosterRowData {
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
  data: RouteData,
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

function findFinalGrade(data: RouteData, scheduleId: number, studentId: number) {
  return data.finalGrades.find(
    (grade) => grade.schedule === scheduleId && grade.student === studentId,
  )
}

function findPeriodGrade(
  data: RouteData,
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
    ATTENDANCE: 'Attendance',
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
  status: 'active' | 'inactive',
) {
  const normalizedQuery = query.trim().toLowerCase()
  const statusRows = rows.filter((row) =>
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
  const rows = parseCsvRows(text.replace(/^\uFEFF/, '')).filter((row) =>
    row.some((cell) => cell.trim()),
  )

  if (!rows.length) {
    throw new Error('The imported file is empty.')
  }

  const headers = rows[0].map(normalizeImportHeader)
  const hasHeader = headers.includes('student_number')
  const dataRows = hasHeader ? rows.slice(1) : rows

  if (!dataRows.length) {
    throw new Error('The imported file does not contain any student rows.')
  }

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
      firstName: cleanImportedPersonName(getCell('first_name', 2)),
      lastName: cleanImportedPersonName(getCell('last_name', 1)),
      middleName: cleanImportedPersonName(getCell('middle_name', 3)),
      studentNumber,
    }
  })

  return parsedRows
}

function downloadRosterImportTemplate() {
  const blob = new Blob(['Student Number,Last Name,First Name,Middle Name\r\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'student-roster-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function buildRosterPath(
  scheduleId: number,
  status: 'active' | 'inactive',
  query: string,
  limit: number,
  offset: number,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    status,
  })
  if (query) params.set('search', query)
  return `/subjects/subject-schedules/${scheduleId}/roster/?${params.toString()}`
}

async function fetchCompleteRoster(
  api: AuthedRequest,
  scheduleId: number,
  status: 'active' | 'inactive',
  query: string,
) {
  const results: RosterApiItem[] = []
  let offset: number | null = 0

  while (offset !== null) {
    const page: RosterApiPage = await api<RosterApiPage>(buildRosterPath(
      scheduleId,
      status,
      query,
      ROSTER_EXPORT_PAGE_SIZE,
      offset,
    ))
    results.push(...page.results)
    offset = page.next
  }

  return results.map(apiRosterRow)
}

function importRowPayload(row: StudentImportRow) {
  return {
    first_name: row.firstName,
    last_name: row.lastName,
    middle_name: row.middleName,
    student_number: row.studentNumber,
  }
}

function importStatusLabel(status: ImportPreview['rows'][number]['status']) {
  return {
    already_enrolled: 'Already enrolled',
    create: 'Create account',
    enroll: 'Enroll',
    error: 'Error',
    reactivate: 'Reactivate',
  }[status]
}

function existingStudentStatusLabel(status: ExistingRosterStudent['enrollment_status']) {
  return {
    active: 'Already active',
    inactive: 'Inactive enrollment',
    not_enrolled: 'Not enrolled',
    unavailable: 'Account unavailable',
  }[status]
}

function isCreateStudentConflict(value: unknown): value is CreateStudentConflict {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CreateStudentConflict>
  return (
    (candidate.code === 'student_exists' || candidate.code === 'student_unavailable') &&
    typeof candidate.detail === 'string'
  )
}

function createStudentFieldErrors(value: unknown): CreateStudentErrors {
  if (!value || typeof value !== 'object') return {}
  const payload = value as Record<string, unknown>
  const fields: CreateStudentField[] = ['student_number', 'first_name', 'last_name', 'email']
  return fields.reduce<CreateStudentErrors>((errors, field) => {
    const fieldValue = payload[field]
    if (typeof fieldValue === 'string') errors[field] = fieldValue
    else if (Array.isArray(fieldValue) && typeof fieldValue[0] === 'string') errors[field] = fieldValue[0]
    return errors
  }, {})
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function downloadNewStudentCredentials(credentials: Array<{ student_number: string; temporary_password: string }>) {
  const csv = [
    ['student_number', 'temporary_password'],
    ...credentials.map((credential) => [credential.student_number, credential.temporary_password]),
  ].map((row) => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'new-student-credentials.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function normalizeImportHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
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
