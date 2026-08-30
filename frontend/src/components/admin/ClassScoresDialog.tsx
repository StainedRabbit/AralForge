import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { GradeItem, SubjectSchedule } from '../../types'
import { formatDate, numeric, toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'

const periods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
const periodLabels = { FINAL: 'Final', MIDTERM: 'Midterm', PREFINAL: 'Prefinal', PRELIM: 'Prelim' }

type ScoreStatus = 'GRADED' | 'EXCUSED'
type ScoreDraft = {
  isActive: boolean
  rawScore: string
  remarks: string
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

export function ClassScoresDialog({ api, data, onClose, refresh, schedule }: {
  api: AuthedRequest
  data: RouteData
  onClose: () => void
  refresh: () => Promise<void>
  schedule: SubjectSchedule
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const discardCancelRef = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<'enter' | 'sheets'>('enter')
  const [period, setPeriod] = useState<(typeof periods)[number]>('PRELIM')
  const [categoryId, setCategoryId] = useState('')
  const [sheetDate, setSheetDate] = useState(todayInputValue)
  const [title, setTitle] = useState('')
  const [pointsPossible, setPointsPossible] = useState('10')
  const [activeItem, setActiveItem] = useState<GradeItem | null>(null)
  const [drafts, setDrafts] = useState<ScoreDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discardTarget, setDiscardTarget] = useState<'close' | 'reset'>('close')
  const [message, setMessage] = useState('')

  const categories = data.gradeCategories.filter((category) =>
    category.subject === schedule.subject &&
    category.grading_period === period &&
    category.category !== 'ATTENDANCE')
  const selectedCategory = categories.find((category) => category.id === Number(categoryId)) ?? categories[0] ?? null
  const scoreSheets = useMemo(() => data.gradeItems
    .filter((item) => item.schedule === schedule.id && item.source_type === 'MANUAL')
    .sort((left, right) =>
      (right.date ?? right.created_at.slice(0, 10)).localeCompare(left.date ?? left.created_at.slice(0, 10)) || right.id - left.id),
  [data.gradeItems, schedule.id])
  const activeDrafts = drafts.filter((draft) => draft.isActive)
  const inactiveDrafts = drafts.filter((draft) => !draft.isActive)
  const excusedCount = activeDrafts.filter((draft) => draft.status === 'EXCUSED').length
  const completedCount = activeDrafts.length - excusedCount
  const zeroCount = activeDrafts.filter((draft) =>
    draft.status === 'GRADED' && (draft.rawScore.trim() === '' || Number(draft.rawScore) === 0)).length
  const maximum = numeric(activeItem?.points_possible ?? pointsPossible)
  const hasDraftErrors = activeDrafts.some((draft) => Boolean(scoreDraftError(draft, maximum)))

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (confirmDiscard) discardCancelRef.current?.focus()
  }, [confirmDiscard])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmDiscard) setConfirmDiscard(false)
        else requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
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
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  function requestClose() {
    if (dirty) {
      setDiscardTarget('close')
      setConfirmDiscard(true)
    }
    else onClose()
  }

  function clearEntry() {
    setActiveItem(null)
    setDrafts([])
    setTitle('')
    setPointsPossible('10')
    setSheetDate(todayInputValue())
    setDirty(false)
    setMessage('')
  }

  function discardChanges() {
    setConfirmDiscard(false)
    if (discardTarget === 'close') onClose()
    else clearEntry()
  }

  function startNewSheet() {
    if (!selectedCategory || !title.trim() || !sheetDate || numeric(pointsPossible) <= 0) return
    const rows = data.enrollments
      .filter((enrollment) => enrollment.schedule === schedule.id && enrollment.is_active)
      .sort((left, right) => left.student_name.localeCompare(right.student_name, undefined, { sensitivity: 'base' }))
      .map((enrollment): ScoreDraft => ({
        isActive: true,
        rawScore: '',
        remarks: '',
        status: 'GRADED',
        student: enrollment.student,
        studentName: enrollment.student_name,
        studentNumber: enrollment.student_number,
      }))
    setActiveItem(null)
    setDrafts(rows)
    setDirty(true)
    setMessage('Enter scores for the complete class roster. Blank scores will be saved as zero.')
  }

  async function openSheet(item: GradeItem) {
    setSaving(true)
    setMessage('')
    try {
      const response = await api<ScoreSheetResponse>(`/grades/items/${item.id}/roster/`)
      setActiveItem(response.item)
      setPeriod(data.gradeCategories.find((category) => category.id === item.grade_category)?.grading_period ?? 'PRELIM')
      setCategoryId(String(item.grade_category))
      setSheetDate(item.date ?? item.created_at.slice(0, 10))
      setTitle(item.title)
      setPointsPossible(item.points_possible)
      setDrafts(response.rows.map(apiRowToDraft))
      setDirty(false)
      setTab('enter')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function updateDraft(student: number, changes: Partial<ScoreDraft>) {
    setDrafts((current) => current.map((draft) =>
      draft.student === student ? { ...draft, ...changes } : draft))
    setDirty(true)
  }

  async function saveScores() {
    if (!drafts.length || (!activeItem && !selectedCategory)) return
    setSaving(true)
    setMessage('')
    const records = activeDrafts.map((draft) => ({
      raw_score: draft.status === 'EXCUSED' ? null : draft.rawScore,
      remarks: draft.remarks,
      status: draft.status,
      student: draft.student,
    }))
    try {
      const response = activeItem
        ? await api<ScoreSheetResponse>(`/grades/items/${activeItem.id}/roster/`, {
            body: JSON.stringify({ records }), method: 'PUT',
          })
        : await api<ScoreSheetResponse>('/grades/items/score-sheet/', {
            body: JSON.stringify({
              date: sheetDate,
              grade_category: selectedCategory!.id,
              points_possible: pointsPossible,
              records,
              schedule: schedule.id,
              title: title.trim(),
            }),
            method: 'POST',
          })
      setActiveItem(response.item)
      setDrafts(response.rows.map(apiRowToDraft))
      setDirty(false)
      setMessage(`Scores saved: ${response.counts.graded_count} graded, ${response.counts.zero_count} zero, ${response.counts.excused_count} excused.`)
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function resetEntry() {
    if (dirty) {
      setDiscardTarget('reset')
      setConfirmDiscard(true)
      return
    }
    clearEntry()
  }

  return (
    <div aria-labelledby="class-scores-title" aria-modal="true" className="attendance-modal" role="dialog">
      <div className="attendance-modal__backdrop" onClick={requestClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide class-score-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="attendance-modal__header">
          <div>
            <strong id="class-scores-title">Class scores</strong>
            <span>{schedule.subject_code} {schedule.section || 'No section'} - {schedule.term_name}</span>
          </div>
          <button aria-label="Close scores" className="icon-button" disabled={saving} onClick={requestClose} type="button"><Icon name="close" /></button>
        </div>

        <div aria-label="Score views" className="class-attendance-dialog__tabs" role="tablist">
          <button aria-controls="score-entry-panel" aria-selected={tab === 'enter'} className={tab === 'enter' ? 'active' : ''} onClick={() => setTab('enter')} role="tab" type="button">Enter scores</button>
          <button aria-controls="score-sheets-panel" aria-selected={tab === 'sheets'} className={tab === 'sheets' ? 'active' : ''} onClick={() => setTab('sheets')} role="tab" type="button">Score sheets</button>
        </div>

        <div hidden={tab !== 'enter'} id="score-entry-panel" role="tabpanel">
          {!drafts.length ? (
            <div className="class-score-setup">
              <label className="admin-field"><span>Date</span><input onChange={(event) => setSheetDate(event.target.value)} required type="date" value={sheetDate} /></label>
              <label className="admin-field"><span>Grading period</span><select onChange={(event) => { setPeriod(event.target.value as typeof period); setCategoryId('') }} value={period}>{periods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}</select></label>
              <label className="admin-field"><span>Category</span><select disabled={!categories.length} onChange={(event) => setCategoryId(event.target.value)} value={selectedCategory?.id ?? ''}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.category})</option>)}</select></label>
              <label className="admin-field"><span>Title</span><input onChange={(event) => setTitle(event.target.value)} placeholder="Quiz 1" required value={title} /></label>
              <label className="admin-field"><span>Maximum score</span><input min="0.01" onChange={(event) => setPointsPossible(event.target.value)} required step="0.01" type="number" value={pointsPossible} /></label>
              {!categories.length ? <p className="admin-message class-score-setup__guidance">No non-attendance categories are configured for {periodLabels[period]}. <Link to="/admin/grades">Configure grade categories</Link>.</p> : null}
              <button className="button button--primary" disabled={!selectedCategory || !title.trim() || !sheetDate || numeric(pointsPossible) <= 0} onClick={startNewSheet} type="button"><Icon name="grade" /><span>Start score sheet</span></button>
            </div>
          ) : (
            <>
              <div className="class-score-sheet-heading">
                <div><strong>{activeItem?.title ?? title}</strong><span>{formatDate(activeItem?.date ?? sheetDate)} - {numeric(activeItem?.points_possible ?? pointsPossible)} points</span></div>
                <button className="button button--secondary button--compact" disabled={saving} onClick={resetEntry} type="button"><Icon name="plus" /><span>New score sheet</span></button>
              </div>
              <div className="class-score-summary" aria-label="Score summary">
                <span><strong>{completedCount}</strong> Completed</span>
                <span className="is-zero"><strong>{zeroCount}</strong> Zero on save</span>
                <span><strong>{excusedCount}</strong> Excused</span>
              </div>
              <ScoreTable drafts={activeDrafts} maximum={maximum} onChange={updateDraft} saving={saving} />
              {inactiveDrafts.length ? <section className="class-score-history"><strong>Inactive student history</strong><ScoreTable drafts={inactiveDrafts} maximum={maximum} onChange={() => undefined} readOnly saving={saving} /></section> : null}
              <p className="class-score-zero-warning"><Icon name="warning" /><span>Blank scores will be recorded as zero when you save.</span></p>
              <div className="class-modal-actions"><button className="button button--secondary" disabled={saving} onClick={requestClose} type="button">Close</button><button className="button button--primary" disabled={saving || !activeDrafts.length || hasDraftErrors} onClick={() => void saveScores()} type="button"><Icon name="save" /><span>{saving ? 'Saving...' : 'Save scores'}</span></button></div>
            </>
          )}
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

        {message ? <p aria-live="polite" className="admin-message">{message}</p> : null}

        {confirmDiscard ? <div aria-labelledby="discard-scores-title" aria-modal="true" className="class-score-discard" role="alertdialog"><div><strong id="discard-scores-title">Discard unsaved scores?</strong><span>Your score changes will be lost.</span><div className="class-modal-actions"><button className="button button--secondary" onClick={() => setConfirmDiscard(false)} ref={discardCancelRef} type="button">Keep editing</button><button className="button button--danger" onClick={discardChanges} type="button">Discard changes</button></div></div></div> : null}
      </div>
    </div>
  )
}

