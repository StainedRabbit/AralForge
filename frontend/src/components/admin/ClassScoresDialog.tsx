import { fullName } from '../../utils/student'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
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
type ScoreSaveOperation = {
  index: number
  itemId: number
  next: ScoreDraft
  previous: ScoreDraft
  student: number
}
type ScoreSheetEditDraft = {
  categoryId: string
  date: string
  period: (typeof periods)[number]
  pointsPossible: string
  title: string
}
type DeleteConfirmation =
  | { kind: 'score'; student: number; studentName: string }
  | { kind: 'sheet' }

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
  const [excuseOpen, setExcuseOpen] = useState(false)
  const [excuseReason, setExcuseReason] = useState('')
  const [excuseError, setExcuseError] = useState('')
  const [lastChange, setLastChange] = useState<ScoreChange | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingSaveCount, setPendingSaveCount] = useState(0)
  const [closeRequested, setCloseRequested] = useState(false)
  const [message, setMessage] = useState('')
  const [sheetQuery, setSheetQuery] = useState('')
  const [editDraft, setEditDraft] = useState<ScoreSheetEditDraft | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const scoreQueueRef = useRef<ScoreSaveOperation[]>([])
  const processingScoresRef = useRef(false)
  const closeRequestedRef = useRef(false)
  const confirmedLastChangeRef = useRef<ScoreChange | null>(null)

  const categories = data.gradeCategories.filter((category) =>
    category.subject === schedule.subject &&
    category.grading_period === period &&
    category.category !== 'ATTENDANCE')
  const selectedCategory = categories.find((category) => category.id === Number(categoryId)) ?? categories[0] ?? null
  const scoreSheets = useMemo(() => {
    const items = activeItem
      ? [activeItem, ...data.gradeItems.filter((item) => item.id !== activeItem.id)]
      : data.gradeItems
    return items
      .filter((item) => item.schedule === schedule.id && item.source_type === 'MANUAL')
      .sort((left, right) =>
        (right.date ?? right.created_at.slice(0, 10)).localeCompare(left.date ?? left.created_at.slice(0, 10)) || right.id - left.id)
  }, [activeItem, data.gradeItems, schedule.id])
  const filteredScoreSheets = useMemo(() => scoreSheets.filter((item) => {
    const category = data.gradeCategories.find((candidate) => candidate.id === item.grade_category)
    const itemDate = item.date ?? item.created_at.slice(0, 10)
    return matchesSearch([
      item.title,
      category?.name,
      category?.category,
      category?.grading_period,
      category ? periodLabels[category.grading_period as keyof typeof periodLabels] : '',
      itemDate,
      formatDate(itemDate),
      item.points_possible,
      `${numeric(item.points_possible)} points`,
    ].filter(Boolean).join(' '), sheetQuery)
  }), [data.gradeCategories, scoreSheets, sheetQuery])
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
  const activeCategory = activeItem
    ? data.gradeCategories.find((category) => category.id === activeItem.grade_category) ?? null
    : null
  const progressPercent = activeDrafts.length ? Math.round((savedCount / activeDrafts.length) * 100) : 0
  const editCategories = editDraft ? data.gradeCategories.filter((category) =>
    category.subject === schedule.subject &&
    category.grading_period === editDraft.period &&
    category.category !== 'ATTENDANCE') : []
  const selectedEditCategory = editDraft
    ? editCategories.find((category) => category.id === Number(editDraft.categoryId)) ?? editCategories[0] ?? null
    : null
  const highestSavedScore = drafts.reduce((highest, draft) =>
    draft.saved?.status === 'GRADED' ? Math.max(highest, numeric(draft.saved.rawScore)) : highest, 0)
  const editMaximumError = editDraft && numeric(editDraft.pointsPossible) < highestSavedScore
    ? `Maximum score must be at least ${highestSavedScore}.`
    : ''

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (tab === 'enter' && activeItem && currentStudentId != null && !showSummary && !excuseOpen && !editDraft && !deleteConfirmation && !closeRequested) scoreInputRef.current?.focus()
  }, [activeItem, closeRequested, currentStudentId, deleteConfirmation, editDraft, excuseOpen, showSummary, tab])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (deleteConfirmation) {
          setDeleteConfirmation(null)
        } else if (editDraft) {
          setEditDraft(null)
          setMessage('')
        } else if (excuseOpen) {
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
      if (!activeItem || showSummary || saving || closeRequested || excuseOpen || editDraft || deleteConfirmation) return
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault()
        moveToStudent(currentIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        void advance()
      } else if (event.key.toLowerCase() === 'u' && lastChange && !pendingSaveCount) {
        event.preventDefault()
        void undoLastScore()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  function finishClose() {
    closeRequestedRef.current = false
    setCloseRequested(false)
    onClose()
    if (activeItem) void refresh().catch(() => undefined)
  }

  function closeDialog() {
    if (saving) return
    if (pendingSaveCount) {
      closeRequestedRef.current = true
      setCloseRequested(true)
      return
    }
    finishClose()
  }

  function clearEntry() {
    if (pendingSaveCount || closeRequested) return
    scoreQueueRef.current = []
    processingScoresRef.current = false
    closeRequestedRef.current = false
    setPendingSaveCount(0)
    setCloseRequested(false)
    setActiveItem(null)
    setDrafts([])
    setCurrentIndex(0)
    setShowSummary(false)
    setLastChange(null)
    confirmedLastChangeRef.current = null
    setEditDraft(null)
    setDeleteConfirmation(null)
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
      setLastChange(null)
      confirmedLastChangeRef.current = null
      setEditDraft(null)
      setDeleteConfirmation(null)
      setMessage('Score sheet started. Scores save as you record them.')
      void refresh().catch(() => undefined)
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function openSheet(item: GradeItem) {
    if (pendingSaveCount || closeRequested) return
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
      setLastChange(null)
      confirmedLastChangeRef.current = null
      setEditDraft(null)
      setDeleteConfirmation(null)
      setTab('enter')
      setMessage(pendingIndex >= 0 ? 'Continuing at the first pending student.' : 'Reviewing this completed score sheet.')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function startEditingSheet() {
    if (!activeItem || pendingSaveCount || closeRequested) return
    const category = data.gradeCategories.find((candidate) => candidate.id === activeItem.grade_category)
    setEditDraft({
      categoryId: String(activeItem.grade_category),
      date: activeItem.date ?? activeItem.created_at.slice(0, 10),
      period: category?.grading_period ?? 'PRELIM',
      pointsPossible: activeItem.points_possible,
      title: activeItem.title,
    })
    setMessage('')
  }

  async function saveSheetEdits() {
    if (
      !activeItem || !editDraft || !selectedEditCategory || saving || pendingSaveCount || closeRequested ||
      !editDraft.title.trim() || !editDraft.date || numeric(editDraft.pointsPossible) <= 0 ||
      editMaximumError
    ) return
    setSaving(true)
    setMessage('')
    try {
      const response = await api<ScoreSheetResponse>(`/grades/items/${activeItem.id}/score-sheet/`, {
        body: JSON.stringify({
          date: editDraft.date,
          grade_category: selectedEditCategory.id,
          points_possible: editDraft.pointsPossible,
          title: editDraft.title.trim(),
        }),
        method: 'PATCH',
      })
      const currentStudent = currentDraft?.student ?? null
      const nextDrafts = response.rows.map((row) => apiRowToDraft(row, data))
      const nextActiveDrafts = nextDrafts.filter((draft) => draft.isActive)
      const nextIndex = currentStudent == null
        ? firstPendingIndex(nextDrafts)
        : Math.max(nextActiveDrafts.findIndex((draft) => draft.student === currentStudent), 0)
      setActiveItem(response.item)
      setDrafts(nextDrafts)
      setCurrentIndex(nextIndex)
      setPeriod(editDraft.period)
      setCategoryId(String(response.item.grade_category))
      setSheetDate(response.item.date ?? editDraft.date)
      setTitle(response.item.title)
      setPointsPossible(response.item.points_possible)
      setEditDraft(null)
      setMessage('Activity details updated. Saved student results were retained.')
      void refresh().catch(() => undefined)
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function clearSavedScore(studentId: number) {
    if (!activeItem || saving || pendingSaveCount || closeRequested) return
    const target = drafts.find((draft) => draft.student === studentId)
    const targetIndex = activeDrafts.findIndex((draft) => draft.student === studentId)
    if (!target?.saved || targetIndex < 0) return
    const previous = canonicalDraft(target)
    setSaving(true)
    setMessage('')
    try {
      await api(`/grades/items/${activeItem.id}/mark/`, {
        body: JSON.stringify({ student: studentId }),
        method: 'DELETE',
      })
      setDrafts((current) => current.map((draft) => draft.student === studentId ? {
        ...draft,
        rawScore: '',
        remarks: '',
        saved: null,
        scoreId: null,
        status: 'GRADED',
      } : draft))
      setCurrentIndex(targetIndex)
      setShowSummary(false)
      const change = { index: targetIndex, previous, student: studentId }
      setLastChange(change)
      confirmedLastChangeRef.current = change
      setDeleteConfirmation(null)
      setMessage(`${target.studentName}'s saved result was cleared.`)
    } catch (error) {
      setDeleteConfirmation(null)
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSheet() {
    if (!activeItem || saving || pendingSaveCount || closeRequested) return
    const deletedTitle = activeItem.title
    setSaving(true)
    setMessage('')
    try {
      await api(`/grades/items/${activeItem.id}/score-sheet/`, { method: 'DELETE' })
      await refresh()
      clearEntry()
      setTab('sheets')
      setMessage(`${deletedTitle} was permanently deleted.`)
    } catch (error) {
      setDeleteConfirmation(null)
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function updateCurrent(changes: Partial<ScoreDraft>) {
    if (!currentDraft || closeRequested) return
    setDrafts((current) => current.map((draft) =>
      draft.student === currentDraft.student ? { ...draft, ...changes } : draft))
    setMessage('')
  }

  async function processScoreQueue() {
    if (processingScoresRef.current) return
    processingScoresRef.current = true

    while (scoreQueueRef.current.length) {
      const operation = scoreQueueRef.current[0]
      const saved = operation.next.saved

      if (!saved) {
        scoreQueueRef.current.shift()
        setPendingSaveCount(scoreQueueRef.current.length)
        continue
      }

      try {
        await api<SavedScoreResponse>(`/grades/items/${operation.itemId}/mark/`, {
          body: JSON.stringify({
            raw_score: saved.status === 'EXCUSED' ? null : saved.rawScore,
            remarks: saved.remarks,
            status: saved.status,
            student: operation.student,
          }),
          method: 'PUT',
        })
        scoreQueueRef.current.shift()
        confirmedLastChangeRef.current = {
          index: operation.index,
          previous: operation.previous,
          student: operation.student,
        }
        setPendingSaveCount(scoreQueueRef.current.length)
      } catch (error) {
        const rollbackOperations = [...scoreQueueRef.current]
        scoreQueueRef.current = []
        processingScoresRef.current = false
        closeRequestedRef.current = false
        setCloseRequested(false)
        setPendingSaveCount(0)
        setDrafts((current) => {
          let rolledBack = current
          for (const queued of rollbackOperations.reverse()) {
            rolledBack = rolledBack.map((draft) =>
              draft.student === queued.student ? queued.previous : draft)
          }
          return rolledBack
        })
        setCurrentIndex(operation.index)
        setShowSummary(false)
        setExcuseOpen(false)
        setExcuseError('')
        setLastChange(confirmedLastChangeRef.current)
        setMessage(toErrorMessage(error))
        window.requestAnimationFrame(() => scoreInputRef.current?.focus())
        return
      }
    }

    processingScoresRef.current = false
    setLastChange(confirmedLastChangeRef.current)
    if (closeRequestedRef.current) finishClose()
  }

  function saveCurrent(status: ScoreStatus, rawScore: string, remarks: string) {
    if (!activeItem || !currentDraft || saving || closeRequested) return
    const error = scoreValueError(status, rawScore, remarks, maximum)
    if (error) {
      if (status === 'EXCUSED') setExcuseError(error)
      else setMessage(error)
      return
    }
    const previous = canonicalDraft(currentDraft)
    const saved: SavedScore = {
      rawScore: status === 'EXCUSED' ? '' : rawScore,
      remarks,
      status,
    }
    const nextDraft: ScoreDraft = {
      ...currentDraft,
      rawScore: saved.rawScore,
      remarks: saved.remarks,
      saved,
      status: saved.status,
    }
    const nextDrafts = drafts.map((draft) =>
      draft.student === nextDraft.student ? nextDraft : draft)
    const nextActiveDrafts = nextDrafts.filter((draft) => draft.isActive)
    const changedIndex = currentIndex

    setMessage('')
    setDrafts(nextDrafts)
    setExcuseOpen(false)
    setExcuseError('')

    scoreQueueRef.current.push({
      index: changedIndex,
      itemId: activeItem.id,
      next: nextDraft,
      previous,
      student: currentDraft.student,
    })
    setPendingSaveCount(scoreQueueRef.current.length)

    const nextIndex = findNextPending(nextActiveDrafts, changedIndex)
    if (nextIndex < 0) {
      setShowSummary(true)
      setMessage('Score sheet complete. Every active student has a recorded result.')
    } else {
      setCurrentIndex(nextIndex)
      setMessage(`${currentDraft.studentName} recorded.`)
    }

    void processScoreQueue()
  }

  async function undoLastScore() {
    if (!activeItem || !lastChange || saving || pendingSaveCount || closeRequested) return
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
      setLastChange(null)
      confirmedLastChangeRef.current = null
      setMessage('Last score action undone.')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function moveToStudent(index: number) {
    if (closeRequested) return
    setCurrentIndex(index)
    setExcuseOpen(false)
    setExcuseError('')
    setMessage('')
  }

  function jumpToStudent(studentId: number) {
    if (closeRequested) return
    const index = activeDrafts.findIndex((draft) => draft.student === studentId)
    if (index < 0) return
    moveToStudent(index)
    window.requestAnimationFrame(() => scoreInputRef.current?.focus())
  }

  async function advance() {
    if (!currentDraft || closeRequested) return
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
    if (!currentDraft || closeRequested) return
    setExcuseReason(currentDraft.saved?.status === 'EXCUSED' ? currentDraft.saved.remarks : '')
    setExcuseError('')
    setExcuseOpen(true)
  }

  const currentError = currentDraft
    ? scoreValueError('GRADED', currentDraft.rawScore, currentDraft.remarks, maximum)
    : ''

  return (
    <div aria-labelledby="class-scores-title" aria-modal="true" className="attendance-modal" role="dialog">
      <button aria-label="Dismiss scores" className="attendance-modal__backdrop" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={closeDialog} type="button" />
      <div className="attendance-modal__panel attendance-modal__panel--wide class-score-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="attendance-modal__header">
          <div>
            <strong id="class-scores-title">Class scores</strong>
            <span>{schedule.subject_code} {schedule.section || 'No section'} - {schedule.term_name}</span>
          </div>
          <button aria-label="Close scores" className="icon-button" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={closeDialog} type="button"><Icon name="close" /></button>
        </div>

        <div aria-label="Score views" className="class-attendance-dialog__tabs" role="tablist">
          <button aria-controls="score-entry-panel" aria-selected={tab === 'enter'} className={tab === 'enter' ? 'active' : ''} disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={() => setTab('enter')} role="tab" type="button">Enter scores</button>
          <button aria-controls="score-sheets-panel" aria-selected={tab === 'sheets'} className={tab === 'sheets' ? 'active' : ''} disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={() => setTab('sheets')} role="tab" type="button">Score sheets</button>
        </div>

        <div hidden={tab !== 'enter'} id="score-entry-panel" role="tabpanel">
          {editDraft && activeItem ? (
            <div className="class-score-setup">
              <div className="class-score-setup__intro">
                <span className="class-score-setup__icon"><Icon name="edit" /></span>
                <div><p className="eyebrow">Edit score sheet</p><h2>Edit the activity</h2><p>Saved student results will stay with this activity.</p></div>
              </div>
              {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}
              <div className="class-score-setup__fields">
                <label className="admin-field class-score-setup__title"><span>Activity title</span><input aria-label="Edit activity title" disabled={saving} onChange={(event) => setEditDraft((current) => current ? { ...current, title: event.target.value } : current)} required value={editDraft.title} /></label>
                <label className="admin-field"><span>Maximum score</span><input aria-describedby={editMaximumError ? 'edit-maximum-error' : undefined} aria-invalid={Boolean(editMaximumError)} aria-label="Edit maximum score" disabled={saving} min="0.01" onChange={(event) => setEditDraft((current) => current ? { ...current, pointsPossible: event.target.value } : current)} required step="0.01" type="number" value={editDraft.pointsPossible} />{editMaximumError ? <small className="class-score-field-error" id="edit-maximum-error">{editMaximumError}</small> : null}</label>
                <label className="admin-field"><span>Date</span><input aria-label="Edit activity date" disabled={saving} onChange={(event) => setEditDraft((current) => current ? { ...current, date: event.target.value } : current)} required type="date" value={editDraft.date} /></label>
                <label className="admin-field"><span>Grading period</span><select aria-label="Edit grading period" disabled={saving} onChange={(event) => setEditDraft((current) => current ? { ...current, categoryId: '', period: event.target.value as ScoreSheetEditDraft['period'] } : current)} value={editDraft.period}>{periods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></label>
                <label className="admin-field class-score-setup__category"><span>Category</span><select aria-label="Edit category" disabled={saving || !editCategories.length} onChange={(event) => setEditDraft((current) => current ? { ...current, categoryId: event.target.value } : current)} value={selectedEditCategory?.id ?? ''}>{editCategories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.category})</option>)}</select></label>
              </div>
              {!editCategories.length ? <p className="admin-message class-score-setup__guidance">No non-attendance categories are configured for {periodLabels[editDraft.period]}. <Link to="/admin/grades">Configure grade categories</Link>.</p> : null}
              <div className="class-score-setup__footer"><span><Icon name="users" /> {drafts.filter((draft) => draft.saved).length} saved result{drafts.filter((draft) => draft.saved).length === 1 ? '' : 's'} retained</span><div className="class-score-edit-actions"><button className="button button--secondary" disabled={saving} onClick={() => { setEditDraft(null); setMessage('') }} type="button">Cancel</button><button className="button button--primary" disabled={saving || !selectedEditCategory || !editDraft.title.trim() || !editDraft.date || numeric(editDraft.pointsPossible) <= 0 || Boolean(editMaximumError)} onClick={() => void saveSheetEdits()} type="button"><Icon name="save" /><span>{saving ? 'Saving...' : 'Save changes'}</span></button></div></div>
            </div>
          ) : !activeItem ? (
            <div className="class-score-setup">
              <div className="class-score-setup__intro">
                <span className="class-score-setup__icon"><Icon name="grade" /></span>
                <div><p className="eyebrow">New score sheet</p><h2>Set up the activity</h2><p>Add the details once, then score students one at a time.</p></div>
              </div>
              <div className="class-score-setup__fields">
                <label className="admin-field class-score-setup__title"><span>Activity title</span><input aria-label="Title" disabled={saving} onChange={(event) => setTitle(event.target.value)} placeholder="Quiz 1" required value={title} /></label>
                <label className="admin-field"><span>Maximum score</span><input disabled={saving} min="0.01" onChange={(event) => setPointsPossible(event.target.value)} required step="0.01" type="number" value={pointsPossible} /></label>
                <label className="admin-field"><span>Date</span><input disabled={saving} onChange={(event) => setSheetDate(event.target.value)} required type="date" value={sheetDate} /></label>
                <label className="admin-field"><span>Grading period</span><select disabled={saving} onChange={(event) => { setPeriod(event.target.value as typeof period); setCategoryId('') }} value={period}>{periods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></label>
                <label className="admin-field class-score-setup__category"><span>Category</span><select disabled={saving || !categories.length} onChange={(event) => setCategoryId(event.target.value)} value={selectedCategory?.id ?? ''}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.category})</option>)}</select></label>
              </div>
              {!categories.length ? <p className="admin-message class-score-setup__guidance">No non-attendance categories are configured for {periodLabels[period]}. <Link to="/admin/grades">Configure grade categories</Link>.</p> : null}
              <div className="class-score-setup__footer"><span><Icon name="users" /> {data.enrollments.filter((enrollment) => enrollment.schedule === schedule.id && enrollment.is_active).length} active students</span><button className="button button--primary" disabled={saving || !selectedCategory || !title.trim() || !sheetDate || numeric(pointsPossible) <= 0} onClick={() => void startNewSheet()} type="button"><Icon name="arrow-right" /><span>{saving ? 'Starting...' : 'Start scoring'}</span></button></div>
            </div>
          ) : showSummary ? (
            <ScoreCompletion closeRequested={closeRequested} excused={excusedCount} graded={gradedCount} inactiveDrafts={inactiveDrafts} message={message} onClose={closeDialog} onDelete={() => setDeleteConfirmation({ kind: 'sheet' })} onEdit={startEditingSheet} onReview={() => { setCurrentIndex(0); setShowSummary(false); setMessage('Reviewing scores from the first student.') }} onSheets={() => setTab('sheets')} onUndo={lastChange ? () => void undoLastScore() : undefined} pendingSaveCount={pendingSaveCount} saving={saving} total={activeDrafts.length} zeros={zeroCount} />
          ) : currentDraft ? (
            <div className="attendance-roll-call score-roll-call">
              {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}
              <div className="attendance-roll-call__runner">
                <section className="score-workspace-header">
                  <div className="class-score-sheet-heading">
                    <div><p className="eyebrow">Now scoring</p><h2>{activeItem.title}</h2><span>{formatDate(activeItem.date ?? sheetDate)} <i aria-hidden="true">·</i> {activeCategory?.name ?? 'Uncategorized'} <i aria-hidden="true">·</i> {maximum} points</span></div>
                    <div className="class-score-sheet-heading__actions">{lastChange ? <button className="button button--secondary button--compact" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={() => void undoLastScore()} type="button">Undo last</button> : null}<button className="button button--secondary button--compact" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={startEditingSheet} type="button"><Icon name="edit" /><span>Edit activity</span></button><button className="button button--secondary button--compact button--danger" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={() => setDeleteConfirmation({ kind: 'sheet' })} type="button"><Icon name="trash" /><span>Delete sheet</span></button><button className="button button--secondary button--compact" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={clearEntry} type="button"><Icon name="plus" /><span>New score sheet</span></button></div>
                  </div>
                  <div className="score-progress" role="progressbar" aria-label="Score sheet progress" aria-valuemax={activeDrafts.length} aria-valuemin={0} aria-valuenow={savedCount}>
                    <div><strong>{progressPercent}% complete</strong><span>{savedCount} of {activeDrafts.length} saved</span></div>
                    <span aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></span>
                  </div>
                  {pendingSaveCount ? <p aria-live="polite" className="admin-message">Saving {pendingSaveCount} score{pendingSaveCount === 1 ? '' : 's'}...</p> : null}
                  <div aria-label="Current score totals" className="score-stat-strip" role="group"><ScoreStat label="Saved" value={savedCount} tone="saved" /><ScoreStat label="Pending" value={pendingCount} tone="pending" /><ScoreStat label="Zero" value={zeroCount} tone="zero" /><ScoreStat label="Excused" value={excusedCount} tone="excused" /></div>
                </section>
                <StudentSearch currentStudentId={currentDraft.student} disabled={saving || closeRequested} onSelect={jumpToStudent} students={activeDrafts} />
                <div className="attendance-student-card score-student-card">
                  <div className="attendance-student-card__identity"><p className="eyebrow">Student {currentIndex + 1} of {activeDrafts.length}</p><h2 className={`attendance-student-card__name attendance-student-card__name--${studentNameLength(currentDraft.studentName)}`}>{currentDraft.studentName}</h2>{currentDraft.studentNumber ? <p>{currentDraft.studentNumber}</p> : null}</div>
                  {currentDraft.saved?.status === 'EXCUSED' ? <span className="attendance-status attendance-status--excused">Excused</span> : currentDraft.saved ? <span className="attendance-status score-status--saved">{currentDraft.saved.rawScore} / {maximum}</span> : <span className="attendance-status attendance-status--unmarked">Pending</span>}
                </div>

                {excuseOpen ? (
                  <div className="attendance-excuse-form">
                    <label className="admin-field" htmlFor={`score-excuse-${currentDraft.student}`}><span>Excuse reason</span><textarea aria-describedby={excuseError ? 'score-excuse-error' : undefined} aria-invalid={Boolean(excuseError)} autoFocus disabled={saving || closeRequested} id={`score-excuse-${currentDraft.student}`} onChange={(event) => { setExcuseReason(event.target.value); setExcuseError('') }} placeholder="Enter why this student is excused" rows={3} value={excuseReason} /></label>
                    {excuseError ? <small className="class-score-field-error" id="score-excuse-error">{excuseError}</small> : null}
                    <div className="attendance-excuse-form__actions"><button className="button button--secondary" disabled={saving || closeRequested} onClick={() => { setExcuseOpen(false); setExcuseError('') }} type="button">Cancel</button><button className="button button--primary" disabled={saving || closeRequested} onClick={() => saveCurrent('EXCUSED', '', excuseReason.trim())} type="button"><Icon name="save" /><span>Confirm excused</span></button></div>
                  </div>
                ) : (
                  <form className="score-entry-form" onSubmit={(event) => { event.preventDefault(); void saveCurrent('GRADED', currentDraft.rawScore, currentDraft.remarks) }}>
                    <label className="admin-field score-entry-form__score"><span>Score</span><span className="score-value-input"><input aria-describedby={currentError ? `score-error-${currentDraft.student}` : undefined} aria-invalid={Boolean(currentError && currentDraft.rawScore)} aria-label={`Score for ${currentDraft.studentName}`} disabled={saving || closeRequested} max={maximum} min="0" onChange={(event) => updateCurrent({ rawScore: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCurrent('GRADED', currentDraft.rawScore, currentDraft.remarks) } }} placeholder="0" ref={scoreInputRef} required step="0.01" type="number" value={currentDraft.rawScore} /><strong>/ {maximum}</strong></span></label>
                    <label className="admin-field score-entry-form__remarks"><span>Remarks <small>Optional</small></span><input aria-label={`Remarks for ${currentDraft.studentName}`} disabled={saving || closeRequested} maxLength={160} onChange={(event) => updateCurrent({ remarks: event.target.value })} placeholder="Add a short note" value={currentDraft.remarks} /></label>
                    {currentError && currentDraft.rawScore ? <small className="class-score-field-error score-entry-form__error" id={`score-error-${currentDraft.student}`}>{currentError}</small> : null}
                  </form>
                )}

                <p className="attendance-keyboard-hint">Keyboard: Enter Record score · ← Previous · → Next or Skip as 0 · U Undo</p>
                {inactiveDrafts.length ? <InactiveHistory drafts={inactiveDrafts} /> : null}
                {!excuseOpen ? <div className="score-runner-actions"><button aria-label="Previous student" className="button button--secondary" disabled={saving || closeRequested || currentIndex === 0} onClick={() => moveToStudent(currentIndex - 1)} type="button"><Icon name="arrow-left" /><span>Previous</span></button><button className="button button--secondary" disabled={saving || closeRequested} onClick={openExcuse} type="button"><Icon name="warning" /><span>Excused</span></button>{currentDraft.saved ? <button className="button button--secondary button--danger" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={() => setDeleteConfirmation({ kind: 'score', student: currentDraft.student, studentName: currentDraft.studentName })} type="button"><Icon name="trash" /><span>Clear score</span></button> : null}<button className="button button--primary" disabled={saving || closeRequested || Boolean(currentError)} onClick={() => saveCurrent('GRADED', currentDraft.rawScore, currentDraft.remarks)} type="button"><Icon name="save" /><span>{currentDraft.saved ? 'Update score' : 'Record score'}</span></button><button aria-label={currentDraft.saved ? 'Next student' : 'Skip as 0'} className="button button--secondary" disabled={saving || closeRequested} onClick={() => void advance()} type="button"><span>{currentDraft.saved ? 'Next' : 'Skip as 0'}</span><Icon name="arrow-right" /></button></div> : null}
              </div>
            </div>
          ) : <p className="admin-empty-line">No active students are available for this score sheet.</p>}
        </div>

        <div hidden={tab !== 'sheets'} id="score-sheets-panel" role="tabpanel">
          <div className="class-score-sheet-browser">
            <div className="class-score-sheet-browser__heading"><div><p className="eyebrow">Score sheet history</p><h2>Find and continue a sheet</h2></div><span>{filteredScoreSheets.length} of {scoreSheets.length}</span></div>
            <div className="score-search-field"><Icon name="search" /><input aria-label="Search score sheets" onChange={(event) => setSheetQuery(event.target.value)} placeholder="Search title, category, period, date, or points" type="search" value={sheetQuery} />{sheetQuery ? <button aria-label="Clear score sheet search" className="icon-button" onClick={() => setSheetQuery('')} type="button"><Icon name="close" /></button> : null}</div>
            <div className="class-score-sheet-list">
            {filteredScoreSheets.map((item) => {
              const category = data.gradeCategories.find((candidate) => candidate.id === item.grade_category)
              return <button disabled={saving || Boolean(pendingSaveCount) || closeRequested} key={item.id} onClick={() => void openSheet(item)} type="button"><span className="class-score-sheet-list__main"><strong>{item.title}</strong><span><small>{category?.name ?? 'Unknown category'}</small><small>{category ? periodLabels[category.grading_period as keyof typeof periodLabels] : 'Unknown period'}</small><small>{numeric(item.points_possible)} points</small></span></span><span className="class-score-sheet-list__date"><Icon name="calendar" />{item.date ? formatDate(item.date) : 'No date'}</span><Icon name="arrow-right" /></button>
            })}
            {!scoreSheets.length ? <p className="admin-empty-line">No manual score sheets for this class yet.</p> : null}
            {scoreSheets.length && !filteredScoreSheets.length ? <div className="class-score-search-empty"><Icon name="search" /><strong>No score sheets found</strong><span>Try a different title, category, period, date, or point value.</span><button className="button button--secondary button--compact" onClick={() => setSheetQuery('')} type="button">Clear search</button></div> : null}
            </div>
          </div>
        </div>

        {message && (tab === 'sheets' || !activeItem) ? <p aria-live="polite" className="admin-message">{message}</p> : null}
        {deleteConfirmation && activeItem ? <ScoreDeleteConfirmation confirmation={deleteConfirmation} savedCount={drafts.filter((draft) => draft.saved).length} saving={saving} sheetTitle={activeItem.title} onCancel={() => setDeleteConfirmation(null)} onConfirm={() => deleteConfirmation.kind === 'sheet' ? void deleteSheet() : void clearSavedScore(deleteConfirmation.student)} /> : null}
      </div>
    </div>
  )
}

function ScoreStat({ label, tone, value }: { label: string; tone: 'excused' | 'pending' | 'saved' | 'zero'; value: number }) {
  return <span className={`score-stat score-stat--${tone}`}><strong>{value}</strong><small>{label}</small></span>
}

function StudentSearch({ currentStudentId, disabled, onSelect, students }: {
  currentStudentId: number
  disabled: boolean
  onSelect: (studentId: number) => void
  students: ScoreDraft[]
}) {
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const results = useMemo(() => query.trim()
    ? students.filter((student) => matchesSearch(`${student.studentName} ${student.studentNumber}`, query))
    : [], [query, students])

  function chooseStudent(student: ScoreDraft) {
    setQuery('')
    setActiveIndex(-1)
    onSelect(student.student)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) {
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      setActiveIndex(-1)
      return
    }
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => current >= results.length - 1 ? 0 : current + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => current <= 0 ? results.length - 1 : current - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      chooseStudent(results[activeIndex >= 0 ? activeIndex : 0])
    }
  }

  return <div className="score-student-search">
    <div className="score-student-search__heading"><div><Icon name="users" /><span><strong>Find a student</strong><small>Jump without changing roster order</small></span></div>{query ? <span>{results.length} match{results.length === 1 ? '' : 'es'}</span> : null}</div>
    <div className="score-search-field"><Icon name="search" /><input aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `${listboxId}-${results[activeIndex].student}` : undefined} aria-autocomplete="list" aria-controls={query ? listboxId : undefined} aria-expanded={Boolean(query)} aria-label="Find a student" disabled={disabled} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1) }} onKeyDown={handleKeyDown} placeholder="Search name or student number" ref={inputRef} role="combobox" value={query} />{query ? <button aria-label="Clear student search" className="icon-button" disabled={disabled} onClick={() => { setQuery(''); setActiveIndex(-1); inputRef.current?.focus() }} type="button"><Icon name="close" /></button> : null}</div>
    {query ? <div className="score-student-search__results" id={listboxId} role="listbox">
      {results.map((student, index) => <button aria-selected={student.student === currentStudentId} className={index === activeIndex ? 'is-active' : ''} id={`${listboxId}-${student.student}`} key={student.student} onClick={() => chooseStudent(student)} role="option" type="button"><span><strong>{student.studentName}</strong><small>{student.studentNumber || 'No student number'}</small></span><span className={`score-search-status score-search-status--${scoreDraftStatus(student).toLowerCase()}`}>{scoreDraftStatus(student)}</span></button>)}
      {!results.length ? <div className="score-student-search__empty"><Icon name="search" /><span>No active students match “{query}”.</span></div> : null}
    </div> : null}
  </div>
}

