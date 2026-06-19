import { useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  GradeItem,
  GradeItemSourceType,
} from '../../types'
import { displayScore, formatDate, numeric, toErrorMessage } from '../../utils/format'

const periods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
const sourceTypes: { label: string; value: GradeItemSourceType }[] = [
  { label: 'Manual', value: 'MANUAL' },
  { label: 'Assessment', value: 'ASSESSMENT' },
  { label: 'Module activity', value: 'MODULE_ACTIVITY' },
  { label: 'Attendance', value: 'ATTENDANCE' },
  { label: 'Coding', value: 'CODING' },
]

type ScoreDraft = Record<string, { rawScore: string; remarks: string }>
type GradebookViewMode = 'ITEM' | 'MATRIX'

export function AdminGradebookPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const [searchParams] = useSearchParams()
  const [scheduleId, setScheduleId] = useState(() => searchParams.get('schedule') ?? data.schedules[0]?.id.toString() ?? '')
  const [focusedStudentId, setFocusedStudentId] = useState(() => searchParams.get('student') ?? '')
  const selectedSchedule = data.schedules.find((schedule) => schedule.id === Number(scheduleId)) ?? null
  const [period, setPeriod] = useState<(typeof periods)[number]>('PRELIM')
  const categories = data.gradeCategories.filter(
    (category) =>
      selectedSchedule &&
      category.subject === selectedSchedule.subject &&
      category.grading_period === period,
  )
  const [categoryId, setCategoryId] = useState('')
  const selectedCategory =
    categories.find((category) => category.id === Number(categoryId)) ?? categories[0] ?? null
  const items = data.gradeItems
    .filter((item) => selectedCategory && item.grade_category === selectedCategory.id)
    .sort((left, right) => left.order - right.order || left.id - right.id)
  const [itemId, setItemId] = useState('')
  const selectedItem = items.find((item) => item.id === Number(itemId)) ?? items[0] ?? null
  const roster = data.enrollments.filter(
    (enrollment) => selectedSchedule && enrollment.schedule === selectedSchedule.id && enrollment.is_active,
  )
  const focusedStudent = focusedStudentId
    ? roster.find((enrollment) => enrollment.student === Number(focusedStudentId)) ?? null
    : null
  const [studentQuery, setStudentQuery] = useState('')
  const [needsManualOnly, setNeedsManualOnly] = useState(false)
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
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>({})

  const sourceOptions = getSourceOptions(
    data,
    selectedSchedule?.subject ?? null,
    itemDraft.sourceType,
  )
  const visibleRoster = filterScoreRoster({
    item: selectedItem,
    items,
    needsManualOnly,
    query: studentQuery,
    roster,
    scores: data.gradeItemScores,
    studentId: focusedStudent?.student ?? null,
  })

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

    await saveScoreCells([selectedItem], visibleRoster)
  }

  async function saveMatrixScores() {
    await saveScoreCells(items, visibleRoster)
  }

  async function saveScoreCells(
    scoreItems: GradeItem[],
    rows: typeof visibleRoster,
  ) {
    if (!scoreItems.length || !rows.length) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await Promise.all(
        rows.flatMap((enrollment) =>
          scoreItems.map((item) => saveScoreCell(item, enrollment)),
        ),
      )

      setMessage('Scores saved.')
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
                setFocusedStudentId('')
                setScheduleId(event.target.value)
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
            <select onChange={(event) => setPeriod(event.target.value as typeof period)} value={period}>
              {periods.map((item) => (
                <option key={item} value={item}>{periodLabel(item)}</option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Category</span>
            <select onChange={(event) => setCategoryId(event.target.value)} value={selectedCategory?.id ?? ''}>
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
              onChange={(event) => setFocusedStudentId(event.target.value)}
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
              onClick={() => setFocusedStudentId('')}
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
            <div className="gradebook-panel">
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
                  <label className="admin-field">
                    <span>Source item</span>
                    <select
                      onChange={(event) => setItemDraft((current) => ({ ...current, sourceId: event.target.value }))}
                      required
                      value={itemDraft.sourceId}
                    >
                      <option value="">Select</option>
                      {sourceOptions.map((source) => (
                        <option key={source.value} value={source.value}>
                          {source.label} ({numeric(source.points).toFixed(2)} pts)
                        </option>
                      ))}
                    </select>
                  </label>
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
                      onClick={() => setItemId(String(item.id))}
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
                      Points for source-linked items follow the original quiz, activity, attendance, or coding item.
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
                  <button
                    className="button button--secondary roster-remove-button"
                    disabled={saving}
                    onClick={() => void deleteItem(selectedItem)}
                    type="button"
                  >
                    <Icon name="trash" />
                    <span>Remove item</span>
                  </button>
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
                  Item
                </button>
                <button
                  className={viewMode === 'MATRIX' ? 'active' : ''}
                  onClick={() => setViewMode('MATRIX')}
                  type="button"
                >
                  Matrix
                </button>
              </div>

              {viewMode === 'ITEM' && selectedItem ? (
                <>
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
                    <label className="admin-check">
                      <input
                        checked={needsManualOnly}
                        onChange={(event) => setNeedsManualOnly(event.target.checked)}
                        type="checkbox"
                      />
                      <span>Needs manual score</span>
                    </label>
                  </div>
                  <div className="table-wrap">
                    <table className="admin-table gradebook-score-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Score</th>
                          <th>Transmuted</th>
                          <th>Remarks</th>
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

                          return (
                            <tr key={enrollment.id}>
                              <td>
                                <strong>{enrollment.student_name}</strong>
                                <span>{enrollment.student_number}</span>
                              </td>
                              <td>
                                <input
                                  className="gradebook-score-input"
                                  max={numeric(selectedItem.points_possible)}
                                  min="0"
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
                            </tr>
                          )
                        })}
                        {!roster.length ? (
                          <tr>
                            <td colSpan={4}>No active students in this class.</td>
                          </tr>
                        ) : null}
                        {roster.length && !visibleRoster.length ? (
                          <tr>
                            <td colSpan={4}>No students match the current score filters.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <button
                    className="button button--primary gradebook-save-button"
                    disabled={saving || !visibleRoster.length}
                    onClick={() => void saveScores()}
                    type="button"
                  >
                    <Icon name="save" />
                    <span>{saving ? 'Saving...' : 'Save scores'}</span>
                  </button>
                </>
              ) : (
                null
              )}

              {viewMode === 'MATRIX' ? (
                <MatrixScorePanel
                  data={data}
                  items={items}
                  needsManualOnly={needsManualOnly}
                  roster={roster}
                  saving={saving}
                  scoreDraft={scoreDraft}
                  selectedCategoryId={selectedCategory.id}
                  setNeedsManualOnly={setNeedsManualOnly}
                  setScoreDraft={setScoreDraft}
                  setStudentQuery={setStudentQuery}
                  studentQuery={studentQuery}
                  visibleRoster={visibleRoster}
                  onSave={() => void saveMatrixScores()}
                />
              ) : null}

              {message ? <p className="admin-message">{message}</p> : null}

              {viewMode === 'ITEM' && !selectedItem ? (
                <p className="admin-empty-line">Select or create a grade item to enter scores.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </Page>
  )
}

function MatrixScorePanel({
  data,
  items,
  needsManualOnly,
  onSave,
  roster,
  saving,
  scoreDraft,
  selectedCategoryId,
  setNeedsManualOnly,
  setScoreDraft,
  setStudentQuery,
  studentQuery,
  visibleRoster,
}: {
  data: WorkspaceData
  items: GradeItem[]
  needsManualOnly: boolean
  onSave: () => void
  roster: {
    id: number
    student: number
    student_name: string
    student_number: string
  }[]
  saving: boolean
  scoreDraft: ScoreDraft
  selectedCategoryId: number
  setNeedsManualOnly: (value: boolean) => void
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
        <label className="admin-check">
          <input
            checked={needsManualOnly}
            onChange={(event) => setNeedsManualOnly(event.target.checked)}
            type="checkbox"
          />
          <span>Needs manual score</span>
        </label>
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
                    {categoryGrade
                      ? `${numeric(categoryGrade.raw_score).toFixed(2)} / ${numeric(categoryGrade.total_score).toFixed(2)}`
                      : '-'}
                  </td>
                  <td>
                    {categoryGrade
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
      </div>
      <button
        className="button button--primary gradebook-save-button"
        disabled={saving || !items.length || !visibleRoster.length}
        onClick={onSave}
        type="button"
      >
        <Icon name="save" />
        <span>{saving ? 'Saving...' : 'Save matrix scores'}</span>
      </button>
    </>
  )
}

function getSourcePayload(sourceType: GradeItemSourceType, sourceId: string) {
  if (sourceType === 'ASSESSMENT') {
    return { assessment: Number(sourceId) }
  }
  if (sourceType === 'MODULE_ACTIVITY') {
    return { module_activity: Number(sourceId) }
  }
  if (sourceType === 'ATTENDANCE') {
    return { attendance_session: Number(sourceId) }
  }
  if (sourceType === 'CODING') {
    return { coding_problem: Number(sourceId) }
  }
  return {}
}

function filterScoreRoster({
  item,
  items,
  needsManualOnly,
  query,
  roster,
  scores,
  studentId,
}: {
  item: GradeItem | null
  items: GradeItem[]
  needsManualOnly: boolean
  query: string
  roster: {
    id: number
    student: number
    student_name: string
    student_number: string
  }[]
  scores: WorkspaceData['gradeItemScores']
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

    if (needsManualOnly) {
      const itemIds = item ? [item.id] : items.map((entry) => entry.id)

      if (!itemIds.length) {
        return false
      }

      return itemIds.some(
        (itemId) =>
          !scores.some(
            (score) =>
              score.grade_item === itemId &&
              score.student === enrollment.student,
          ),
      )
    }

    return true
  })
}

function findItemScore(data: WorkspaceData, itemId: number, studentId: number) {
  return data.gradeItemScores.find(
    (score) => score.grade_item === itemId && score.student === studentId,
  )
}

function findCategoryGrade(
  data: WorkspaceData,
  categoryId: number,
  studentId: number,
) {
  return data.categoryGrades.find(
    (grade) =>
      grade.grade_category === categoryId &&
      grade.student === studentId,
  )
}

function scoreDraftKey(itemId: number, studentId: number) {
  return `${itemId}:${studentId}`
}

function getSourceOptions(
  data: WorkspaceData,
  subjectId: number | null,
  sourceType: GradeItemSourceType,
) {
  if (!subjectId) {
    return []
  }

  if (sourceType === 'ASSESSMENT') {
    return data.assessments
      .filter((assessment) => assessment.subject === subjectId && assessment.counts_toward_grade)
      .map((assessment) => ({
        label: assessment.title,
        points: assessment.points_possible,
        value: String(assessment.id),
      }))
  }

  if (sourceType === 'MODULE_ACTIVITY') {
    const moduleIds = new Set(
      data.modules
        .filter((module) => module.subjects.includes(subjectId))
        .map((module) => module.id),
    )

    return data.activities
      .filter((activity) => moduleIds.has(activity.module))
      .map((activity) => ({
        label: activity.title,
        points: activity.points_possible,
        value: String(activity.id),
      }))
  }

  if (sourceType === 'ATTENDANCE') {
    return data.attendanceSessions
      .filter((session) => session.subject === subjectId)
      .map((session) => ({
        label: session.title || formatDate(session.date),
        points: session.points_possible,
        value: String(session.id),
      }))
  }

  if (sourceType === 'CODING') {
    const moduleIds = new Set(
      data.modules
        .filter((module) => module.subjects.includes(subjectId))
        .map((module) => module.id),
    )

    return data.problems
      .filter((problem) => problem.subject === subjectId || (problem.module ? moduleIds.has(problem.module) : false))
      .map((problem) => ({
        label: problem.title,
        points: problem.points_possible,
        value: String(problem.id),
      }))
  }

  return []
}

function sourceTypeLabel(sourceType: GradeItemSourceType) {
  return sourceTypes.find((source) => source.value === sourceType)?.label ?? sourceType
}

function periodLabel(period: (typeof periods)[number]) {
  return period.charAt(0) + period.slice(1).toLowerCase()
}
