import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { GradeItem, SubjectSchedule } from '../../types'
import { formatDate, numeric, toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'

const periods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
const periodLabels = { FINAL: 'Final', MIDTERM: 'Midterm', PREFINAL: 'Prefinal', PRELIM: 'Prelim' }

type ScoreStatus = 'GRADED' | 'EXCUSED'
type SavedScore = { rawScore: string; remarks: string; status: ScoreStatus }
type ScoreDraft = {
  isActive: boolean
  rawScore: string
  remarks: string
  saved: SavedScore | null
  scoreId: number | null
  status: ScoreStatus
  student: number
  studentName: string
  studentNumber: string
}
type ScoreSheetResponse = {
  item: GradeItem
  rows: Array<{
    is_active: boolean
    raw_score: string | null
    remarks: string
    score_id: number | null
    status: ScoreStatus
    student: number
    student_name: string
    student_number: string
  }>
  counts: {
    active_count: number
    excused_count: number
    graded_count: number
    student_count: number
    zero_count: number
  }
}
type SavedScoreResponse = {
  id: number
  raw_score: string | null
  remarks: string
  status: ScoreStatus
  student: number
}
type ScoreChange = { index: number; previous: ScoreDraft; student: number }

export function ClassScoresDialog({ api, data, onClose, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const scoreInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'enter' | 'sheets'>('enter')
  const [period, setPeriod] = useState<(typeof periods)[number]>('PRELIM')
  const [categoryId, setCategoryId] = useState('')
  const [sheetDate, setSheetDate] = useState(todayInputValue)
  const [title, setTitle] = useState('')
  const [pointsPossible, setPointsPossible] = useState('10')
  const [activeItem, setActiveItem] = useState<GradeItem | null>(null)
  const [drafts, setDrafts] = useState<ScoreDraft[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showSummary, setShowSummary] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [excuseOpen, setExcuseOpen] = useState(false)
  const [excuseReason, setExcuseReason] = useState('')
  const [excuseError, setExcuseError] = useState('')
  const [lastChange, setLastChange] = useState<ScoreChange | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const categories = data.gradeCategories.filter((category) =>
    category.subject === schedule.subject &&
    category.grading_period === period &&
    category.category !== 'ATTENDANCE')
  const selectedCategory = categories.find((category) => category.id === Number(categoryId)) ?? categories[0] ?? null
  const scoreSheets = useMemo(() => {
    const items = activeItem && !data.gradeItems.some((item) => item.id === activeItem.id)
      ? [activeItem, ...data.gradeItems]
      : data.gradeItems
    return items
      .filter((item) => item.schedule === schedule.id && item.source_type === 'MANUAL')
      .sort((left, right) =>
        (right.date ?? right.created_at.slice(0, 10)).localeCompare(left.date ?? left.created_at.slice(0, 10)) || right.id - left.id)
  }, [activeItem, data.gradeItems, schedule.id])
  const activeDrafts = drafts.filter((draft) => draft.isActive)
  const inactiveDrafts = drafts.filter((draft) => !draft.isActive)
  const currentDraft = activeDrafts[currentIndex] ?? null
  const currentStudentId = currentDraft?.student ?? null
  const savedCount = activeDrafts.filter((draft) => draft.saved).length
  const pendingCount = activeDrafts.length - savedCount
  const gradedCount = activeDrafts.filter((draft) => draft.saved?.status === 'GRADED').length
  const zeroCount = activeDrafts.filter((draft) =>
    draft.saved?.status === 'GRADED' && Number(draft.saved.rawScore) === 0).length
  const excusedCount = activeDrafts.filter((draft) => draft.saved?.status === 'EXCUSED').length
  const maximum = numeric(activeItem?.points_possible ?? pointsPossible)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (tab === 'enter' && activeItem && currentStudentId != null && !showSummary && !excuseOpen) scoreInputRef.current?.focus()
  }, [activeItem, currentStudentId, excuseOpen, showSummary, tab])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (excuseOpen) {
          setExcuseOpen(false)
          setExcuseError('')
        } else if (!saving) closeDialog()
        return
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => !element.closest('[hidden]'))
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

      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return
      if (!activeItem || showSummary || saving || excuseOpen) return
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault()
        moveToStudent(currentIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        void advance()
      } else if (event.key.toLowerCase() === 'u' && lastChange) {
        event.preventDefault()
        void undoLastScore()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  function closeDialog() {
    if (saving) return
    onClose()
    if (activeItem) void refresh().catch(() => undefined)
  }

  function clearEntry() {
    setActiveItem(null)
    setDrafts([])
    setCurrentIndex(0)
    setShowSummary(false)
    setReviewMode(false)
    setLastChange(null)
    setTitle('')
    setPointsPossible('10')
    setSheetDate(todayInputValue())
    setMessage('')
  }

  async function startNewSheet() {
    if (!selectedCategory || !title.trim() || !sheetDate || numeric(pointsPossible) <= 0) return
    setSaving(true)
    setMessage('')
    try {
      const response = await api<ScoreSheetResponse>('/grades/items/score-sheet/start/', {
        body: JSON.stringify({
          date: sheetDate,
          grade_category: selectedCategory.id,
          points_possible: pointsPossible,
          schedule: schedule.id,
          title: title.trim(),
        }),
        method: 'POST',
      })
      const nextDrafts = response.rows.map((row) => apiRowToDraft(row, data))
      setActiveItem(response.item)
      setDrafts(nextDrafts)
      setCurrentIndex(firstPendingIndex(nextDrafts))
      setShowSummary(false)
      setReviewMode(false)
      setLastChange(null)
      setMessage('Score sheet started. Scores save as you record them.')
      void refresh().catch(() => undefined)
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function openSheet(item: GradeItem) {
    setSaving(true)
    setMessage('')
    try {
      const response = await api<ScoreSheetResponse>(`/grades/items/${item.id}/roster/`)
      const nextDrafts = response.rows.map((row) => apiRowToDraft(row, data))
      const nextActiveDrafts = nextDrafts.filter((draft) => draft.isActive)
      const pendingIndex = nextActiveDrafts.findIndex((draft) => !draft.saved)
      setActiveItem(response.item)
      setPeriod(data.gradeCategories.find((category) => category.id === item.grade_category)?.grading_period ?? 'PRELIM')
      setCategoryId(String(item.grade_category))
      setSheetDate(item.date ?? item.created_at.slice(0, 10))
      setTitle(item.title)
      setPointsPossible(item.points_possible)
      setDrafts(nextDrafts)
      setCurrentIndex(pendingIndex >= 0 ? pendingIndex : 0)
      setShowSummary(false)
      setReviewMode(pendingIndex < 0)
      setLastChange(null)
      setTab('enter')
      setMessage(pendingIndex >= 0 ? 'Continuing at the first pending student.' : 'Reviewing this completed score sheet.')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function updateCurrent(changes: Partial<ScoreDraft>) {
    if (!currentDraft) return
    setDrafts((current) => current.map((draft) =>
      draft.student === currentDraft.student ? { ...draft, ...changes } : draft))
    setMessage('')
  }

  async function saveCurrent(status: ScoreStatus, rawScore: string, remarks: string) {
    if (!activeItem || !currentDraft || saving) return
    const error = scoreValueError(status, rawScore, remarks, maximum)
    if (error) {
      if (status === 'EXCUSED') setExcuseError(error)
      else setMessage(error)
      return
    }
    const previous = canonicalDraft(currentDraft)
    setSaving(true)
    setMessage('')
    try {
      const response = await api<SavedScoreResponse>(`/grades/items/${activeItem.id}/mark/`, {
        body: JSON.stringify({
          raw_score: status === 'EXCUSED' ? null : rawScore,
          remarks,
          status,
          student: currentDraft.student,
        }),
        method: 'PUT',
      })
      const nextDraft = applySavedScore(currentDraft, response)
      const nextDrafts = drafts.map((draft) => draft.student === nextDraft.student ? nextDraft : draft)
      const nextActiveDrafts = nextDrafts.filter((draft) => draft.isActive)
      setDrafts(nextDrafts)
      setLastChange({ index: currentIndex, previous, student: currentDraft.student })
      setExcuseOpen(false)
      setExcuseError('')
      const nextIndex = findNextPending(nextActiveDrafts, currentIndex)
      if (nextIndex < 0) {
        setShowSummary(true)
        setReviewMode(false)
        setMessage('Score sheet complete. Every active student has a saved result.')
      } else {
        setCurrentIndex(nextIndex)
        setMessage(`${currentDraft.studentName} saved.`)
      }
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function undoLastScore() {
    if (!activeItem || !lastChange || saving) return
    setSaving(true)
    setMessage('')
    try {
      if (lastChange.previous.saved) {
        const previous = lastChange.previous.saved
        const response = await api<SavedScoreResponse>(`/grades/items/${activeItem.id}/mark/`, {
          body: JSON.stringify({
            raw_score: previous.status === 'EXCUSED' ? null : previous.rawScore,
            remarks: previous.remarks,
            status: previous.status,
            student: lastChange.student,
          }),
          method: 'PUT',
        })
        setDrafts((current) => current.map((draft) =>
          draft.student === lastChange.student ? applySavedScore(lastChange.previous, response) : draft))
      } else {
        await api(`/grades/items/${activeItem.id}/mark/`, {
          body: JSON.stringify({ student: lastChange.student }),
          method: 'DELETE',
        })
        setDrafts((current) => current.map((draft) =>
          draft.student === lastChange.student ? lastChange.previous : draft))
      }
      setCurrentIndex(lastChange.index)
      setShowSummary(false)
      setReviewMode(false)
      setLastChange(null)
      setMessage('Last score action undone.')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function moveToStudent(index: number) {
    setCurrentIndex(index)
    setExcuseOpen(false)
    setExcuseError('')
    setMessage('')
  }

  async function advance() {
    if (!currentDraft) return
    if (!currentDraft.saved) {
      await saveCurrent('GRADED', '0', '')
      return
    }
    if (currentIndex >= activeDrafts.length - 1) {
      if (pendingCount) {
        const firstPending = activeDrafts.findIndex((draft) => !draft.saved)
        if (firstPending >= 0) moveToStudent(firstPending)
      } else setShowSummary(true)
      return
    }
    moveToStudent(currentIndex + 1)
  }

  function openExcuse() {
    if (!currentDraft) return
    setExcuseReason(currentDraft.saved?.status === 'EXCUSED' ? currentDraft.saved.remarks : '')
    setExcuseError('')
    setExcuseOpen(true)
  }

  const currentError = currentDraft
    ? scoreValueError('GRADED', currentDraft.rawScore, currentDraft.remarks, maximum)
    : ''

  return (
    <div aria-labelledby="class-scores-title" aria-modal="true" className="attendance-modal" role="dialog">
      <button aria-label="Dismiss scores" className="attendance-modal__backdrop" disabled={saving} onClick={closeDialog} type="button" />
      <div className="attendance-modal__panel attendance-modal__panel--wide class-score-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="attendance-modal__header">
          <div>
            <strong id="class-scores-title">Class scores</strong>
            <span>{schedule.subject_code} {schedule.section || 'No section'} - {schedule.term_name}</span>
          </div>
          <button aria-label="Close scores" className="icon-button" disabled={saving} onClick={closeDialog} type="button"><Icon name="close" /></button>
        </div>

        <div aria-label="Score views" className="class-attendance-dialog__tabs" role="tablist">
          <button aria-controls="score-entry-panel" aria-selected={tab === 'enter'} className={tab === 'enter' ? 'active' : ''} disabled={saving} onClick={() => setTab('enter')} role="tab" type="button">Enter scores</button>
          <button aria-controls="score-sheets-panel" aria-selected={tab === 'sheets'} className={tab === 'sheets' ? 'active' : ''} disabled={saving} onClick={() => setTab('sheets')} role="tab" type="button">Score sheets</button>
        </div>

        <div hidden={tab !== 'enter'} id="score-entry-panel" role="tabpanel">
          {!activeItem ? (
            <div className="class-score-setup">
              <label className="admin-field"><span>Date</span><input disabled={saving} onChange={(event) => setSheetDate(event.target.value)} required type="date" value={sheetDate} /></label>
              <label className="admin-field"><span>Grading period</span><select disabled={saving} onChange={(event) => { setPeriod(event.target.value as typeof period); setCategoryId('') }} value={period}>{periods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></label>
              <label className="admin-field"><span>Category</span><select disabled={saving || !categories.length} onChange={(event) => setCategoryId(event.target.value)} value={selectedCategory?.id ?? ''}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.category})</option>)}</select></label>
              <label className="admin-field"><span>Title</span><input disabled={saving} onChange={(event) => setTitle(event.target.value)} placeholder="Quiz 1" required value={title} /></label>
              <label className="admin-field"><span>Maximum score</span><input disabled={saving} min="0.01" onChange={(event) => setPointsPossible(event.target.value)} required step="0.01" type="number" value={pointsPossible} /></label>
              {!categories.length ? <p className="admin-message class-score-setup__guidance">No non-attendance categories are configured for {periodLabels[period]}. <Link to="/admin/grades">Configure grade categories</Link>.</p> : null}
              <button className="button button--primary" disabled={saving || !selectedCategory || !title.trim() || !sheetDate || numeric(pointsPossible) <= 0} onClick={() => void startNewSheet()} type="button"><Icon name="grade" /><span>{saving ? 'Starting...' : 'Start score sheet'}</span></button>
            </div>
          ) : showSummary ? (
            <ScoreCompletion excused={excusedCount} graded={gradedCount} inactiveDrafts={inactiveDrafts} onClose={closeDialog} onReview={() => { setCurrentIndex(0); setReviewMode(true); setShowSummary(false); setMessage('Reviewing scores from the first student.') }} onSheets={() => setTab('sheets')} onUndo={lastChange ? () => void undoLastScore() : undefined} saving={saving} total={activeDrafts.length} zeros={zeroCount} />
          ) : currentDraft ? (
            <div className="attendance-roll-call score-roll-call">
              {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}
              <div className="attendance-roll-call__runner">
                <div className="class-score-sheet-heading">
                  <div><strong>{activeItem.title}</strong><span>{formatDate(activeItem.date ?? sheetDate)} - {maximum} points</span></div>
                  <button className="button button--secondary button--compact" disabled={saving} onClick={clearEntry} type="button"><Icon name="plus" /><span>New score sheet</span></button>
                </div>
                <div className="attendance-roll-call__progress">
                  <div><strong>{currentIndex + 1} of {activeDrafts.length}</strong><span>{pendingCount} pending</span></div>
                  <div><span>{savedCount} saved</span>{saving ? <span aria-live="polite">Saving...</span> : null}{lastChange ? <button className="button button--secondary button--compact" disabled={saving} onClick={() => void undoLastScore()} type="button">Undo last</button> : null}</div>
                </div>
                <div className="attendance-student-card">
                  <div className="attendance-student-card__identity"><h2 className={`attendance-student-card__name attendance-student-card__name--${studentNameLength(currentDraft.studentName)}`}>{currentDraft.studentName}</h2>{currentDraft.studentNumber ? <p>{currentDraft.studentNumber}</p> : null}</div>
                  {currentDraft.saved?.status === 'EXCUSED' ? <span className="attendance-status attendance-status--excused">Excused</span> : currentDraft.saved ? <span className="attendance-status score-status--saved">{currentDraft.saved.rawScore} / {maximum}</span> : <span className="attendance-status attendance-status--unmarked">Pending</span>}
                </div>

                {excuseOpen ? (
                  <div className="attendance-excuse-form">
                    <label className="admin-field" htmlFor={`score-excuse-${currentDraft.student}`}><span>Excuse reason</span><textarea aria-describedby={excuseError ? 'score-excuse-error' : undefined} aria-invalid={Boolean(excuseError)} autoFocus disabled={saving} id={`score-excuse-${currentDraft.student}`} onChange={(event) => { setExcuseReason(event.target.value); setExcuseError('') }} placeholder="Enter why this student is excused" rows={3} value={excuseReason} /></label>
                    {excuseError ? <small className="class-score-field-error" id="score-excuse-error">{excuseError}</small> : null}
                    <div className="attendance-excuse-form__actions"><button className="button button--secondary" disabled={saving} onClick={() => { setExcuseOpen(false); setExcuseError('') }} type="button">Cancel</button><button className="button button--primary" disabled={saving} onClick={() => void saveCurrent('EXCUSED', '', excuseReason.trim())} type="button"><Icon name="save" /><span>Confirm excused</span></button></div>
                  </div>
                ) : (
                  <form className="score-entry-form" onSubmit={(event) => { event.preventDefault(); void saveCurrent('GRADED', currentDraft.rawScore, currentDraft.remarks) }}>
                    <label className="admin-field"><span>Score out of {maximum}</span><input aria-describedby={currentError ? `score-error-${currentDraft.student}` : undefined} aria-invalid={Boolean(currentError && currentDraft.rawScore)} aria-label={`Score for ${currentDraft.studentName}`} disabled={saving} max={maximum} min="0" onChange={(event) => updateCurrent({ rawScore: event.target.value })} placeholder="Enter score" ref={scoreInputRef} required step="0.01" type="number" value={currentDraft.rawScore} /></label>
                    <label className="admin-field"><span>Remarks (optional)</span><input aria-label={`Remarks for ${currentDraft.studentName}`} disabled={saving} maxLength={160} onChange={(event) => updateCurrent({ remarks: event.target.value })} placeholder="Optional note" value={currentDraft.remarks} /></label>
                    {currentError && currentDraft.rawScore ? <small className="class-score-field-error score-entry-form__error" id={`score-error-${currentDraft.student}`}>{currentError}</small> : null}
                    <div className="score-entry-form__actions"><button className="button button--secondary" disabled={saving} onClick={openExcuse} type="button"><Icon name="warning" /><span>Excused</span></button><button className="button button--primary" disabled={saving || Boolean(currentError)} type="submit"><Icon name="save" /><span>{saving ? 'Saving...' : 'Record score'}</span></button></div>
                  </form>
                )}

                {reviewMode ? <label className="admin-field attendance-student-jump"><span>Jump to student</span><select disabled={saving} onChange={(event) => moveToStudent(Number(event.target.value))} value={currentIndex}>{activeDrafts.map((draft, index) => <option key={draft.student} value={index}>{draft.studentName}</option>)}</select></label> : null}
                <p className="attendance-keyboard-hint">Keyboard: Enter Record score · ← Previous · → Next or Skip as 0 · U Undo</p>
                <div className="attendance-roll-call__navigation"><button className="button button--secondary" disabled={saving || currentIndex === 0} onClick={() => moveToStudent(currentIndex - 1)} type="button"><Icon name="arrow-left" /><span>Previous</span></button><button className="button button--secondary" disabled={saving || excuseOpen} onClick={() => void advance()} type="button"><span>{currentDraft.saved ? 'Next' : 'Skip as 0'}</span><Icon name="arrow-right" /></button></div>
                {inactiveDrafts.length ? <InactiveHistory drafts={inactiveDrafts} /> : null}
              </div>
            </div>
          ) : <p className="admin-empty-line">No active students are available for this score sheet.</p>}
        </div>

        <div hidden={tab !== 'sheets'} id="score-sheets-panel" role="tabpanel">
          <div className="class-score-sheet-list">
            {scoreSheets.map((item) => {
              const category = data.gradeCategories.find((candidate) => candidate.id === item.grade_category)
              return <button disabled={saving} key={item.id} onClick={() => void openSheet(item)} type="button"><span><strong>{item.title}</strong><small>{category?.name ?? 'Unknown category'} - {numeric(item.points_possible)} points</small></span><span>{item.date ? formatDate(item.date) : 'No date'}</span></button>
            })}
            {!scoreSheets.length ? <p className="admin-empty-line">No manual score sheets for this class yet.</p> : null}
          </div>
        </div>

        {message && (tab === 'sheets' || !activeItem) ? <p aria-live="polite" className="admin-message">{message}</p> : null}
      </div>
    </div>
  )
}

function ScoreCompletion({ excused, graded, inactiveDrafts, onClose, onReview, onSheets, onUndo, saving, total, zeros }: {
  excused: number
  graded: number
  inactiveDrafts: ScoreDraft[]
  onClose: () => void
  onReview: () => void
  onSheets: () => void
  onUndo?: () => void
  saving: boolean
  total: number
  zeros: number
}) {
  return <div className="attendance-roll-call score-roll-call"><div className="attendance-completion">
    <div className="attendance-completion__heading"><span className="attendance-completion__icon"><Icon name="check" /></span><div><p className="eyebrow">Score sheet complete</p><h2>{total} student{total === 1 ? '' : 's'} saved</h2><p>Every active student has a score or an approved excuse.</p></div></div>
    <div aria-label="Score totals" className="attendance-breakdown__stats" role="group"><ScoreTotal label="Graded" value={graded} /><ScoreTotal label="Zero" value={zeros} /><ScoreTotal label="Excused" value={excused} /></div>
    {inactiveDrafts.length ? <InactiveHistory drafts={inactiveDrafts} /> : null}
    <div className="class-modal-actions">{onUndo ? <button className="button button--secondary" disabled={saving} onClick={onUndo} type="button">Undo last</button> : null}<button className="button button--secondary" disabled={saving} onClick={onReview} type="button">Review scores</button><button className="button button--secondary" disabled={saving} onClick={onSheets} type="button">Score sheets</button><button className="button button--primary" disabled={saving} onClick={onClose} type="button">Close</button></div>
  </div></div>
}

function ScoreTotal({ label, value }: { label: string; value: number }) {
  return <span><strong>{value}</strong><small>{label}</small></span>
}

function InactiveHistory({ drafts }: { drafts: ScoreDraft[] }) {
  return <details className="class-score-history"><summary>Inactive student history ({drafts.length})</summary><div className="table-wrap class-score-table-wrap"><table className="admin-table class-score-table mobile-card-table"><thead><tr><th>Student</th><th>Score</th><th>Status</th><th>Remarks</th></tr></thead><tbody>{drafts.map((draft) => <tr key={draft.student}><td data-label="Student"><strong>{draft.studentName}</strong><span>{draft.studentNumber}</span></td><td data-label="Score">{draft.saved?.status === 'GRADED' ? draft.saved.rawScore : '—'}</td><td data-label="Status">{draft.saved?.status === 'EXCUSED' ? 'Excused' : draft.saved ? 'Graded' : 'Pending'}</td><td data-label="Remarks">{draft.saved?.remarks || '—'}</td></tr>)}</tbody></table></div></details>
}

function scoreValueError(status: ScoreStatus, rawScore: string, remarks: string, maximum: number) {
  if (status === 'EXCUSED') return remarks.trim() ? '' : 'Enter an excuse reason.'
  if (!rawScore.trim()) return 'Enter a score or choose Skip as 0.'
  const score = Number(rawScore)
  if (!Number.isFinite(score) || score < 0 || score > maximum) return `Enter a score from 0 to ${maximum}.`
  return ''
}

function apiRowToDraft(row: ScoreSheetResponse['rows'][number], data: RouteData): ScoreDraft {
  const user = data.users.find((candidate) => candidate.id === row.student)
  const displayName = user ? [user.last_name, user.first_name].filter(Boolean).join(', ') || row.student_name : row.student_name
  const saved = row.score_id == null ? null : { rawScore: row.raw_score ?? '', remarks: row.remarks, status: row.status }
  return { isActive: row.is_active, rawScore: saved?.rawScore ?? '', remarks: saved?.remarks ?? '', saved, scoreId: row.score_id, status: saved?.status ?? 'GRADED', student: row.student, studentName: displayName, studentNumber: row.student_number }
}

function applySavedScore(draft: ScoreDraft, response: SavedScoreResponse): ScoreDraft {
  const saved = { rawScore: response.raw_score ?? '', remarks: response.remarks, status: response.status }
  return { ...draft, rawScore: saved.rawScore, remarks: saved.remarks, saved, scoreId: response.id, status: saved.status }
}

function canonicalDraft(draft: ScoreDraft): ScoreDraft {
  if (!draft.saved) return { ...draft, rawScore: '', remarks: '', scoreId: null, status: 'GRADED' }
  return { ...draft, rawScore: draft.saved.rawScore, remarks: draft.saved.remarks, status: draft.saved.status }
}

function firstPendingIndex(drafts: ScoreDraft[]) {
  const index = drafts.filter((draft) => draft.isActive).findIndex((draft) => !draft.saved)
  return index >= 0 ? index : 0
}

function findNextPending(drafts: ScoreDraft[], currentIndex: number) {
  for (let offset = 1; offset <= drafts.length; offset += 1) {
    const index = (currentIndex + offset) % drafts.length
    if (!drafts[index].saved) return index
  }
  return -1
}

function studentNameLength(name: string) {
  const length = Array.from(name).length
  if (length <= 16) return 'short'
  if (length <= 24) return 'medium'
  if (length <= 32) return 'long'
  return 'extra-long'
}

function todayInputValue() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