function ScoreCompletion({ closeRequested, excused, graded, inactiveDrafts, message, onClose, onDelete, onEdit, onReview, onSheets, onUndo, pendingSaveCount, saving, total, zeros }: {
  closeRequested: boolean
  excused: number
  graded: number
  inactiveDrafts: ScoreDraft[]
  message: string
  onClose: () => void
  onDelete: () => void
  onEdit: () => void
  onReview: () => void
  onSheets: () => void
  onUndo?: () => void
  pendingSaveCount: number
  saving: boolean
  total: number
  zeros: number
}) {
  return <div className="attendance-roll-call score-roll-call"><div className="attendance-completion">
    <div className="attendance-completion__heading"><span className="attendance-completion__icon"><Icon name="check" /></span><div><p className="eyebrow">Score sheet complete</p><h2>{total} student{total === 1 ? '' : 's'} saved</h2><p>Every active student has a score or an approved excuse.</p></div></div>
    {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}
    <div aria-label="Score totals" className="attendance-breakdown__stats" role="group"><ScoreTotal label="Graded" value={graded} /><ScoreTotal label="Zero" value={zeros} /><ScoreTotal label="Excused" value={excused} /></div>
    {pendingSaveCount ? <p aria-live="polite" className="admin-message">Saving {pendingSaveCount} score{pendingSaveCount === 1 ? '' : 's'}...</p> : null}
    {inactiveDrafts.length ? <InactiveHistory drafts={inactiveDrafts} /> : null}
    <div className="class-modal-actions">{onUndo ? <button className="button button--secondary" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onUndo} type="button">Undo last</button> : null}<button className="button button--secondary" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onEdit} type="button"><Icon name="edit" /><span>Edit activity</span></button><button className="button button--secondary button--danger" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onDelete} type="button"><Icon name="trash" /><span>Delete sheet</span></button><button className="button button--secondary" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onReview} type="button">Review scores</button><button className="button button--secondary" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onSheets} type="button">Score sheets</button><button className="button button--primary" disabled={saving || Boolean(pendingSaveCount) || closeRequested} onClick={onClose} type="button">Close</button></div>
  </div></div>
}

