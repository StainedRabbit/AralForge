import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { AttendanceRecord, AttendanceSession, SubjectSchedule, User } from '../../types'
import { formatDate, percent, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'
import { Icon } from '../Icon'
import { AttendanceSessionDetails } from './AttendanceSessionDetails'
import { summarizeAttendance } from './attendanceHelpers'

type AttendanceStatus = AttendanceRecord['status']
type AttendanceDraft = { remarks: string; status: AttendanceStatus | '' }
type AttendanceChange = { index: number; previous: AttendanceDraft; studentId: number }
type AttendanceMarkOperation = AttendanceChange & {
  next: AttendanceDraft
  sessionId: number
}
type AttendanceStartResponse = { created: boolean; records: AttendanceRecord[]; session: AttendanceSession }
export type AttendanceDialogTab = 'history' | 'take'

const DEFAULT_SESSION_TITLE = 'Class attendance'
const DEFAULT_POINTS_POSSIBLE = '1.00'
const attendanceStatuses: Array<{ icon: 'activity' | 'check' | 'close' | 'warning'; label: string; status: AttendanceStatus }> = [
  { icon: 'check', label: 'Present', status: 'PRESENT' },
  { icon: 'activity', label: 'Late', status: 'LATE' },
  { icon: 'close', label: 'Absent', status: 'ABSENT' },
  { icon: 'warning', label: 'Excused', status: 'EXCUSED' },
]

export function ClassAttendanceDialog({ api, data, initialTab, onClose, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  initialTab: AttendanceDialogTab
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [tab, setTab] = useState<AttendanceDialogTab>(initialTab)
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null)
  const [drafts, setDrafts] = useState<Record<number, AttendanceDraft>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showSummary, setShowSummary] = useState(false)
  const [excuseOpen, setExcuseOpen] = useState(false)
  const [excuseReason, setExcuseReason] = useState('')
  const [excuseError, setExcuseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingMarkCount, setPendingMarkCount] = useState(0)
  const [closeRequested, setCloseRequested] = useState(false)
  const [message, setMessage] = useState('')
  const [sessionDate, setSessionDate] = useState(todayInputValue)
  const [lastChange, setLastChange] = useState<AttendanceChange | null>(null)
  const [bulkPresentOpen, setBulkPresentOpen] = useState(false)
  const [futureDateOpen, setFutureDateOpen] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const studentNameRef = useRef<HTMLHeadingElement>(null)
  const dirtyRef = useRef(false)
  const markQueueRef = useRef<AttendanceMarkOperation[]>([])
  const processingMarksRef = useRef(false)
  const closeRequestedRef = useRef(false)
  const confirmedLastChangeRef = useRef<AttendanceChange | null>(null)
  const currentRoster = useMemo(() => getScheduleStudents(data, schedule.id), [data, schedule.id])
  const students = useMemo(
    () => activeSession ? getSessionStudents(data, activeSession) : currentRoster,
    [activeSession, currentRoster, data],
  )
  const matchingSession = data.attendanceSessions.find((session) =>
    session.schedule === schedule.id &&
    session.date === sessionDate &&
    session.title === DEFAULT_SESSION_TITLE)
  const currentStudent = students[currentIndex] ?? null
  const currentDraft = currentStudent ? drafts[currentStudent.id] : undefined
  const markedCount = students.filter((student) => drafts[student.id]?.status).length
  const unmarkedCount = students.length - markedCount
  const summary = summarizeDrafts(students, drafts)
  const isFutureDate = sessionDate > todayInputValue()

  async function startAttendance(allowFuture = false) {
    if (!currentRoster.length && !matchingSession) {
      setMessage('Add at least one active student before starting attendance.')
      return
    }
    if (isFutureDate && !matchingSession && !allowFuture) {
      setFutureDateOpen(true)
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const result = await api<AttendanceStartResponse>('/attendance/sessions/start/', {
        body: JSON.stringify({
          date: sessionDate,
          notes: '',
          points_possible: DEFAULT_POINTS_POSSIBLE,
          schedule: schedule.id,
          title: DEFAULT_SESSION_TITLE,
        }),
        method: 'POST',
      })
      const sessionStudents = getSessionStudents(data, result.session)
      const recordsByStudent = new Map(result.records.map((record) => [record.student, record]))
      const nextDrafts = Object.fromEntries(sessionStudents.map((student) => {
        const record = recordsByStudent.get(student.id)
        return [student.id, { remarks: record?.remarks ?? '', status: record?.status ?? '' }]
      })) as Record<number, AttendanceDraft>
      const firstUnmarked = sessionStudents.findIndex((student) => !nextDrafts[student.id]?.status)
      setActiveSession(result.session)
      setDrafts(nextDrafts)
      setCurrentIndex(firstUnmarked >= 0 ? firstUnmarked : 0)
      setShowSummary(firstUnmarked < 0)
      dirtyRef.current = result.created
      setLastChange(null)
      confirmedLastChangeRef.current = null
      setReviewMode(false)
      setFutureDateOpen(false)
      setMessage(result.created ? 'Attendance session started.' : 'Existing session loaded with the latest saved marks.')
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function finishClose() {
    closeRequestedRef.current = false
    setCloseRequested(false)
    onClose()
    if (dirtyRef.current) void refresh().catch(() => undefined)
  }

  async function processMarkQueue() {
    if (processingMarksRef.current) return
    processingMarksRef.current = true

    while (markQueueRef.current.length) {
      const operation = markQueueRef.current[0]
      try {
        await api<AttendanceRecord>(`/attendance/sessions/${operation.sessionId}/mark/`, {
          body: JSON.stringify({
            remarks: operation.next.remarks,
            status: operation.next.status,
            student: operation.studentId,
          }),
          method: 'PUT',
        })
        markQueueRef.current.shift()
        confirmedLastChangeRef.current = {
          index: operation.index,
          previous: operation.previous,
          studentId: operation.studentId,
        }
        setPendingMarkCount(markQueueRef.current.length)
      } catch (caughtError) {
        const rollbackOperations = [...markQueueRef.current]
        markQueueRef.current = []
        processingMarksRef.current = false
        closeRequestedRef.current = false
        setCloseRequested(false)
        setPendingMarkCount(0)
        setDrafts((current) => {
          const rolledBack = { ...current }
          for (const queued of rollbackOperations.reverse()) {
            rolledBack[queued.studentId] = queued.previous
          }
          return rolledBack
        })
        setCurrentIndex(operation.index)
        setShowSummary(false)
        setReviewMode(false)
        setLastChange(confirmedLastChangeRef.current)
        setMessage(toErrorMessage(caughtError))
        return
      }
    }

    processingMarksRef.current = false
    setLastChange(confirmedLastChangeRef.current)
    if (closeRequestedRef.current) finishClose()
  }

  function markCurrentStudent(status: AttendanceStatus, remarks = '') {
    if (!activeSession || !currentStudent || saving || closeRequested) return
    const previousDraft = drafts[currentStudent.id] ?? { remarks: '', status: '' }
    const changedIndex = currentIndex
    const nextDraft = { remarks, status }
    const nextDrafts = { ...drafts, [currentStudent.id]: nextDraft }
    const nextIndex = findNextUnmarked(students, nextDrafts, currentIndex)

    setMessage('')
    setDrafts(nextDrafts)
    dirtyRef.current = true
    setExcuseOpen(false)
    setExcuseError('')

    markQueueRef.current.push({
      index: changedIndex,
      next: nextDraft,
      previous: previousDraft,
      sessionId: activeSession.id,
      studentId: currentStudent.id,
    })
    setPendingMarkCount(markQueueRef.current.length)

    if (nextIndex < 0) {
      setShowSummary(true)
      setMessage('Attendance complete. Every student is marked.')
    } else {
      setCurrentIndex(nextIndex)
      setMessage(`${studentDisplayName(currentStudent)} marked ${statusLabel(status).toLowerCase()}.`)
    }

    void processMarkQueue()
  }

  async function undoLastMark() {
    if (!activeSession || !lastChange || saving || pendingMarkCount) return
    setSaving(true)
    setMessage('')
    try {
      if (lastChange.previous.status) {
        await api<AttendanceRecord>(`/attendance/sessions/${activeSession.id}/mark/`, {
          body: JSON.stringify({
            remarks: lastChange.previous.remarks,
            status: lastChange.previous.status,
            student: lastChange.studentId,
          }),
          method: 'PUT',
        })
      } else {
        await api(`/attendance/sessions/${activeSession.id}/mark/`, {
          body: JSON.stringify({ student: lastChange.studentId }),
          method: 'DELETE',
        })
      }
      setDrafts((current) => ({ ...current, [lastChange.studentId]: lastChange.previous }))
      setCurrentIndex(lastChange.index)
      setShowSummary(false)
      setReviewMode(false)
      setLastChange(null)
      confirmedLastChangeRef.current = null
      dirtyRef.current = true
      setMessage('Last attendance mark undone.')
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function markRemainingPresent() {
    if (!activeSession || !unmarkedCount || saving || pendingMarkCount) return
    setSaving(true)
    setMessage('')
    try {
      const records = students.map((student) => {
        const draft = drafts[student.id]
        return {
          remarks: draft?.remarks ?? '',
          status: draft?.status || 'PRESENT',
          student: student.id,
        }
      })
      const savedRecords = await api<AttendanceRecord[]>(`/attendance/sessions/${activeSession.id}/roster/`, {
        body: JSON.stringify({ records }),
        method: 'PUT',
      })
      setDrafts(Object.fromEntries(savedRecords.map((record) => [
        record.student,
        { remarks: record.remarks, status: record.status },
      ])))
      setBulkPresentOpen(false)
      setLastChange(null)
      confirmedLastChangeRef.current = null
      setShowSummary(true)
      dirtyRef.current = true
      setMessage(`${unmarkedCount} remaining student${unmarkedCount === 1 ? '' : 's'} marked present.`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function chooseStatus(status: AttendanceStatus) {
    if (!currentStudent || saving || closeRequested) return
    if (status === 'EXCUSED') {
      setExcuseReason(currentDraft?.status === 'EXCUSED' ? currentDraft.remarks : '')
      setExcuseError('')
      setExcuseOpen(true)
      return
    }
    void markCurrentStudent(status, '')
  }

  function confirmExcused() {
    const reason = excuseReason.trim()
    if (!reason) {
      setExcuseError('Enter an excuse reason.')
      return
    }
    void markCurrentStudent('EXCUSED', reason)
  }

  function advanceWithoutMark() {
    if (!currentStudent || !students.length) return
    if (currentDraft?.status) {
      if (currentIndex >= students.length - 1) {
        const firstUnmarked = students.findIndex((student) => !drafts[student.id]?.status)
        if (firstUnmarked >= 0) {
          setCurrentIndex(firstUnmarked)
          setMessage('Returning to the first unmarked student.')
        } else {
          setShowSummary(true)
        }
        return
      }
      setCurrentIndex(currentIndex + 1)
      return
    }

    const nextIndex = findNextUnmarked(students, drafts, currentIndex)
    if (nextIndex < 0 || nextIndex === currentIndex) {
      setMessage('This is the remaining unmarked student.')
      return
    }
    setCurrentIndex(nextIndex)
    setMessage('Student skipped for now.')
  }

  async function synchronizeWorkspace() {
    if (!dirtyRef.current) return
    await refresh()
    dirtyRef.current = false
  }

  async function openHistory() {
    if (saving || pendingMarkCount) return
    setSaving(true)
    setMessage('')
    try {
      await synchronizeWorkspace()
      setTab('history')
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function closeDialog() {
    if (saving) return
    if (pendingMarkCount) {
      closeRequestedRef.current = true
      setCloseRequested(true)
      return
    }
    finishClose()
  }

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    if (activeSession && !showSummary && !saving) studentNameRef.current?.focus()
  }, [activeSession, currentIndex, saving, showSummary])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const panel = panelRef.current
      if (!panel) return

      if (event.key === 'Tab') {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ))
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
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        if (excuseOpen) {
          setExcuseOpen(false)
          setExcuseError('')
        } else if (bulkPresentOpen) {
          setBulkPresentOpen(false)
        } else if (futureDateOpen) {
          setFutureDateOpen(false)
        } else {
          void closeDialog()
        }
        return
      }

      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return
      if (!activeSession || showSummary || excuseOpen || saving || closeRequested) return

      const shortcutStatus: Record<string, AttendanceStatus> = {
        '1': 'PRESENT',
        '2': 'LATE',
        '3': 'ABSENT',
        '4': 'EXCUSED',
      }
      if (shortcutStatus[event.key]) {
        event.preventDefault()
        chooseStatus(shortcutStatus[event.key])
      } else if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault()
        setCurrentIndex(currentIndex - 1)
        setMessage('')
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        advanceWithoutMark()
      } else if (event.key.toLowerCase() === 'u' && lastChange) {
        event.preventDefault()
        void undoLastMark()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  return (
    <div aria-labelledby="class-attendance-title" aria-modal="true" className="attendance-modal" role="dialog">
      <button aria-label="Close attendance" className="attendance-modal__backdrop" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={() => closeDialog()} type="button" />
      <div className="attendance-modal__panel attendance-modal__panel--wide class-attendance-dialog" ref={panelRef} tabIndex={-1}>
        <div className="attendance-modal__header">
          <div>
            <strong id="class-attendance-title">Class attendance</strong>
            <span>{schedule.subject_code} {schedule.section || 'No section'} - {schedule.term_name}</span>
          </div>
          <button aria-label="Close" className="icon-button" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={() => closeDialog()} title="Close" type="button"><Icon name="close" /></button>
        </div>

        <div aria-label="Attendance views" className="class-attendance-dialog__tabs" role="tablist">
          <button aria-selected={tab === 'take'} className={tab === 'take' ? 'active' : ''} disabled={saving} onClick={() => setTab('take')} role="tab" type="button">Take attendance</button>
          <button aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={() => void openHistory()} role="tab" type="button">History</button>
        </div>

        {tab === 'take' ? <div className="attendance-roll-call">
          {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}
          {!activeSession ? <div className="attendance-roll-call__start">
            <div>
              <p className="eyebrow">Ready for roll call</p>
              <h2>{students.length} student{students.length === 1 ? '' : 's'}</h2>
              <p>Start or continue this class attendance session.</p>
            </div>
            <div className="attendance-roll-call__start-actions">
              <label className="admin-field">
                <span>Attendance date</span>
                <input disabled={saving} onChange={(event) => { setSessionDate(event.target.value); setFutureDateOpen(false); setMessage('') }} type="date" value={sessionDate} />
              </label>
              <button className="button button--primary attendance-start-button" disabled={saving || (!currentRoster.length && !matchingSession) || !sessionDate} onClick={() => void startAttendance()} type="button">
                <Icon name="check" /><span>{saving ? 'Starting...' : matchingSession ? 'Continue session' : 'Start session'}</span>
              </button>
              {isFutureDate && !matchingSession ? <p className="attendance-date-warning" role="alert">This date is in the future.</p> : null}
              {futureDateOpen ? <div className="attendance-confirm-panel" role="alertdialog" aria-label="Confirm future attendance date">
                <strong>Create future attendance?</strong>
                <span>You selected {formatDate(sessionDate)}. Confirm only if you intend to prepare this session early.</span>
                <div>
                  <button className="button button--secondary button--compact" onClick={() => setFutureDateOpen(false)} type="button">Cancel</button>
                  <button className="button button--primary button--compact" onClick={() => void startAttendance(true)} type="button">Create future session</button>
                </div>
              </div> : null}
            </div>
          </div> : showSummary ? <AttendanceCompletion
            onClose={() => void closeDialog()}
            onHistory={() => void openHistory()}
            onReview={() => { setCurrentIndex(0); setReviewMode(true); setShowSummary(false); setMessage('Reviewing attendance from the first student.') }}
            onUndo={lastChange ? () => void undoLastMark() : undefined}
            closeRequested={closeRequested}
            pendingMarkCount={pendingMarkCount}
            saving={saving}
            summary={summary}
            total={students.length}
          /> : currentStudent ? <div className="attendance-roll-call__runner">
            <div className="attendance-roll-call__progress">
              <div><strong>{currentIndex + 1} of {students.length}</strong><span>{formatDate(activeSession.date)}</span></div>
              <div>
                <span>{markedCount} marked</span>
                {pendingMarkCount ? <span aria-live="polite">Saving {pendingMarkCount} mark{pendingMarkCount === 1 ? '' : 's'}...</span> : null}
                {lastChange ? <button className="button button--secondary button--compact" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={() => void undoLastMark()} type="button">Undo last</button> : null}
              </div>
            </div>
            <div className="attendance-student-card">
              <div className="attendance-student-card__identity">
                <h2 className={`attendance-student-card__name attendance-student-card__name--${studentNameLength(studentDisplayName(currentStudent))}`} ref={studentNameRef} tabIndex={-1}>{studentDisplayName(currentStudent)}</h2>
              </div>
              {currentDraft?.status ? <span className={`attendance-status attendance-status--${currentDraft.status.toLowerCase()}`}>{statusLabel(currentDraft.status)}</span> : <span className="attendance-status attendance-status--unmarked">Unmarked</span>}
            </div>
            {excuseOpen ? <div className="attendance-excuse-form">
              <label className="admin-field" htmlFor={`attendance-excuse-${currentStudent.id}`}>
                <span>Excuse reason</span>
                <textarea aria-describedby={excuseError ? 'attendance-excuse-error' : undefined} aria-invalid={Boolean(excuseError)} autoFocus disabled={saving || closeRequested} id={`attendance-excuse-${currentStudent.id}`} onChange={(event) => { setExcuseReason(event.target.value); setExcuseError('') }} placeholder="Enter the reason this student is excused" rows={3} value={excuseReason} />
              </label>
              {excuseError ? <small className="class-score-field-error" id="attendance-excuse-error">{excuseError}</small> : null}
              <div className="attendance-excuse-form__actions">
                <button className="button button--secondary" disabled={saving || closeRequested} onClick={() => { setExcuseOpen(false); setExcuseError('') }} type="button">Cancel</button>
                <button className="button button--primary" disabled={saving || closeRequested} onClick={confirmExcused} type="button"><Icon name="save" /><span>Confirm excused</span></button>
              </div>
            </div> : <div aria-label={`Mark attendance for ${studentDisplayName(currentStudent)}`} className="attendance-status-actions">
              {attendanceStatuses.map((option, index) => <button aria-keyshortcuts={`${index + 1}`} aria-label={option.label} aria-pressed={currentDraft?.status === option.status} className={`attendance-status-action attendance-status-action--${option.status.toLowerCase()}`} disabled={saving || closeRequested} key={option.status} onClick={() => chooseStatus(option.status)} type="button">
                <Icon name={option.icon} /><span>{option.label}</span><small>{index + 1}</small>
              </button>)}
            </div>}
            {reviewMode ? <label className="admin-field attendance-student-jump">
              <span>Jump to student</span>
              <select onChange={(event) => { setCurrentIndex(Number(event.target.value)); setExcuseOpen(false); setMessage('') }} value={currentIndex}>
                {students.map((student, index) => <option key={student.id} value={index}>{studentDisplayName(student)}</option>)}
              </select>
            </label> : null}
            {!reviewMode && unmarkedCount ? <div className="attendance-bulk-action">
              {bulkPresentOpen ? <div className="attendance-confirm-panel" role="alertdialog" aria-label="Confirm mark remaining present">
                <strong>Mark {unmarkedCount} remaining present?</strong>
                <span>Already marked students will not change.</span>
                <div>
                  <button className="button button--secondary button--compact" disabled={saving || Boolean(pendingMarkCount)} onClick={() => setBulkPresentOpen(false)} type="button">Cancel</button>
                  <button className="button button--primary button--compact" disabled={saving || Boolean(pendingMarkCount)} onClick={() => void markRemainingPresent()} type="button">Confirm</button>
                </div>
              </div> : <button className="button button--secondary button--compact" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={() => setBulkPresentOpen(true)} type="button">Mark remaining Present</button>}
            </div> : null}
            <p className="attendance-keyboard-hint">Keyboard: 1 Present · 2 Late · 3 Absent · 4 Excused · ← Previous · → Next · U Undo</p>
            <div className="attendance-roll-call__navigation">
              <button className="button button--secondary" disabled={saving || currentIndex === 0} onClick={() => { setCurrentIndex(currentIndex - 1); setExcuseOpen(false); setMessage('') }} type="button"><Icon name="arrow-left" /><span>Previous</span></button>
              <button className="button button--secondary" disabled={saving || excuseOpen} onClick={advanceWithoutMark} type="button"><span>{currentDraft?.status ? 'Next' : 'Skip for now'}</span><Icon name="arrow-right" /></button>
            </div>
          </div> : null}
        </div> : <ClassAttendanceHistory api={api} data={data} refresh={refresh} schedule={schedule} />}
      </div>
    </div>
  )
}

function AttendanceCompletion({ closeRequested, onClose, onHistory, onReview, onUndo, pendingMarkCount, saving, summary, total }: {
  closeRequested: boolean
  onClose: () => void
  onHistory: () => void
  onReview: () => void
  onUndo?: () => void
  pendingMarkCount: number
  saving: boolean
  summary: ReturnType<typeof summarizeDrafts>
  total: number
}) {
  return <div className="attendance-completion">
    <div className="attendance-completion__heading">
      <span className="attendance-completion__icon"><Icon name="check" /></span>
      <div><p className="eyebrow">Roll call complete</p><h2>All {total} students are marked</h2></div>
    </div>
    <div aria-label="Attendance totals" className="attendance-breakdown__stats" role="group">
      <AttendanceTotal label="Present" value={summary.present} />
      <AttendanceTotal label="Late" value={summary.late} />
      <AttendanceTotal label="Absent" value={summary.absent} />
      <AttendanceTotal label="Excused" value={summary.excused} />
    </div>
    {pendingMarkCount ? <p aria-live="polite" className="admin-message">Saving {pendingMarkCount} mark{pendingMarkCount === 1 ? '' : 's'}...</p> : null}
    <div className="class-modal-actions">
      {onUndo ? <button className="button button--secondary" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={onUndo} type="button">Undo last</button> : null}
      <button className="button button--secondary" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={onReview} type="button"><Icon name="arrow-left" /><span>Review from first</span></button>
      <button className="button button--secondary" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={onHistory} type="button"><Icon name="search" /><span>History</span></button>
      <button className="button button--primary" disabled={saving || Boolean(pendingMarkCount) || closeRequested} onClick={onClose} type="button"><Icon name="check" /><span>Finish</span></button>
    </div>
  </div>
}

function AttendanceTotal({ label, value }: { label: string; value: number }) {
  return <div className="attendance-breakdown__stat"><strong>{value}</strong><span>{label}</span></div>
}

function ClassAttendanceHistory({ api, data, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const sessions = data.attendanceSessions
    .filter((session) => session.schedule === schedule.id)
    .sort((first, second) => second.date.localeCompare(first.date) || second.id - first.id)
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null

  if (selectedSession) {
    return <div className="class-attendance-history__details">
      <div className="class-attendance-history__heading">
        <button className="button button--secondary button--compact" onClick={() => setSelectedSessionId(null)} type="button"><Icon name="arrow-left" /><span>Back to history</span></button>
        <div><strong>{selectedSession.title || 'Class meeting'}</strong><span>{formatDate(selectedSession.date)}</span></div>
      </div>
      <AttendanceSessionDetails api={api} data={data} refresh={refresh} session={selectedSession} />
    </div>
  }

  return <div className="class-attendance-history">
    <div className="table-wrap">
      <table className="admin-table mobile-card-table">
        <thead><tr><th>Date</th><th>Session</th><th>Present</th><th>Late</th><th>Absent</th><th>Rate</th><th>Details</th></tr></thead>
        <tbody>
          {sessions.map((session) => {
            const records = data.attendanceRecords.filter((record) => record.session === session.id)
            const summary = summarizeAttendance(records)
            return <tr key={session.id}>
              <td data-label="Date">{formatDate(session.date)}</td><td data-label="Session">{session.title || 'Class meeting'}</td><td data-label="Present">{summary.present}</td><td data-label="Late">{summary.late}</td><td data-label="Absent">{summary.absent}</td><td data-label="Rate">{percent(summary.attended, records.length)}%</td>
              <td data-label="Details"><button className="button button--secondary button--compact" onClick={() => setSelectedSessionId(session.id)} type="button"><Icon name="search" /><span>View</span></button></td>
            </tr>
          })}
          {!sessions.length ? <tr><td colSpan={7}>No attendance history for this class yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>
}

function getScheduleStudents(data: RouteData, scheduleId: number) {
  const studentIds = new Set(data.enrollments.filter((item) => item.schedule === scheduleId && item.is_active).map((item) => item.student))
  return data.users.filter((user) => user.role === 'STUDENT' && studentIds.has(user.id))
    .sort((first, second) => studentDisplayName(first).localeCompare(studentDisplayName(second), undefined, { sensitivity: 'base' }))
}

function getSessionStudents(data: RouteData, session: AttendanceSession) {
  const studentIds = session.roster_students?.length
    ? new Set(session.roster_students)
    : new Set(data.enrollments.filter((item) => item.schedule === session.schedule && item.is_active).map((item) => item.student))
  return data.users.filter((user) => user.role === 'STUDENT' && studentIds.has(user.id))
    .sort((first, second) => studentDisplayName(first).localeCompare(studentDisplayName(second), undefined, { sensitivity: 'base' }))
}

function findNextUnmarked(students: User[], drafts: Record<number, AttendanceDraft>, currentIndex: number) {
  for (let offset = 1; offset <= students.length; offset += 1) {
    const index = (currentIndex + offset) % students.length
    if (!drafts[students[index].id]?.status) return index
  }
  return -1
}

function summarizeDrafts(students: User[], drafts: Record<number, AttendanceDraft>) {
  const statuses = students.map((student) => drafts[student.id]?.status)
  return {
    absent: statuses.filter((status) => status === 'ABSENT').length,
    excused: statuses.filter((status) => status === 'EXCUSED').length,
    late: statuses.filter((status) => status === 'LATE').length,
    present: statuses.filter((status) => status === 'PRESENT').length,
  }
}

function studentDisplayName(user: User) {
  return fullName(user)
}

function studentNameLength(name: string) {
  const length = Array.from(name).length
  if (length <= 16) return 'short'
  if (length <= 24) return 'medium'
  if (length <= 32) return 'long'
  return 'extra-long'
}

function statusLabel(status: AttendanceStatus) {
  return attendanceStatuses.find((option) => option.status === status)?.label ?? status
}

function todayInputValue() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
