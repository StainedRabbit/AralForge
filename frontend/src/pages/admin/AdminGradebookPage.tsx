import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  GradeItem,
  GradeItemSourceType,
  ApiPage,
  ModuleActivityAttempt,
  PaperActivityScoreBatchRequest,
  PaperActivityScoreBatchResult,
} from '../../types'
import { displayScore, numeric, toErrorMessage } from '../../utils/format'

const periods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
const sourceTypes: { label: string; value: GradeItemSourceType }[] = [
  { label: 'Manual', value: 'MANUAL' },
  { label: 'Module activity', value: 'MODULE_ACTIVITY' },
  { label: 'Attendance', value: 'ATTENDANCE' },
]

type ScoreDraft = Record<string, { rawScore: string; remarks: string }>
type GradebookViewMode = 'ITEM' | 'MATRIX'
type RosterFilter = 'ALL' | 'PENDING' | 'ONLINE' | 'PAPER' | 'EXCUSED' | 'OVERRIDDEN'
type RosterStatus = Exclude<RosterFilter, 'ALL'>
export type GradebookPaginationState = {
  count: number
  totalCount: number
  loaded: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  isRefreshing: boolean
  statusCounts?: Record<RosterStatus, number>
  loadMore: () => Promise<void>
  retry: () => Promise<void>
}
type PaperScoreTarget = {
  attemptId: number | null
  item: GradeItem
  notice?: string
  student: number
  studentName: string
}