function ScoreDeleteConfirmation({ confirmation, onCancel, onConfirm, savedCount, saving, sheetTitle }: {
  confirmation: DeleteConfirmation
  onCancel: () => void
  onConfirm: () => void
  savedCount: number
  saving: boolean
  sheetTitle: string
}) {
  const isSheet = confirmation.kind === 'sheet'
  return <div aria-describedby="score-delete-description" aria-labelledby="score-delete-title" aria-modal="true" className="class-score-discard" onKeyDown={(event) => { if (event.key === 'Escape' && !saving) { event.preventDefault(); event.stopPropagation(); onCancel() } }} role="alertdialog">
    <div>
      <strong id="score-delete-title">{isSheet ? 'Permanently delete this score sheet?' : `Clear ${confirmation.studentName}'s saved result?`}</strong>
      <span id="score-delete-description">{isSheet ? `${sheetTitle} and ${savedCount} saved student result${savedCount === 1 ? '' : 's'} will be permanently deleted.` : 'This student will return to Pending. You can restore the result immediately with Undo last.'}</span>
      <div className="class-modal-actions"><button autoFocus className="button button--secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button><button className="button button--danger" disabled={saving} onClick={onConfirm} type="button"><Icon name="trash" /><span>{saving ? 'Deleting...' : isSheet ? 'Delete permanently' : 'Clear score'}</span></button></div>
    </div>
  </div>
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

function scoreDraftStatus(draft: ScoreDraft) {
  if (!draft.saved) return 'Pending'
  return draft.saved.status === 'EXCUSED' ? 'Excused' : 'Graded'
}

function matchesSearch(value: string, query: string) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean)
  if (!tokens.length) return true
  const haystack = normalizeSearch(value)
  return tokens.every((token) => haystack.includes(token))
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function apiRowToDraft(row: ScoreSheetResponse['rows'][number], data: RouteData): ScoreDraft {
  const user = data.users.find((candidate) => candidate.id === row.student)
  const displayName = user ? fullName(user) : row.student_name
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