function ScoreTable({ drafts, maximum, onChange, readOnly = false, saving }: {
  drafts: ScoreDraft[]
  maximum: number
  onChange: (student: number, changes: Partial<ScoreDraft>) => void
  readOnly?: boolean
  saving: boolean
}) {
  return <div className="table-wrap class-score-table-wrap"><table className="admin-table class-score-table mobile-card-table"><thead><tr><th>Student</th><th>Score</th><th>Status</th><th>Remarks / excuse reason</th></tr></thead><tbody>{drafts.map((draft) => {
    const error = readOnly ? '' : scoreDraftError(draft, maximum)
    return <tr key={draft.student}><td data-label="Student"><strong>{draft.studentName}</strong><span>{draft.studentNumber}</span></td><td data-label="Score"><input aria-describedby={error && draft.status === 'GRADED' ? `score-error-${draft.student}` : undefined} aria-invalid={Boolean(error && draft.status === 'GRADED')} aria-label={`Score for ${draft.studentName}`} disabled={readOnly || saving || draft.status === 'EXCUSED'} max={maximum} min="0" onChange={(event) => onChange(draft.student, { rawScore: event.target.value })} placeholder="0" step="0.01" type="number" value={draft.rawScore} />{error && draft.status === 'GRADED' ? <small className="class-score-field-error" id={`score-error-${draft.student}`}>{error}</small> : null}</td><td data-label="Status"><select aria-label={`Status for ${draft.studentName}`} disabled={readOnly || saving} onChange={(event) => onChange(draft.student, { status: event.target.value as ScoreStatus })} value={draft.status}><option value="GRADED">Graded</option><option value="EXCUSED">Excused</option></select></td><td data-label="Remarks"><input aria-describedby={error && draft.status === 'EXCUSED' ? `remarks-error-${draft.student}` : undefined} aria-invalid={Boolean(error && draft.status === 'EXCUSED')} aria-label={`Remarks for ${draft.studentName}`} disabled={readOnly || saving} onChange={(event) => onChange(draft.student, { remarks: event.target.value })} placeholder={draft.status === 'EXCUSED' ? 'Excuse reason required' : 'Optional remarks'} required={draft.status === 'EXCUSED'} value={draft.remarks} />{error && draft.status === 'EXCUSED' ? <small className="class-score-field-error" id={`remarks-error-${draft.student}`}>{error}</small> : null}</td></tr>
  })}</tbody></table></div>
}

function scoreDraftError(draft: ScoreDraft, maximum: number) {
  if (draft.status === 'EXCUSED') {
    return draft.remarks.trim() ? '' : 'Enter an excuse reason.'
  }
  if (!draft.rawScore.trim()) return ''
  const score = Number(draft.rawScore)
  if (!Number.isFinite(score) || score < 0 || score > maximum) {
    return `Enter a score from 0 to ${maximum}.`
  }
  return ''
}

function apiRowToDraft(row: ScoreSheetResponse['rows'][number]): ScoreDraft {
  return {
    isActive: row.is_active,
    rawScore: row.raw_score == null ? '' : String(row.raw_score),
    remarks: row.remarks,
    status: row.status,
    student: row.student,
    studentName: row.student_name,
    studentNumber: row.student_number,
  }
}

function todayInputValue() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