export function AdminGradebookPage({
  api,
  data,
  pagination,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  pagination?: GradebookPaginationState
  refresh: () => Promise<void>
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [scheduleId, setScheduleId] = useState(() => searchParams.get('schedule') ?? data.schedules[0]?.id.toString() ?? '')
  const [focusedStudentId, setFocusedStudentId] = useState(() => searchParams.get('student') ?? '')
  const selectedSchedule = data.schedules.find((schedule) => schedule.id === Number(scheduleId)) ?? null
  const [period, setPeriod] = useState<(typeof periods)[number]>(() => {
    const requested = searchParams.get('period')
    return periods.includes(requested as (typeof periods)[number])
      ? requested as (typeof periods)[number]
      : 'PRELIM'
  })
  const categories = data.gradeCategories.filter(
    (category) =>
      selectedSchedule &&
      category.subject === selectedSchedule.subject &&
      category.grading_period === period,
  )
  const [categoryId, setCategoryId] = useState(() => searchParams.get('category') ?? '')
  const selectedCategory =
    categories.find((category) => category.id === Number(categoryId)) ?? categories[0] ?? null
  const items = data.gradeItems
    .filter((item) =>
      selectedCategory &&
      item.grade_category === selectedCategory.id &&
      item.schedule === selectedSchedule?.id,
    )
    .sort((left, right) => left.order - right.order || left.id - right.id)
  const [itemId, setItemId] = useState(() => searchParams.get('item') ?? '')
  const selectedItem = items.find((item) => item.id === Number(itemId)) ?? items[0] ?? null
  const roster = data.enrollments.filter(
    (enrollment) => selectedSchedule && enrollment.schedule === selectedSchedule.id && enrollment.is_active,
  )
  const focusedStudent = focusedStudentId
    ? roster.find((enrollment) => enrollment.student === Number(focusedStudentId)) ?? null
    : null
  const [studentQuery, setStudentQuery] = useState(() => searchParams.get('q') ?? '')
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>(() => {
    const requested = searchParams.get('filter')?.toUpperCase()
    return ['ALL', 'PENDING', 'ONLINE', 'PAPER', 'EXCUSED', 'OVERRIDDEN'].includes(requested ?? '')
      ? requested as RosterFilter
      : 'ALL'
  })
  const [viewMode, setViewMode] = useState<GradebookViewMode>('ITEM')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)
  const [editItemDraft, setEditItemDraft] = useState({
    order: '0',
    points: '100.00',
    title: '',
  })
  const [itemDraft, setItemDraft] = useState({
    order: '0',
    points: '100.00',
    sourceId: '',
    sourceType: 'MANUAL' as GradeItemSourceType,
    title: '',
  })
  const [sourceQuery, setSourceQuery] = useState('')
  const debouncedSourceQuery = useDebouncedValue(sourceQuery, 300)
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>({})
  const [paperScoreTarget, setPaperScoreTarget] = useState<PaperScoreTarget | null>(null)
  const [paperScoreMode, setPaperScoreMode] = useState(false)
  const [paperScoreDrafts, setPaperScoreDrafts] = useState<Record<string, string>>({})
  const [confirmPaperScoreDiscard, setConfirmPaperScoreDiscard] = useState(false)

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      setUrlValue(next, 'schedule', selectedSchedule?.id)
      setUrlValue(next, 'period', period)
      setUrlValue(next, 'category', selectedCategory?.id)
      setUrlValue(next, 'item', selectedItem?.id)
      setUrlValue(next, 'student', focusedStudent?.student)
      setUrlValue(next, 'filter', rosterFilter === 'ALL' ? null : rosterFilter)
      setUrlValue(next, 'q', studentQuery.trim() || null)
      return next
    }, { replace: true })
  }, [focusedStudent?.student, period, rosterFilter, selectedCategory?.id, selectedItem?.id, selectedSchedule?.id, setSearchParams, studentQuery])

  const sourceOptionQuery = useQuery({
    enabled: Boolean(selectedSchedule && itemDraft.sourceType !== 'MANUAL'),
    queryKey: ['grade-source-options', selectedSchedule?.id, itemDraft.sourceType, debouncedSourceQuery],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        schedule: String(selectedSchedule?.id ?? ''),
        type: itemDraft.sourceType,
        limit: '20',
      })
      if (debouncedSourceQuery.trim()) params.set('search', debouncedSourceQuery.trim())
      return api<ApiPage<{ value: number; label: string; points: string | number }>>(`/grades/source-options/?${params.toString()}`, { signal })
    },
    staleTime: 60_000,
  })
  const sourceOptions = (sourceOptionQuery.data?.results ?? []).map((option) => ({
    ...option,
    value: String(option.value),
  }))
  const visibleRoster = filterScoreRoster({
    data,
    filter: rosterFilter,
    item: selectedItem,
    query: studentQuery,
    roster,
    studentId: focusedStudent?.student ?? null,
  })
  const statusCounts = pagination?.statusCounts ?? getRosterStatusCounts(data, selectedItem, roster)
  const selectedActivity = data.activities.find(
    (activity) => activity.id === selectedItem?.module_activity,
  ) ?? null
  const supportsPaperScores = Boolean(
    selectedActivity?.activity_type === 'INTERACTIVE' && selectedActivity.lesson,
  )
  const hasPaperScoreDrafts = selectedItem
    ? Object.keys(paperScoreDrafts).some((key) => key.startsWith(`paper:${selectedItem.id}:`))
    : false
  const scoreDraftCount = Object.keys(scoreDraft).length
  const hasUnsavedScores = scoreDraftCount > 0 || hasPaperScoreDrafts

  useEffect(() => {
    if (!hasUnsavedScores) return
    const warnAboutUnsavedScores = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warnAboutUnsavedScores)
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedScores)
  }, [hasUnsavedScores])

  function changeScoreContext(change: () => void) {
    if (hasUnsavedScores && !window.confirm('Discard unsaved score changes and continue?')) return
    setScoreDraft({})
    if (selectedItem) {
      setPaperScoreDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`paper:${selectedItem.id}:`)),
      ))
    }
    setPaperScoreMode(false)
    change()
  }

  function togglePaperScoreMode() {
    if (!paperScoreMode) {
      setPaperScoreMode(true)
    } else if (hasPaperScoreDrafts) {
      setConfirmPaperScoreDiscard(true)
    } else {
      setPaperScoreMode(false)
    }
  }

  function discardPaperScoreDrafts() {
    if (selectedItem) {
      setPaperScoreDrafts((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`paper:${selectedItem.id}:`)),
      ))
    }
    setConfirmPaperScoreDiscard(false)
    setPaperScoreMode(false)
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedCategory) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const sourcePayload = getSourcePayload(itemDraft.sourceType, itemDraft.sourceId)
      const source = sourceOptions.find((option) => option.value === itemDraft.sourceId)

      const item = await api<GradeItem>('/grades/items/', {
        body: JSON.stringify({
          ...sourcePayload,
          grade_category: selectedCategory.id,
          schedule: selectedSchedule?.id,
          order: Number(itemDraft.order || 0),
          points_possible: itemDraft.sourceType === 'MANUAL' ? itemDraft.points : source?.points ?? itemDraft.points,
          source_type: itemDraft.sourceType,
          title: itemDraft.sourceType === 'MANUAL' ? itemDraft.title : source?.label ?? itemDraft.title,
        }),
        method: 'POST',
      })

      setItemId(String(item.id))
      setItemDraft({
        order: String(Number(itemDraft.order || 0) + 1),
        points: '100.00',
        sourceId: '',
        sourceType: itemDraft.sourceType,
        title: '',
      })
      setMessage('Grade item created.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function saveScores() {
    if (!selectedItem) {
      return
    }

    await saveScoreCells([selectedItem], roster)
  }

  async function savePaperScoreBatch() {
    if (!selectedItem || !supportsPaperScores) return
    const rows = roster.flatMap((enrollment) => {
      const value = paperScoreDrafts[paperScoreDraftKey(selectedItem.id, enrollment.student)]
      return value !== undefined && value.trim() !== ''
        ? [{ student: enrollment.student, score: value }]
        : []
    })
    if (!rows.length) {
      setMessage('Enter at least one paper score before saving.')
      return
    }
    const payload: PaperActivityScoreBatchRequest = {
      grade_item: selectedItem.id,
      scores: rows,
    }
    setSaving(true)
    setMessage('')
    try {
      const result = await api<PaperActivityScoreBatchResult>(
        '/modules/activity-attempts/paper-scores/',
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setPaperScoreDrafts((current) => {
        const next = { ...current }
        rows.forEach((row) => delete next[paperScoreDraftKey(selectedItem.id, row.student)])
        return next
      })
      setMessage(
        `Paper scores saved: ${result.created_count} new, ${result.updated_count} corrected.`,
      )
      await refresh()
    } catch (error) {
      setMessage(`No paper scores were changed. ${toErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function excuseScore(item: GradeItem, student: number) {
    const reason = window.prompt('Reason for excusing this required item:')?.trim()
    if (!reason) return
    setSaving(true)
    try {
      await api('/grades/item-scores/excuse/', {
        body: JSON.stringify({ grade_item: item.id, student, reason }), method: 'POST',
      })
      setMessage('Student excused from this item.')
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function overrideScore(scoreId: number, maximum: string) {
    const rawScore = window.prompt(`Override score (0-${numeric(maximum)}):`)
    if (rawScore === null) return
    const reason = window.prompt('Reason for overriding the synchronized score:')?.trim()
    if (!reason) return
    setSaving(true)
    try {
      await api(`/grades/item-scores/${scoreId}/override/`, {
        body: JSON.stringify({ raw_score: rawScore, reason }), method: 'POST',
      })
      setMessage('Automatic score overridden.')
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function clearOverride(scoreId: number) {
    setSaving(true)
    try {
      await api(`/grades/item-scores/${scoreId}/clear-override/`, { method: 'POST' })
      setMessage('Override cleared and source score resynchronized.')
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function resyncItem(item: GradeItem) {
    setSaving(true)
    try {
      await api(`/grades/items/${item.id}/resync/`, { method: 'POST' })
      setMessage('Linked scores resynchronized.')
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveMatrixScores() {
    await saveScoreCells(items, roster)
  }

  async function saveScoreCells(
    scoreItems: GradeItem[],
    rows: typeof visibleRoster,
  ) {
    if (!scoreItems.length || !rows.length) {
      return
    }

    const itemIds = new Set(scoreItems.map((item) => item.id))
    const studentIds = new Set(rows.map((row) => row.student))
    const dirtyKeys = Object.keys(scoreDraft).filter((key) => {
      const [item, student] = key.split(':').map(Number)
      return itemIds.has(item) && studentIds.has(student)
    })
    if (!dirtyKeys.length) {
      setMessage('No score changes to save.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await Promise.all(dirtyKeys.map((key) => {
        const [dirtyItemId, dirtyStudentId] = key.split(':').map(Number)
        const item = scoreItems.find((candidate) => candidate.id === dirtyItemId)
        const enrollment = rows.find((candidate) => candidate.student === dirtyStudentId)
        return item && enrollment ? saveScoreCell(item, enrollment) : Promise.resolve()
      }))

      setScoreDraft((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !dirtyKeys.includes(key)),
      ))
      setMessage(`${dirtyKeys.length} score change${dirtyKeys.length === 1 ? '' : 's'} saved.`)
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function saveScoreCell(item: GradeItem, enrollment: (typeof visibleRoster)[number]) {
    const key = scoreDraftKey(item.id, enrollment.student)
    const existing = findItemScore(data, item.id, enrollment.student)
    const draft = scoreDraft[key] ?? {
      rawScore: existing?.raw_score ?? '',
      remarks: existing?.remarks ?? '',
    }

    if (draft.rawScore.trim() === '') {
      return existing
        ? api(`/grades/item-scores/${existing.id}/`, { method: 'DELETE' })
        : Promise.resolve()
    }

    const payload = {
      grade_item: item.id,
      raw_score: draft.rawScore,
      remarks: draft.remarks,
      student: enrollment.student,
    }

    return api(existing ? `/grades/item-scores/${existing.id}/` : '/grades/item-scores/', {
      body: JSON.stringify(payload),
      method: existing ? 'PATCH' : 'POST',
    })
  }

  async function deleteItem(item: GradeItem) {
    if (!window.confirm('Delete this grade item and its scores?')) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await api(`/grades/items/${item.id}/`, { method: 'DELETE' })
      setItemId('')
      setMessage('Grade item deleted.')
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function startEditingItem(item: GradeItem) {
    setEditingItemId(item.id)
    setEditItemDraft({
      order: String(item.order),
      points: item.points_possible,
      title: item.title,
    })
    setMessage('')
  }

  function cancelEditingItem() {
    setEditingItemId(null)
    setEditItemDraft({
      order: '0',
      points: '100.00',
      title: '',
    })
  }

  async function updateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const item = items.find((candidate) => candidate.id === editingItemId)

    if (!item) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await api(`/grades/items/${item.id}/`, {
        body: JSON.stringify({
          order: Number(editItemDraft.order || 0),
          points_possible: item.source_type === 'MANUAL'
            ? editItemDraft.points
            : item.points_possible,
          title: editItemDraft.title,
        }),
        method: 'PATCH',
      })
      setMessage('Grade item updated.')
      cancelEditingItem()
      await refresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Grades"
        title="Gradebook"
        description="Create grade items, link source work, and record item scores for a class roster."
      />

      <section className="gradebook-workspace section-block">
        <SectionHeading
          subtitle={selectedSchedule ? `${selectedSchedule.subject_code} ${selectedSchedule.section || ''}` : 'Select a class'}
          title="Score Entry"
        />

        <div className="gradebook-controls">
          <label className="admin-field">
            <span>Class</span>
            <select
              onChange={(event) => {
                changeScoreContext(() => {
                  setFocusedStudentId('')
                  setScheduleId(event.target.value)
                })
              }}
              value={selectedSchedule?.id ?? ''}
            >
              {data.schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.subject_code} {schedule.section || ''} {schedule.term_name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Period</span>
            <select onChange={(event) => changeScoreContext(() => setPeriod(event.target.value as typeof period))} value={period}>
              {periods.map((item) => (
                <option key={item} value={item}>{periodLabel(item)}</option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Category</span>
            <select onChange={(event) => changeScoreContext(() => setCategoryId(event.target.value))} value={selectedCategory?.id ?? ''}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({numeric(category.weight).toFixed(2)}%)
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Student</span>
            <select
              onChange={(event) => changeScoreContext(() => setFocusedStudentId(event.target.value))}
              value={focusedStudent?.student ?? ''}
            >
              <option value="">Full roster</option>
              {roster.map((enrollment) => (
                <option key={enrollment.id} value={enrollment.student}>
                  {enrollment.student_name} {enrollment.student_number}
                </option>
              ))}
            </select>
          </label>
        </div>

        {focusedStudent ? (
          <div className="gradebook-focus-banner">
            <div>
              <strong>{focusedStudent.student_name}</strong>
              <span>{focusedStudent.student_number} - focused score entry</span>
            </div>
            <button
              className="button button--secondary button--compact"
              onClick={() => changeScoreContext(() => setFocusedStudentId(''))}
              type="button"
            >
              <Icon name="users" />
              <span>Show roster</span>
            </button>
          </div>
        ) : null}

        {!selectedSchedule ? <p className="admin-empty-line">No classes are available yet.</p> : null}
        {selectedSchedule && !categories.length ? (
          <p className="admin-empty-line">No grade categories are configured for this class and period yet.</p>
        ) : null}

        {selectedCategory ? (
          <div className="gradebook-grid">
            <div
              className="gradebook-panel"
              onKeyDown={(event) => {
                if (paperScoreMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void savePaperScoreBatch()
                }
              }}
            >
              <SectionHeading
                subtitle={`${items.length} item${items.length === 1 ? '' : 's'}`}
                title="Grade Items"
              />
              <form className="gradebook-item-form" onSubmit={createItem}>
                <label className="admin-field">
                  <span>Source</span>
                  <select
                    onChange={(event) =>
                      setItemDraft((current) => ({
                        ...current,
                        sourceId: '',
                        sourceType: event.target.value as GradeItemSourceType,
                      }))
                    }
                    value={itemDraft.sourceType}
                  >
                    {sourceTypes.map((source) => (
                      <option key={source.value} value={source.value}>{source.label}</option>
                    ))}
                  </select>
                </label>
                {itemDraft.sourceType === 'MANUAL' ? (
                  <label className="admin-field">
                    <span>Title</span>
                    <input
                      onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))}
                      required
                      value={itemDraft.title}
                    />
                  </label>
                ) : (
                  <>
                    <label className="admin-field">
                      <span>Find source</span>
                      <input onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search available sources" type="search" value={sourceQuery} />
                    </label>
                    <label className="admin-field">
                      <span>Source item</span>
                      <select
                        disabled={sourceOptionQuery.isPending}
                        onChange={(event) => setItemDraft((current) => ({ ...current, sourceId: event.target.value }))}
                        required
                        value={itemDraft.sourceId}
                      >
                        <option value="">{sourceOptionQuery.isPending ? 'Loading sources…' : 'Select'}</option>
                        {sourceOptions.map((source) => (
                          <option key={source.value} value={source.value}>
                            {source.label} ({numeric(source.points).toFixed(2)} pts)
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="admin-field">
                  <span>Points</span>
                  <input
                    disabled={itemDraft.sourceType !== 'MANUAL'}
                    onChange={(event) => setItemDraft((current) => ({ ...current, points: event.target.value }))}
                    required
                    type="number"
                    value={itemDraft.points}
                  />
                </label>
                <label className="admin-field">
                  <span>Order</span>
                  <input
                    onChange={(event) => setItemDraft((current) => ({ ...current, order: event.target.value }))}
                    type="number"
                    value={itemDraft.order}
                  />
                </label>
                <button className="button button--primary" disabled={saving} type="submit">
                  <Icon name="plus" />
                  <span>Create item</span>
                </button>
              </form>

              <div className="gradebook-item-list">
                {items.map((item) => (
                  <div
                    className={selectedItem?.id === item.id ? 'gradebook-item active' : 'gradebook-item'}
                    key={item.id}
                  >
                    <button
                      className="gradebook-item__select"
                      onClick={() => changeScoreContext(() => setItemId(String(item.id)))}
                      type="button"
                    >
                      <span>
                        <strong>{item.source_title || item.title}</strong>
                        <small>{sourceTypeLabel(item.source_type)} - {numeric(item.points_possible).toFixed(2)} pts</small>
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => startEditingItem(item)}
                      title="Edit grade item"
                      type="button"
                    >
                      <Icon name="edit" />
                    </button>
                  </div>
                ))}
                {!items.length ? <p className="admin-empty-line">No grade items yet.</p> : null}
              </div>

              {editingItemId ? (
                <form className="gradebook-edit-form" onSubmit={updateItem}>
                  <div className="admin-form__header">
                    <strong>Edit grade item</strong>
                    <button
                      className="button button--ghost button--compact"
                      onClick={cancelEditingItem}
                      type="button"
                    >
                      <Icon name="close" />
                      <span>Cancel</span>
                    </button>
                  </div>
                  <label className="admin-field">
                    <span>Title</span>
                    <input
                      onChange={(event) =>
                        setEditItemDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      required
                      value={editItemDraft.title}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Points</span>
                    <input
                      disabled={items.find((item) => item.id === editingItemId)?.source_type !== 'MANUAL'}
                      onChange={(event) =>
                        setEditItemDraft((current) => ({
                          ...current,
                          points: event.target.value,
                        }))
                      }
                      required
                      type="number"
                      value={editItemDraft.points}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Order</span>
                    <input
                      onChange={(event) =>
                        setEditItemDraft((current) => ({
                          ...current,
                          order: event.target.value,
                        }))
                      }
                      type="number"
                      value={editItemDraft.order}
                    />
                  </label>
                  {items.find((item) => item.id === editingItemId)?.source_type !== 'MANUAL' ? (
                    <p className="admin-message">
                      Points for source-linked items follow the original activity or attendance item.
                    </p>
                  ) : null}
                  <button className="button button--primary" disabled={saving} type="submit">
                    <Icon name="save" />
                    <span>{saving ? 'Saving...' : 'Save item'}</span>
                  </button>
                </form>
              ) : null}
            </div>

            <div className="gradebook-panel">
              <SectionHeading
                action={selectedItem ? (
                  <div className="admin-actions">
                    {selectedItem.source_type !== 'MANUAL' ? (
                      <button className="button button--secondary" disabled={saving} onClick={() => resyncItem(selectedItem)} type="button">
                        <span>Resync</span>
                      </button>
                    ) : null}
                    <button
                      className="button button--secondary roster-remove-button"
                      disabled={saving}
                      onClick={() => void deleteItem(selectedItem)}
                      type="button"
                    >
                      <Icon name="trash" />
                      <span>Remove item</span>
                    </button>
                  </div>
                ) : null}
                subtitle={selectedItem ? `${numeric(selectedItem.points_possible).toFixed(2)} points possible` : 'Select or create an item'}
                title={selectedItem ? selectedItem.source_title || selectedItem.title : 'Scores'}
              />

              <div className="segmented-control gradebook-view-toggle">
                <button
                  className={viewMode === 'ITEM' ? 'active' : ''}
                  onClick={() => setViewMode('ITEM')}
                  type="button"
                >
                  Single item
                </button>
                <button
                  className={viewMode === 'MATRIX' ? 'active' : ''}
                  onClick={() => setViewMode('MATRIX')}
                  type="button"
                >
                  Category grid
                </button>
              </div>

              {scoreDraftCount ? (
                <div className="gradebook-unsaved-banner" role="status">
                  <Icon name="warning" />
                  <span><strong>{scoreDraftCount} unsaved score edit{scoreDraftCount === 1 ? '' : 's'}</strong>Save before switching class, period, category, or item.</span>
                </div>
              ) : null}

              {viewMode === 'ITEM' && selectedItem ? (
                <>
                  <div className="gradebook-status-summary" aria-label="Submission summary">
                    {(['PENDING', 'ONLINE', 'PAPER', 'EXCUSED', 'OVERRIDDEN'] as Array<Exclude<RosterFilter, 'ALL'>>).map((status) => (
                      <button
                        className={rosterFilter === status ? 'gradebook-status-card active' : 'gradebook-status-card'}
                        key={status}
                        onClick={() => setRosterFilter(rosterFilter === status ? 'ALL' : status)}
                        type="button"
                      >
                        <strong>{statusCounts[status]}</strong>
                        <span>{rosterFilterLabel(status)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="gradebook-score-tools">
                    <label className="admin-search gradebook-student-search">
                      <Icon name="search" />
                      <input
                        disabled={Boolean(focusedStudent)}
                        onChange={(event) => setStudentQuery(event.target.value)}
                        placeholder="Search student or student number"
                        type="search"
                        value={studentQuery}
                      />
                    </label>
                    <div className="gradebook-filter-chips" aria-label="Filter roster by submission status">
                      {(['ALL', 'PENDING', 'ONLINE', 'PAPER', 'EXCUSED', 'OVERRIDDEN'] as RosterFilter[]).map((filter) => (
                        <button
                          aria-pressed={rosterFilter === filter}
                          className={rosterFilter === filter ? 'active' : ''}
                          key={filter}
                          onClick={() => setRosterFilter(filter)}
                          type="button"
                        >
                          {rosterFilterLabel(filter)}
                        </button>
                      ))}
                    </div>
                    {supportsPaperScores ? (
                      <button
                        aria-pressed={paperScoreMode}
                        className={paperScoreMode ? 'button button--primary button--compact' : 'button button--secondary button--compact'}
                        onClick={togglePaperScoreMode}
                        type="button"
                      >
                        <Icon name="edit" />
                        <span>{paperScoreMode ? 'Close paper score entry' : 'Enter paper scores'}</span>
                      </button>
                    ) : null}
                  </div>
                  {paperScoreMode ? (
                    <p className="admin-message">
                      Enter checked-paper scores below. Blank fields are unchanged; zero is a valid score.
                    </p>
                  ) : null}
                  <div className="table-wrap">
                    <table className="admin-table gradebook-score-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Submission</th>
                          {paperScoreMode ? <th>Paper score</th> : null}
                          <th>Score</th>
                          <th>Transmuted</th>
                          <th>Remarks</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRoster.map((enrollment) => {
                          const score = data.gradeItemScores.find(
                            (candidate) =>
                              candidate.grade_item === selectedItem.id &&
                              candidate.student === enrollment.student,
                          )
                          const key = scoreDraftKey(selectedItem.id, enrollment.student)
                          const draft = scoreDraft[key] ?? {
                            rawScore: score?.raw_score ?? '',
                            remarks: score?.remarks ?? '',
                          }
                          const linkedActivity = data.activities.find(
                            (activity) => activity.id === selectedItem.module_activity,
                          )
                          const activityId = linkedActivity?.id ?? null
                          const supportsPaperEntry = Boolean(
                            linkedActivity?.activity_type === 'INTERACTIVE' && linkedActivity.lesson,
                          )
                          const paperAttempt = activityId
                            ? data.activityAttempts.find(
                              (attempt) =>
                                attempt.activity === activityId &&
                                attempt.student === enrollment.student &&
                                attempt.submission_method === 'PAPER' &&
                                attempt.paper_grade_item === selectedItem.id,
                            )
                            : null
                          const submittedOnlineAttempt = activityId
                            ? data.activityAttempts.some(
                              (attempt) =>
                                attempt.activity === activityId &&
                                attempt.student === enrollment.student &&
                                attempt.submission_method === 'ONLINE' &&
                                attempt.is_submitted,
                            )
                            : false
                          const recordedBy = paperAttempt?.recorded_by
                            ? data.users.find((user) => user.id === paperAttempt.recorded_by)
                            : null
                          const submissionStatus = getRosterStatus(
                            data,
                            selectedItem,
                            enrollment.student,
                          )
                          const paperKey = paperScoreDraftKey(selectedItem.id, enrollment.student)
                          const paperScoreEligible = supportsPaperEntry &&
                            !submittedOnlineAttempt &&
                            (submissionStatus === 'PENDING' || submissionStatus === 'PAPER')

                          return (
                            <tr key={enrollment.id}>
                              <td>
                                <strong>{enrollment.student_name}</strong>
                                <span>{enrollment.student_number}</span>
                              </td>
                              <td>
                                <span className={`status-badge status-badge--${submissionStatus.toLowerCase()}`}>
                                  {rosterStatusLabel(submissionStatus)}
                                </span>
                                {paperAttempt && recordedBy ? (
                                  <small>
                                    Entered by {`${recordedBy.first_name} ${recordedBy.last_name}`.trim() || recordedBy.username}
                                  </small>
                                ) : null}
                              </td>
                              {paperScoreMode ? (
                                <td>
                                  <div className="paper-score-inline">
                                    <input
                                      aria-label={`Paper score for ${enrollment.student_name}`}
                                      className="gradebook-score-input"
                                      disabled={!paperScoreEligible || saving}
                                      max={numeric(selectedItem.points_possible)}
                                      min="0"
                                      onChange={(event) => setPaperScoreDrafts((current) => ({
                                        ...current,
                                        [paperKey]: event.target.value,
                                      }))}
                                      placeholder={paperScoreEligible ? 'Score' : 'Unavailable'}
                                      step="0.01"
                                      type="number"
                                      value={paperScoreDrafts[paperKey] ?? paperAttempt?.score ?? ''}
                                    />
                                    <small>/ {numeric(selectedItem.points_possible).toFixed(2)}</small>
                                  </div>
                                </td>
                              ) : null}
                              <td>
                                <input
                                  className="gradebook-score-input"
                                  max={numeric(selectedItem.points_possible)}
                                  min="0"
                                  disabled={selectedItem.source_type !== 'MANUAL' || score?.status === 'EXCUSED'}
                                  onChange={(event) =>
                                    setScoreDraft((current) => ({
                                      ...current,
                                      [key]: {
                                        ...draft,
                                        rawScore: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="-"
                                  type="number"
                                  value={draft.rawScore}
                                />
                              </td>
                              <td>{displayScore(score?.transmuted_grade ?? null)}</td>
                              <td>
                                <input
                                  className="gradebook-remarks-input"
                                  disabled={selectedItem.source_type !== 'MANUAL'}
                                  onChange={(event) =>
                                    setScoreDraft((current) => ({
                                      ...current,
                                      [key]: {
                                        ...draft,
                                        remarks: event.target.value,
                                      },
                                    }))
                                  }
                                  value={draft.remarks}
                                />
                              </td>
                              <td>
                                <div className="admin-actions admin-actions--compact">
                                  {score?.origin === 'AUTOMATIC' ? (
                                    <button disabled={saving} onClick={() => overrideScore(score.id, selectedItem.points_possible)} type="button">Override</button>
                                  ) : null}
                                  {score?.origin === 'OVERRIDE' ? (
                                    <button disabled={saving} onClick={() => clearOverride(score.id)} type="button">Clear override</button>
                                  ) : null}
                                  {score?.status !== 'EXCUSED' ? (
                                    <button disabled={saving} onClick={() => excuseScore(selectedItem, enrollment.student)} type="button">Excuse</button>
                                  ) : null}
                                  {supportsPaperEntry && paperAttempt ? (
                                    <button
                                      className="button button--primary button--compact"
                                      disabled={saving}
                                      onClick={() => setPaperScoreTarget({
                                        attemptId: paperAttempt.id,
                                        item: selectedItem,
                                        student: enrollment.student,
                                        studentName: enrollment.student_name,
                                      })}
                                      type="button"
                                    >
                                      Edit paper score
                                    </button>
                                  ) : null}
                                  {supportsPaperEntry && !paperAttempt && !submittedOnlineAttempt ? (
                                    <button
                                      className="button button--primary button--compact"
                                      disabled={saving}
                                      onClick={() => setPaperScoreTarget({
                                        attemptId: null,
                                        item: selectedItem,
                                        student: enrollment.student,
                                        studentName: enrollment.student_name,
                                      })}
                                      type="button"
                                    >
                                      Enter paper score
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {!roster.length ? (
                          <tr>
                            <td colSpan={paperScoreMode ? 7 : 6}>No active students in this class.</td>
                          </tr>
                        ) : null}
                        {roster.length && !visibleRoster.length ? (
                          <tr>
                            <td colSpan={paperScoreMode ? 7 : 6}>No students match the current score filters.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    {pagination ? <ProgressiveRosterFooter pagination={pagination} /> : null}
                  </div>
                  {paperScoreMode ? (
                    <button
                      className="button button--primary gradebook-save-button"
                      disabled={saving || !hasPaperScoreDrafts}
                      onClick={() => void savePaperScoreBatch()}
                      type="button"
                    >
                      <Icon name="save" />
                      <span>{saving ? 'Saving paper scores...' : 'Save paper scores'}</span>
                    </button>
                  ) : selectedItem.source_type === 'MANUAL' ? (
                    <button
                      className="button button--primary gradebook-save-button"
                      disabled={saving || !visibleRoster.length}
                      onClick={() => void saveScores()}
                      type="button"
                    >
                      <Icon name="save" />
                      <span>{saving ? 'Saving...' : `Save ${scoreDraftCount || ''} score change${scoreDraftCount === 1 ? '' : 's'}`}</span>
                    </button>
                  ) : null}
                </>
              ) : (
                null
              )}

              {viewMode === 'MATRIX' ? (
                <MatrixScorePanel
                  data={data}
                  dirtyCount={scoreDraftCount}
                  filter={rosterFilter}
                  items={items}
                  roster={roster}
                  saving={saving}
                  scoreDraft={scoreDraft}
                  selectedCategoryId={selectedCategory.id}
                  selectedScheduleId={selectedSchedule?.id ?? 0}
                  setFilter={setRosterFilter}
                  setScoreDraft={setScoreDraft}
                  setStudentQuery={setStudentQuery}
                  studentQuery={studentQuery}
                  visibleRoster={visibleRoster}
                  pagination={pagination}
                  onSave={() => void saveMatrixScores()}
                />
              ) : null}

              {message ? <p className="admin-message" role="status">{message}</p> : null}

              {viewMode === 'ITEM' && !selectedItem ? (
                <p className="admin-empty-line">Select or create a grade item to enter scores.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      {paperScoreTarget ? (
        <PaperActivityScoreDialog
          api={api}
          data={data}
          key={`${paperScoreTarget.item.id}:${paperScoreTarget.student}:${paperScoreTarget.attemptId ?? 'new'}`}
          onClose={() => setPaperScoreTarget(null)}
          onSaved={async (attempt) => {
            const wasCorrection = paperScoreTarget.attemptId !== null
            const scoreMessage = `${paperScoreTarget.studentName}: ${displayScore(attempt.score)} / ${displayScore(attempt.max_score)}`
            const next = wasCorrection
              ? null
              : findNextPendingPaperTarget(data, paperScoreTarget.item, paperScoreTarget.student)
            await refresh()
            if (wasCorrection) {
              setMessage(`Paper score corrected. ${scoreMessage}.`)
              setPaperScoreTarget(null)
            } else if (next) {
              setMessage(`Saved ${scoreMessage}. Opening the next pending student.`)
              setPaperScoreTarget({ ...next, notice: `Saved ${scoreMessage}. Next pending student:` })
            } else {
              setMessage(`Saved ${scoreMessage}. Paper entry complete: no pending students remain.`)
              setPaperScoreTarget(null)
            }
          }}
          target={paperScoreTarget}
        />
      ) : null}
      {confirmPaperScoreDiscard ? (
        <div aria-labelledby="discard-paper-batch-title" aria-modal="true" className="class-score-discard" role="alertdialog">
          <div>
            <strong id="discard-paper-batch-title">Discard unsaved paper scores?</strong>
            <span>Scores entered in the roster have not been saved.</span>
            <div className="class-modal-actions">
              <button className="button button--secondary" onClick={() => setConfirmPaperScoreDiscard(false)} type="button">Keep editing</button>
              <button className="button button--danger" onClick={discardPaperScoreDrafts} type="button">Discard scores</button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  )
}

function PaperActivityScoreDialog({
  api,
  data,
  onClose,
  onSaved,
  target,
}: {
  api: AuthedRequest
  data: RouteData
  onClose: () => void
  onSaved: (attempt: ModuleActivityAttempt) => Promise<void>
  target: PaperScoreTarget
}) {
  const activity = data.activities.find(
    (candidate) => candidate.id === target.item.module_activity,
  ) ?? null
  const existingAttempt = target.attemptId
    ? data.activityAttempts.find((attempt) => attempt.id === target.attemptId) ?? null
    : null
  const initialScore = existingAttempt?.score ?? ''
  const [score, setScore] = useState(initialScore)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const maxScore = numeric(target.item.points_possible)
  const enteredScore = score.trim() === '' ? null : Number(score)
  const percentage = enteredScore !== null && Number.isFinite(enteredScore) && maxScore > 0
    ? (enteredScore / maxScore) * 100
    : null

  function requestClose() {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  async function savePaperScore() {
    if (score.trim() === '') {
      setMessage('Enter the score from the checked paper. Zero is a valid score.')
      return
    }
    setSaving(true)
    setMessage('')

    try {
      let attempt: ModuleActivityAttempt
      if (target.attemptId) {
        attempt = await api<ModuleActivityAttempt>(
          `/modules/activity-attempts/${target.attemptId}/paper-score/`,
          { body: JSON.stringify({ score }), method: 'PUT' },
        )
      } else {
        const result = await api<PaperActivityScoreBatchResult>(
          '/modules/activity-attempts/paper-scores/',
          {
            body: JSON.stringify({
              grade_item: target.item.id,
              scores: [{ score, student: target.student }],
            } satisfies PaperActivityScoreBatchRequest),
            method: 'POST',
          },
        )
        attempt = result.attempts[0]
      }
      setDirty(false)
      await onSaved(attempt)
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div aria-labelledby="paper-score-title" aria-modal="true" className="attendance-modal" role="dialog">
      <div className="attendance-modal__backdrop" onClick={saving ? undefined : requestClose} />
      <form
        className="attendance-modal__panel paper-score-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (confirmDiscard) setConfirmDiscard(false)
            else requestClose()
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void savePaperScore()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void savePaperScore()
        }}
      >
        <div className="attendance-modal__header">
          <div>
            <strong id="paper-score-title">
              {target.attemptId ? 'Correct paper score' : 'Enter paper score'}
            </strong>
            <span>{target.studentName} · {activity?.title ?? target.item.title}</span>
          </div>
          <button aria-label="Close paper score" className="icon-button" disabled={saving} onClick={requestClose} type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className="paper-score-dialog__body">
          {target.notice ? <p className="admin-message" role="status">{target.notice} {target.studentName}</p> : null}
          <p>Enter the total from the checked printed copy. This records a paper submission against the same linked Main Activity.</p>
          <dl className="paper-score-dialog__context">
            <div><dt>Student</dt><dd>{target.studentName}</dd></div>
            <div><dt>Activity</dt><dd>{activity?.title ?? target.item.title}</dd></div>
            <div><dt>Maximum score</dt><dd>{formatNumber(maxScore)}</dd></div>
          </dl>
          <label className="admin-field paper-score-dialog__input">
            <span>Paper score</span>
            <input
              autoFocus
              max={maxScore}
              min="0"
              onChange={(event) => {
                setScore(event.target.value)
                setDirty(event.target.value !== initialScore)
                setMessage('')
              }}
              placeholder={`0 to ${formatNumber(maxScore)}`}
              step="0.01"
              type="number"
              value={score}
            />
          </label>
          <div aria-live="polite" className="paper-score-dialog__preview">
            <span>Calculated result</span>
            <strong>
              {enteredScore === null || !Number.isFinite(enteredScore)
                ? `— / ${formatNumber(maxScore)}`
                : `${formatNumber(enteredScore)} / ${formatNumber(maxScore)}`}
            </strong>
            <span>{percentage === null ? 'Enter a score to see the percentage.' : `${formatNumber(percentage)}%`}</span>
          </div>
          {message ? <p className="admin-message" role="alert">{message}</p> : null}
        </div>

        <div className="class-modal-actions">
          <span className="paper-score-shortcut">Ctrl/Cmd+S to save</span>
          <button className="button button--secondary" disabled={saving} onClick={requestClose} type="button">Cancel</button>
          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : target.attemptId ? 'Update paper score' : 'Save paper score'}</span>
          </button>
        </div>
        {confirmDiscard ? (
          <div aria-labelledby="discard-paper-title" aria-modal="true" className="class-score-discard" role="alertdialog">
            <div>
              <strong id="discard-paper-title">Discard unsaved paper score?</strong>
              <span>The score change for {target.studentName} will be lost.</span>
              <div className="class-modal-actions">
                <button className="button button--secondary" onClick={() => setConfirmDiscard(false)} type="button">Keep editing</button>
                <button className="button button--danger" onClick={onClose} type="button">Discard changes</button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  )
}

function MatrixScorePanel({
  data,
  dirtyCount,
  filter,
  items,
  onSave,
  pagination,
  roster,
  saving,
  scoreDraft,
  selectedCategoryId,
  selectedScheduleId,
  setFilter,
  setScoreDraft,
  setStudentQuery,
  studentQuery,
  visibleRoster,
}: {
  data: RouteData
  dirtyCount: number
  filter: RosterFilter
  items: GradeItem[]
  onSave: () => void
  pagination?: GradebookPaginationState
  roster: {
    id: number
    student: number
    student_name: string
    student_number: string
  }[]
  saving: boolean
  scoreDraft: ScoreDraft
  selectedCategoryId: number
  selectedScheduleId: number
  setFilter: (value: RosterFilter) => void
  setScoreDraft: Dispatch<SetStateAction<ScoreDraft>>
  setStudentQuery: (value: string) => void
  studentQuery: string
  visibleRoster: {
    id: number
    student: number
    student_name: string
    student_number: string
  }[]
}) {
  return (
    <>
      <div className="gradebook-score-tools">
        <label className="admin-search gradebook-student-search">
          <Icon name="search" />
          <input
            onChange={(event) => setStudentQuery(event.target.value)}
            placeholder="Search student or student number"
            type="search"
            value={studentQuery}
          />
        </label>
        <div className="gradebook-filter-chips" aria-label="Filter roster by submission status">
          {(['ALL', 'PENDING', 'ONLINE', 'PAPER', 'EXCUSED', 'OVERRIDDEN'] as RosterFilter[]).map((option) => (
            <button
              aria-pressed={filter === option}
              className={filter === option ? 'active' : ''}
              key={option}
              onClick={() => setFilter(option)}
              type="button"
            >
              {rosterFilterLabel(option)}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="admin-table gradebook-matrix-table">
          <thead>
            <tr>
              <th>Student</th>
              {items.map((item) => (
                <th key={item.id}>
                  <span>{item.source_title || item.title}</span>
                  <small>{numeric(item.points_possible).toFixed(2)} pts - {sourceTypeLabel(item.source_type)}</small>
                </th>
              ))}
              <th>Total</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {visibleRoster.map((enrollment) => {
              const categoryGrade = findCategoryGrade(
                data,
                selectedCategoryId,
                enrollment.student,
                selectedScheduleId,
              )

              return (
                <tr key={enrollment.id}>
                  <td>
                    <strong>{enrollment.student_name}</strong>
                    <span>{enrollment.student_number}</span>
                  </td>
                  {items.map((item) => {
                    const score = findItemScore(data, item.id, enrollment.student)
                    const key = scoreDraftKey(item.id, enrollment.student)
                    const draft = scoreDraft[key] ?? {
                      rawScore: score?.raw_score ?? '',
                      remarks: score?.remarks ?? '',
                    }

                    return (
                      <td key={item.id}>
                        <input
                          className="gradebook-score-input gradebook-score-input--matrix"
                          max={numeric(item.points_possible)}
                          min="0"
                          disabled={item.source_type !== 'MANUAL' || score?.status === 'EXCUSED'}
                          onChange={(event) =>
                            setScoreDraft((current) => ({
                              ...current,
                              [key]: {
                                ...draft,
                                rawScore: event.target.value,
                              },
                            }))
                          }
                          placeholder="-"
                          type="number"
                          value={draft.rawScore}
                        />
                      </td>
                    )
                  })}
                  <td>
                    {categoryGrade?.completion_status === 'COMPLETE'
                      ? `${numeric(categoryGrade.raw_score).toFixed(2)} / ${numeric(categoryGrade.total_score).toFixed(2)}`
                      : categoryGrade ? `Pending (${categoryGrade.pending_item_count})` : '-'}
                  </td>
                  <td>
                    {categoryGrade?.completion_status === 'COMPLETE'
                      ? `${displayScore(categoryGrade.transmuted_grade)} / ${displayScore(categoryGrade.weighted_score)}`
                      : '-'}
                  </td>
                </tr>
              )
            })}
            {!items.length ? (
              <tr>
                <td colSpan={3}>No grade items in this category yet.</td>
              </tr>
            ) : null}
            {items.length && !roster.length ? (
              <tr>
                <td colSpan={items.length + 3}>No active students in this class.</td>
              </tr>
            ) : null}
            {items.length && roster.length && !visibleRoster.length ? (
              <tr>
                <td colSpan={items.length + 3}>No students match the current score filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {pagination ? <ProgressiveRosterFooter pagination={pagination} /> : null}
      </div>
      <button
        className="button button--primary gradebook-save-button"
        disabled={saving || !items.length || !dirtyCount}
        onClick={onSave}
        type="button"
      >
        <Icon name="save" />
        <span>{saving ? 'Saving...' : `Save ${dirtyCount || ''} score change${dirtyCount === 1 ? '' : 's'}`}</span>
      </button>
    </>
  )
}

function ProgressiveRosterFooter({ pagination }: { pagination: GradebookPaginationState }) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !pagination.hasNextPage || pagination.isFetchNextPageError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !pagination.isFetchingNextPage) {
        void pagination.loadMore()
      }
    }, { rootMargin: '0px 0px 180px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [pagination])
  return (
    <div className="gradebook-progressive-footer" ref={sentinelRef}>
      <span aria-live="polite">
        Showing {pagination.loaded} of {pagination.count}
        {pagination.count !== pagination.totalCount ? ` matching (${pagination.totalCount} total)` : ''}
      </span>
      {pagination.isRefreshing ? <span className="progressive-resource__refreshing">Updating…</span> : null}
      {pagination.hasNextPage && !pagination.isFetchNextPageError ? (
        <button className="button button--secondary button--compact" disabled={pagination.isFetchingNextPage} onClick={() => void pagination.loadMore()} type="button">
          {pagination.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
      ) : null}
      {pagination.isFetchNextPageError ? <button className="button button--secondary button--compact" onClick={() => void pagination.loadMore()} type="button">Retry loading more</button> : null}
    </div>
  )
}

function getSourcePayload(sourceType: GradeItemSourceType, sourceId: string) {
  if (sourceType === 'MODULE_ACTIVITY') {
    return { module_activity: Number(sourceId) }
  }
  if (sourceType === 'ATTENDANCE') {
    return { attendance_session: Number(sourceId) }
  }
  return {}
}

function filterScoreRoster({
  data,
  filter,
  item,
  query,
  roster,
  studentId,
}: {
  data: RouteData
  filter: RosterFilter
  item: GradeItem | null
  query: string
  roster: {
    id: number
    student: number
    student_name: string
    student_number: string
  }[]
  studentId: number | null
}) {
  const normalizedQuery = query.trim().toLowerCase()

  return roster.filter((enrollment) => {
    if (studentId && enrollment.student !== studentId) {
      return false
    }

    if (
      normalizedQuery &&
      !`${enrollment.student_name} ${enrollment.student_number}`
        .toLowerCase()
        .includes(normalizedQuery)
    ) {
      return false
    }

    if (filter !== 'ALL') {
      return getRosterStatus(data, item, enrollment.student) === filter
    }

    return true
  })
}

function getRosterStatus(
  data: RouteData,
  item: GradeItem | null,
  studentId: number,
): Exclude<RosterFilter, 'ALL'> {
  if (!item) return 'PENDING'
  const score = findItemScore(data, item.id, studentId)
  if (score?.status === 'EXCUSED') return 'EXCUSED'
  if (score?.origin === 'OVERRIDE') return 'OVERRIDDEN'
  if (item.module_activity) {
    const paper = data.activityAttempts.some(
      (attempt) =>
        attempt.activity === item.module_activity &&
        attempt.student === studentId &&
        attempt.submission_method === 'PAPER' &&
        attempt.paper_grade_item === item.id &&
        attempt.is_submitted,
    )
    if (paper) return 'PAPER'
    const online = data.activityAttempts.some(
      (attempt) =>
        attempt.activity === item.module_activity &&
        attempt.student === studentId &&
        attempt.submission_method === 'ONLINE' &&
        attempt.is_submitted,
    )
    if (online) return 'ONLINE'
  }
  return score ? 'ONLINE' : 'PENDING'
}

function getRosterStatusCounts(
  data: RouteData,
  item: GradeItem | null,
  roster: Array<{ student: number }>,
): Record<Exclude<RosterFilter, 'ALL'>, number> {
  const counts = { PENDING: 0, ONLINE: 0, PAPER: 0, EXCUSED: 0, OVERRIDDEN: 0 }
  roster.forEach((enrollment) => {
    counts[getRosterStatus(data, item, enrollment.student)] += 1
  })
  return counts
}

function findNextPendingPaperTarget(
  data: RouteData,
  item: GradeItem,
  currentStudentId: number,
): PaperScoreTarget | null {
  const roster = data.enrollments.filter(
    (enrollment) => enrollment.schedule === item.schedule && enrollment.is_active,
  )
  const currentIndex = roster.findIndex((enrollment) => enrollment.student === currentStudentId)
  const ordered = currentIndex >= 0
    ? [...roster.slice(currentIndex + 1), ...roster.slice(0, currentIndex)]
    : roster
  const next = ordered.find(
    (enrollment) => getRosterStatus(data, item, enrollment.student) === 'PENDING',
  )
  return next ? {
    attemptId: null,
    item,
    student: next.student,
    studentName: next.student_name,
  } : null
}

function rosterFilterLabel(filter: RosterFilter) {
  return ({
    ALL: 'All',
    PENDING: 'Pending',
    ONLINE: 'Online',
    PAPER: 'Paper',
    EXCUSED: 'Excused',
    OVERRIDDEN: 'Overridden',
  } as const)[filter]
}

function rosterStatusLabel(status: Exclude<RosterFilter, 'ALL'>) {
  return ({
    PENDING: 'Waiting for response',
    ONLINE: 'Submitted online',
    PAPER: 'Paper entered',
    EXCUSED: 'Excused',
    OVERRIDDEN: 'Score overridden',
  } as const)[status]
}

function setUrlValue(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') params.delete(key)
  else params.set(key, String(value))
}

function findItemScore(data: RouteData, itemId: number, studentId: number) {
  return data.gradeItemScores.find(
    (score) => score.grade_item === itemId && score.student === studentId,
  )
}

function findCategoryGrade(
  data: RouteData,
  categoryId: number,
  studentId: number,
  scheduleId: number,
) {
  return data.categoryGrades.find(
    (grade) =>
      grade.grade_category === categoryId &&
      grade.student === studentId &&
      grade.schedule === scheduleId,
  )
}

function scoreDraftKey(itemId: number, studentId: number) {
  return `${itemId}:${studentId}`
}

function paperScoreDraftKey(itemId: number, studentId: number) {
  return `paper:${itemId}:${studentId}`
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function sourceTypeLabel(sourceType: GradeItemSourceType) {
  return sourceTypes.find((source) => source.value === sourceType)?.label ?? sourceType
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debounced
}

function periodLabel(period: (typeof periods)[number]) {
  return period.charAt(0) + period.slice(1).toLowerCase()
}
