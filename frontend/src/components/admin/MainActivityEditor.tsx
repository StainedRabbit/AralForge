import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import type {
  GradeCategory,
  MainActivityBulkAssignmentRequest,
  MainActivityBulkAssignmentResult,
  ModuleActivity,
  ModuleActivityQuestion,
  ModuleActivityQuestionType,
  ModuleLesson,
} from '../../types'
import { toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'
import { SectionHeading } from '../ui'

type QuestionDraft = {
  id: string
  serverId?: number
  question_type: ModuleActivityQuestionType
  prompt: string
  points: string
  order: string
  explanation: string
  correct_text_answers: string
  case_sensitive: boolean
  code_snippet: string
  expected_output: string
  choices_text: string
  matching_text: string
  is_published: boolean
  deleted?: boolean
}

type PreviewMode = 'not_started' | 'score_only' | 'review'
type EditorTab = 'setup' | 'questions' | 'import' | 'preview' | 'grading'
type UpdateQuestion = <TField extends keyof QuestionDraft>(
  id: string,
  field: TField,
  value: QuestionDraft[TField],
) => void

const questionTypeOptions: Array<{ label: string; value: ModuleActivityQuestionType }> = [
  { label: 'Multiple choice', value: 'multiple_choice' },
  { label: 'True / false', value: 'true_false' },
  { label: 'Fill blank', value: 'fill_blank' },
  { label: 'Ordering', value: 'ordering' },
  { label: 'Matching', value: 'matching' },
  { label: 'Code output', value: 'code_output' },
]

const structuredImportExample = `# Main Activity Import Example

MCQ: Which tool compiles Java source code?
A. JVM
B. JDK *
C. HTML
D. CSS

TF: Java source files usually use the .java extension.
True *
False

FILL: Complete the command used to compile Java code.
javac
JAVAC

ORDER: Put the Java workflow in order.
Write source code
Compile with javac
Run with java

MATCH: Match each term to its meaning.
JDK => Tools for developing Java programs
JVM => Runs Java bytecode
javac => Compiles source code

CODE: What is the output?
System.out.println("Hello");
Output: Hello
`

export function MainActivityEditor({
  api,
  data,
  lesson,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  lesson: ModuleLesson
  refresh: () => Promise<void>
}) {
  const topic = data.moduleTopics.find((item) => item.id === lesson.topic)
  const module = topic ? data.modules.find((item) => item.id === topic.module) : null
  const activity = data.activities.find((item) => item.lesson === lesson.id) ?? null
  const initialDrafts = useMemo(
    () => createQuestionDrafts(data, activity),
    [activity, data],
  )
  const [title, setTitle] = useState(activity?.title ?? 'Main Activity')
  const [instructions, setInstructions] = useState(activity?.instructions ?? '')
  const [pointsPossible, setPointsPossible] = useState(activity?.points_possible ?? '10')
  const [maxAttempts, setMaxAttempts] = useState(String(activity?.max_attempts ?? 3))
  const [passingScore, setPassingScore] = useState(activity?.passing_score ?? '')
  const [isPublished, setIsPublished] = useState(activity?.is_published ?? false)
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>(initialDrafts)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('not_started')
  const [importText, setImportText] = useState('')
  const [showImportExample, setShowImportExample] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('setup')
  const activeDrafts = questionDrafts.filter((question) => !question.deleted)
  const readinessWarnings = useMemo(
    () => getReadinessWarnings(activeDrafts),
    [activeDrafts],
  )

  function addQuestion(questionType: ModuleActivityQuestionType = 'multiple_choice') {
    setQuestionDrafts((current) => [
      ...current,
      createEmptyQuestionDraft(
        current.filter((question) => !question.deleted).length + 1,
        questionType,
      ),
    ])
  }

  function updateQuestion<TField extends keyof QuestionDraft>(
    id: string,
    field: TField,
    value: QuestionDraft[TField],
  ) {
    setQuestionDrafts((current) =>
      current.map((question) =>
        question.id === id ? { ...question, [field]: value } : question,
      ),
    )
  }

  function removeQuestion(id: string) {
    setQuestionDrafts((current) =>
      current
        .map((question) =>
          question.id === id
            ? question.serverId
              ? { ...question, deleted: true }
              : null
            : question,
        )
        .filter((question): question is QuestionDraft => Boolean(question)),
    )
  }

  function duplicateQuestion(question: QuestionDraft) {
    const nextOrder = activeDrafts.length + 1
    setQuestionDrafts((current) => [
      ...current,
      {
        ...question,
        id: `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        order: String(nextOrder),
        prompt: question.prompt ? `${question.prompt} (copy)` : '',
        serverId: undefined,
      },
    ])
  }

  function addQuestionGroup(questionType: ModuleActivityQuestionType, count: number) {
    setQuestionDrafts((current) => {
      const startOrder = current.filter((question) => !question.deleted).length + 1
      return [
        ...current,
        ...Array.from({ length: count }, (_, index) =>
          createEmptyQuestionDraft(startOrder + index, questionType),
        ),
      ]
    })
  }

  function importQuestionDrafts() {
    const imported = parseImportedQuestions(importText, activeDrafts.length + 1)
    if (!imported.length) {
      setMessage('No questions were found. Start each block with MCQ:, TF:, FILL:, ORDER:, MATCH:, or CODE:.')
      return
    }
    setQuestionDrafts((current) => [...current, ...imported])
    setImportText('')
    setMessage(`${imported.length} question${imported.length === 1 ? '' : 's'} imported as drafts.`)
  }

  async function uploadImportFile(file: File | null) {
    if (!file) return
    const text = await file.text()
    setImportText(text)
    setMessage(`${file.name} loaded into structured import.`)
  }

  function downloadImportExample() {
    const blob = new Blob([structuredImportExample], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'main-activity-import-example.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function saveActivity(nextTab?: EditorTab) {
    if (!module || !topic) {
      setMessage('Lesson module context is missing.')
      return
    }
    if (isPublished && readinessWarnings.length) {
      setMessage(`Fix readiness warnings before publishing: ${readinessWarnings.join(' ')}`)
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const savedActivity = await api<ModuleActivity>(
        activity ? `/modules/activities/${activity.id}/` : '/modules/activities/',
        {
          method: activity ? 'PATCH' : 'POST',
          body: JSON.stringify({
            module: module.id,
            topic: topic.id,
            lesson: lesson.id,
            title,
            instructions,
            activity_type: 'INTERACTIVE',
            order: lesson.order,
            points_possible: pointsPossible || '0',
            max_attempts: Number(maxAttempts || 3),
            passing_score: passingScore || null,
            accepts_text: false,
            accepts_file: false,
            accepts_code: false,
            is_published: isPublished,
          }),
        },
      )
      await syncQuestions(api, data, savedActivity.id, questionDrafts, initialDrafts)
      await refresh()
      setMessage('Main Activity saved.')
      if (nextTab) setActiveTab(nextTab)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  const linkedClassCount = activity
    ? new Set(
        data.gradeItems
          .filter((item) => item.module_activity === activity.id && item.schedule)
          .map((item) => item.schedule),
      ).size
    : 0
  const publishedQuestionCount = activeDrafts.filter((question) => question.is_published).length
  const publishedPoints = activeDrafts
    .filter((question) => question.is_published)
    .reduce((total, question) => total + (Number(question.points) || 0), 0)
  const nextTab = ({
    setup: 'questions',
    questions: 'import',
    import: 'preview',
    preview: 'grading',
    grading: undefined,
  } as const)[activeTab]

  return (
    <section className="main-activity-editor">
      <SectionHeading
        subtitle="Website-based, auto-graded lesson work"
        title="Main Activity"
      />

      <div className="activity-readiness-strip" aria-label="Main Activity readiness summary">
        <span className={activity ? 'status-badge status-badge--ready' : 'status-badge'}>
          {activity ? 'Saved' : 'Not saved'}
        </span>
        <span className={isPublished ? 'status-badge status-badge--ready' : 'status-badge'}>
          {isPublished ? 'Published' : 'Draft'}
        </span>
        <span className={publishedQuestionCount ? 'status-badge status-badge--ready' : 'status-badge'}>
          {publishedQuestionCount} published question{publishedQuestionCount === 1 ? '' : 's'}
        </span>
        <span className="status-badge">{publishedPoints} question points</span>
        <span className={linkedClassCount ? 'status-badge status-badge--ready' : 'status-badge'}>
          {linkedClassCount} linked class{linkedClassCount === 1 ? '' : 'es'}
        </span>
      </div>

      <section className={readinessWarnings.length ? 'activity-readiness activity-readiness--warning' : 'activity-readiness activity-readiness--ready'}>
        <div>
          <p className="eyebrow">Readiness check</p>
          <h3>{readinessWarnings.length ? 'Needs attention before publishing' : 'Ready to publish'}</h3>
        </div>
        {readinessWarnings.length ? (
          <ul>
            {readinessWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p>All published questions have the required answer data.</p>
        )}
      </section>

      <nav className="main-activity-tabs" aria-label="Main Activity editor sections">
        {([
          ['setup', 'Setup'],
          ['questions', `Questions (${activeDrafts.length})`],
          ['import', 'Import'],
          ['preview', 'Preview'],
          ...(activity ? [['grading', `Grading (${linkedClassCount})`]] : []),
        ] as Array<[EditorTab, string]>).map(([tab, label]) => (
          <button
            className={activeTab === tab ? 'active' : ''}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'setup' ? (
        <section className="main-activity-tab-panel">
          <div className="lesson-editor__grid">
            <label className="admin-field">
              <span>Title</span>
              <input onChange={(event) => setTitle(event.target.value)} type="text" value={title} />
            </label>
            <label className="admin-field">
              <span>Points</span>
              <input onChange={(event) => setPointsPossible(event.target.value)} type="number" value={pointsPossible} />
            </label>
            <label className="admin-field">
              <span>Max attempts</span>
              <input min={1} onChange={(event) => setMaxAttempts(event.target.value)} type="number" value={maxAttempts} />
            </label>
            <label className="admin-field">
              <span>Passing score</span>
              <input onChange={(event) => setPassingScore(event.target.value)} type="number" value={passingScore} />
            </label>
            <label className="admin-check">
              <input checked={isPublished} onChange={(event) => setIsPublished(event.target.checked)} type="checkbox" />
              <span>Published</span>
            </label>
            <label className="admin-field admin-field--wide">
              <span>Instructions</span>
              <textarea onChange={(event) => setInstructions(event.target.value)} rows={4} value={instructions} />
            </label>
          </div>
          <div className="question-group-row">
            <span>Quick add groups</span>
            <button className="button button--secondary button--compact" onClick={() => addQuestionGroup('multiple_choice', 10)} type="button">10 MCQ</button>
            <button className="button button--secondary button--compact" onClick={() => addQuestionGroup('true_false', 5)} type="button">5 True/False</button>
            <button className="button button--secondary button--compact" onClick={() => addQuestionGroup('fill_blank', 5)} type="button">5 Fill Blank</button>
          </div>
        </section>
      ) : null}

      {activeTab === 'questions' ? (
        <section className="main-activity-tab-panel">
          <div className="main-activity-question-list">
            {activeDrafts.map((question, index) => (
              <QuestionEditorCard
                duplicateQuestion={duplicateQuestion}
                index={index}
                key={question.id}
                question={question}
                removeQuestion={removeQuestion}
                updateQuestion={updateQuestion}
              />
            ))}
            {!activeDrafts.length ? (
              <p className="admin-empty-line">No Main Activity questions yet.</p>
            ) : null}
          </div>
          <div className="lesson-editor__actions">
            <button className="button button--secondary" onClick={() => addQuestion()} type="button">
              <Icon name="plus" />
              <span>Add Question</span>
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === 'grading' && activity && module ? (
        <ActivityGradingAssignments
          activity={activity}
          api={api}
          data={data}
          moduleSubject={module.subject}
          moduleSubjects={module.subjects}
          refresh={refresh}
        />
      ) : null}

      {activeTab === 'import' ? (
        <section className="main-activity-tab-panel main-activity-tools main-activity-tools--import">
          <p className="eyebrow">Structured import</p>
          <label className="admin-field">
            <span>Paste blocks starting with MCQ:, TF:, FILL:, ORDER:, MATCH:, or CODE:</span>
            <textarea onChange={(event) => setImportText(event.target.value)} rows={10} value={importText} />
          </label>
          <div className="lesson-editor__actions">
            <button className="button button--secondary button--compact" onClick={() => setShowImportExample(true)} type="button">
              <Icon name="book" />
              <span>Format Example</span>
            </button>
            <button className="button button--secondary button--compact" onClick={downloadImportExample} type="button">
              <Icon name="file" />
              <span>Download Example MD</span>
            </button>
            <label className="button button--secondary button--compact import-file-button">
              <Icon name="upload" />
              <span>Upload MD</span>
              <input
                accept=".md,.txt,text/markdown,text/plain"
                onChange={(event) => void uploadImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className="button button--primary button--compact" onClick={importQuestionDrafts} type="button">
              <Icon name="plus" />
              <span>Import Questions</span>
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === 'preview' ? (
        <section className="main-activity-tab-panel main-activity-preview">
          <div className="main-activity-question-editor__header">
            <div>
              <p className="eyebrow">Teacher preview</p>
              <h3>Student view simulation</h3>
            </div>
            <div className="segmented-control">
              {([
                ['not_started', 'Before attempt'],
                ['score_only', 'Score only'],
                ['review', 'Review unlocked'],
              ] as Array<[PreviewMode, string]>).map(([mode, label]) => (
                <button
                  className={previewMode === mode ? 'active' : ''}
                  key={mode}
                  onClick={() => setPreviewMode(mode)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ActivityPreview
            drafts={activeDrafts}
            instructions={instructions}
            mode={previewMode}
            title={title}
          />
        </section>
      ) : null}

      {message ? <p className="admin-message">{message}</p> : null}
      <div className="lesson-editor__actions">
        <button className="button button--secondary" disabled={saving} onClick={() => void saveActivity()} type="button">
          <Icon name="save" />
          <span>{saving ? 'Saving...' : 'Save Main Activity'}</span>
        </button>
        {nextTab ? (
          <button className="button button--primary" disabled={saving} onClick={() => void saveActivity(nextTab)} type="button">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : `Save and continue to ${formatEditorTab(nextTab)}`}</span>
          </button>
        ) : null}
      </div>
      {showImportExample ? (
        <StructuredImportExampleModal
          onClose={() => setShowImportExample(false)}
          onDownload={downloadImportExample}
        />
      ) : null}
    </section>
  )
}

const gradingPeriods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
type GradingPeriod = (typeof gradingPeriods)[number]
type AssignmentDraft = {
  selected: boolean
  period: GradingPeriod
  categoryId: string
}

function ActivityGradingAssignments({
  activity,
  api,
  data,
  moduleSubject,
  moduleSubjects,
  refresh,
}: {
  activity: ModuleActivity
  api: AuthedRequest
  data: RouteData
  moduleSubject: number | null
  moduleSubjects: number[]
  refresh: () => Promise<void>
}) {
  const subjectIds = new Set([
    ...moduleSubjects,
    ...(moduleSubject ? [moduleSubject] : []),
  ])
  const schedules = data.schedules.filter(
    (schedule) => schedule.is_active && subjectIds.has(schedule.subject),
  )
  const existingItemsBySchedule = new Map(
    schedules.map((schedule) => [
      schedule.id,
      data.gradeItems.filter(
        (item) =>
          item.schedule === schedule.id &&
          item.source_type === 'MODULE_ACTIVITY' &&
          item.module_activity === activity.id,
      ),
    ]),
  )
  const [defaultPeriod, setDefaultPeriod] = useState<GradingPeriod>('PRELIM')
  const [drafts, setDrafts] = useState<Record<number, AssignmentDraft>>(() =>
    Object.fromEntries(schedules.map((schedule) => {
      const existing = existingItemsBySchedule.get(schedule.id)?.[0]
      const category = data.gradeCategories.find((candidate) => candidate.id === existing?.grade_category)
      const period = category?.grading_period ?? 'PRELIM'
      const automaticCategory = quizCategoriesFor(data, schedule.id, period)[0]
      return [schedule.id, {
        selected: Boolean(existing),
        period,
        categoryId: String(category?.id ?? automaticCategory?.id ?? ''),
      }]
    })),
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  function updateDraft(scheduleId: number, changes: Partial<AssignmentDraft>) {
    setDrafts((current) => ({
      ...current,
      [scheduleId]: { ...current[scheduleId], ...changes },
    }))
  }

  function selectSchedule(scheduleId: number, selected: boolean) {
    const schedule = schedules.find((candidate) => candidate.id === scheduleId)
    if (!schedule) return
    const current = drafts[scheduleId]
    const category = current?.categoryId
      ? current.categoryId
      : String(quizCategoriesFor(data, scheduleId, defaultPeriod)[0]?.id ?? '')
    updateDraft(scheduleId, {
      selected,
      period: current?.period ?? defaultPeriod,
      categoryId: category,
    })
  }

  function changeDefaultPeriod(period: GradingPeriod) {
    setDefaultPeriod(period)
    setDrafts((current) => Object.fromEntries(schedules.map((schedule) => {
      const draft = current[schedule.id]
      if (!draft?.selected) return [schedule.id, draft]
      return [schedule.id, {
        ...draft,
        period,
        categoryId: String(quizCategoriesFor(data, schedule.id, period)[0]?.id ?? ''),
      }]
    })))
  }

  function changeRowPeriod(scheduleId: number, period: GradingPeriod) {
    updateDraft(scheduleId, {
      period,
      categoryId: String(quizCategoriesFor(data, scheduleId, period)[0]?.id ?? ''),
    })
  }

  async function applyAssignments() {
    const selected = schedules.filter((schedule) => drafts[schedule.id]?.selected)
    if (!selected.length) {
      setMessage('Select at least one class to assign.')
      return
    }
    const missingCategory = selected.find((schedule) => !drafts[schedule.id]?.categoryId)
    if (missingCategory) {
      setMessage(`Configure a Quiz category for ${missingCategory.subject_code} ${missingCategory.section || ''} before applying.`)
      return
    }
    const payload: MainActivityBulkAssignmentRequest = {
      module_activity: activity.id,
      assignments: selected.map((schedule) => ({
        schedule: schedule.id,
        grade_category: Number(drafts[schedule.id].categoryId),
      })),
    }
    setSaving(true)
    setMessage('')
    try {
      const result = await api<MainActivityBulkAssignmentResult>(
        '/grades/items/assign-main-activity/',
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setMessage(
        `Assignments applied: ${result.created_count} linked, ${result.updated_count} updated. Unselected classes were unchanged.`,
      )
      await refresh()
    } catch (error) {
      setMessage(`Nothing was changed. ${toErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function removeAssignment(scheduleId: number) {
    const schedule = schedules.find((candidate) => candidate.id === scheduleId)
    const existingItem = existingItemsBySchedule.get(scheduleId)?.[0]
    if (!schedule || !existingItem || !window.confirm(
      `Remove ${activity.title} from ${schedule.subject_code} ${schedule.section || ''}? Its linked scores will also be removed.`,
    )) return
    setSaving(true)
    setMessage('')
    try {
      await api(`/grades/items/${existingItem.id}/`, { method: 'DELETE' })
      updateDraft(scheduleId, { selected: false })
      setMessage(`Removed the link for ${schedule.subject_code} ${schedule.section || ''}.`)
      await refresh()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="main-activity-tab-panel activity-grading-panel">
      <div className="activity-grading-heading">
        <div>
          <p className="eyebrow">Class gradebook links</p>
          <h3>Count this Main Activity as a quiz</h3>
          <p>Select classes together, then review any per-class category overrides before applying.</p>
        </div>
        <label className="admin-field">
          <span>Default period</span>
          <select onChange={(event) => changeDefaultPeriod(event.target.value as GradingPeriod)} value={defaultPeriod}>
            {gradingPeriods.map((period) => <option key={period} value={period}>{formatPeriod(period)}</option>)}
          </select>
        </label>
        <div className="lesson-editor__actions">
          <button
            className="button button--secondary button--compact"
            onClick={() => schedules.forEach((schedule) => selectSchedule(schedule.id, true))}
            type="button"
          >
            Select all
          </button>
          <button
            className="button button--secondary button--compact"
            onClick={() => schedules.forEach((schedule) => selectSchedule(schedule.id, false))}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="activity-grading-list">
        {schedules.map((schedule) => {
          const draft = drafts[schedule.id] ?? { selected: false, period: defaultPeriod, categoryId: '' }
          const categories = quizCategoriesFor(data, schedule.id, draft.period)
          const existingItems = existingItemsBySchedule.get(schedule.id) ?? []
          const existingItem = existingItems[0]
          const existingCategory = data.gradeCategories.find((category) => category.id === existingItem?.grade_category)
          return (
            <article className={`activity-grading-row${draft.selected ? ' activity-grading-row--selected' : ''}`} key={schedule.id}>
              <label className="activity-grading-row__select">
                <input
                  checked={draft.selected}
                  disabled={existingItems.length > 1}
                  onChange={(event) => selectSchedule(schedule.id, event.target.checked)}
                  type="checkbox"
                />
                <span className="activity-grading-row__class">
                  <strong>{schedule.subject_code} {schedule.section || ''}</strong>
                  <span>{schedule.term_name}</span>
                </span>
              </label>
              <span className={`status-badge ${existingItems.length > 1 ? 'status-badge--error' : existingItem ? 'status-badge--ready' : ''}`}>
                {existingItems.length > 1 ? 'Error: duplicate links' : existingItem ? 'Linked' : 'Not linked'}
              </span>
              <label className="admin-field">
                <span>Period</span>
                <select
                  disabled={!draft.selected || existingItems.length > 1}
                  onChange={(event) => changeRowPeriod(schedule.id, event.target.value as GradingPeriod)}
                  value={draft.period}
                >
                  {gradingPeriods.map((period) => <option key={period} value={period}>{formatPeriod(period)}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span>Quiz category</span>
                <select
                  disabled={!draft.selected || !categories.length || existingItems.length > 1}
                  onChange={(event) => updateDraft(schedule.id, { categoryId: event.target.value })}
                  value={draft.categoryId}
                >
                  {!categories.length ? <option value="">No Quiz category</option> : null}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <div className="activity-grading-row__actions">
                {existingItem && existingCategory ? (
                  <Link
                    className="button button--secondary button--compact"
                    to={`/admin/gradebook?schedule=${schedule.id}&period=${existingCategory.grading_period}&category=${existingCategory.id}&item=${existingItem.id}&filter=PENDING`}
                  >
                    Open Gradebook
                  </Link>
                ) : null}
                {existingItem ? (
                  <button className="button button--secondary button--compact" disabled={saving} onClick={() => void removeAssignment(schedule.id)} type="button">
                    Remove
                  </button>
                ) : null}
              </div>
              {!categories.length && draft.selected ? (
                <p className="admin-message">
                  No Quiz category for {formatPeriod(draft.period)}. <Link to="/admin/grades">Configure grade categories</Link>.
                </p>
              ) : null}
            </article>
          )
        })}
        {!schedules.length ? (
          <p className="admin-empty-line">No active classes are associated with this module subject.</p>
        ) : null}
      </div>
      {message ? <p className="admin-message" role="status">{message}</p> : null}
      <div className="lesson-editor__actions">
        <button
          className="button button--primary"
          disabled={saving || !schedules.some((schedule) => drafts[schedule.id]?.selected)}
          onClick={() => void applyAssignments()}
          type="button"
        >
          <Icon name="save" />
          <span>{saving ? 'Applying assignments...' : 'Apply selected assignments'}</span>
        </button>
      </div>
    </section>
  )
}

function quizCategoriesFor(data: RouteData, scheduleId: number, period: GradingPeriod): GradeCategory[] {
  const schedule = data.schedules.find((candidate) => candidate.id === scheduleId)
  if (!schedule) return []
  return data.gradeCategories.filter(
    (category) =>
      category.subject === schedule.subject &&
      category.category === 'QUIZ' &&
      category.grading_period === period,
  )
}

function formatPeriod(period: GradingPeriod) {
  return period.charAt(0) + period.slice(1).toLowerCase()
}

function formatEditorTab(tab: EditorTab) {
  return tab.charAt(0).toUpperCase() + tab.slice(1)
}

function QuestionEditorCard({
  duplicateQuestion,
  index,
  question,
  removeQuestion,
  updateQuestion,
}: {
  duplicateQuestion: (question: QuestionDraft) => void
  index: number
  question: QuestionDraft
  removeQuestion: (id: string) => void
  updateQuestion: UpdateQuestion
}) {
  return (
    <article className="main-activity-question-editor">
      <div className="main-activity-question-editor__header">
        <div>
          <strong>Question {index + 1}</strong>
          <small>{questionTypeOptions.find((option) => option.value === question.question_type)?.label}</small>
        </div>
        <div className="lesson-editor__actions">
          <button className="button button--secondary button--compact" onClick={() => duplicateQuestion(question)} type="button">
            Duplicate
          </button>
          <button className="button button--secondary button--compact" onClick={() => removeQuestion(question.id)} type="button">
            Remove
          </button>
        </div>
      </div>
      <div className="lesson-editor__grid">
        <label className="admin-field">
          <span>Type</span>
          <select
            onChange={(event) => updateQuestion(question.id, 'question_type', event.target.value as ModuleActivityQuestionType)}
            value={question.question_type}
          >
            {questionTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Points</span>
          <input onChange={(event) => updateQuestion(question.id, 'points', event.target.value)} type="number" value={question.points} />
        </label>
        <label className="admin-field">
          <span>Order</span>
          <input onChange={(event) => updateQuestion(question.id, 'order', event.target.value)} type="number" value={question.order} />
        </label>
        <label className="admin-check">
          <input checked={question.is_published} onChange={(event) => updateQuestion(question.id, 'is_published', event.target.checked)} type="checkbox" />
          <span>Published</span>
        </label>
        <label className="admin-field admin-field--wide">
          <span>Prompt</span>
          <textarea onChange={(event) => updateQuestion(question.id, 'prompt', event.target.value)} rows={3} value={question.prompt} />
        </label>
        {question.question_type === 'multiple_choice' || question.question_type === 'true_false' ? (
          <label className="admin-field admin-field--wide">
            <span>Choices, one per line. Prefix the correct choice with *</span>
            <textarea onChange={(event) => updateQuestion(question.id, 'choices_text', event.target.value)} rows={4} value={question.choices_text} />
          </label>
        ) : null}
        {question.question_type === 'ordering' ? (
          <label className="admin-field admin-field--wide">
            <span>Correct order, one item per line</span>
            <textarea onChange={(event) => updateQuestion(question.id, 'choices_text', event.target.value)} rows={4} value={question.choices_text} />
          </label>
        ) : null}
        {question.question_type === 'fill_blank' ? (
          <>
            <label className="admin-field admin-field--wide">
              <span>Accepted answers, one per line</span>
              <textarea onChange={(event) => updateQuestion(question.id, 'correct_text_answers', event.target.value)} rows={4} value={question.correct_text_answers} />
            </label>
            <label className="admin-check">
              <input checked={question.case_sensitive} onChange={(event) => updateQuestion(question.id, 'case_sensitive', event.target.checked)} type="checkbox" />
              <span>Case sensitive</span>
            </label>
          </>
        ) : null}
        {question.question_type === 'matching' ? (
          <label className="admin-field admin-field--wide">
            <span>Pairs, one per line: left =&gt; right</span>
            <textarea onChange={(event) => updateQuestion(question.id, 'matching_text', event.target.value)} rows={4} value={question.matching_text} />
          </label>
        ) : null}
        {question.question_type === 'code_output' ? (
          <>
            <label className="admin-field admin-field--wide">
              <span>Code snippet</span>
              <textarea className="code-input" onChange={(event) => updateQuestion(question.id, 'code_snippet', event.target.value)} rows={5} value={question.code_snippet} />
            </label>
            <label className="admin-field admin-field--wide">
              <span>Expected output</span>
              <textarea className="code-input" onChange={(event) => updateQuestion(question.id, 'expected_output', event.target.value)} rows={4} value={question.expected_output} />
            </label>
          </>
        ) : null}
        <label className="admin-field admin-field--wide">
          <span>Explanation shown after grading</span>
          <textarea onChange={(event) => updateQuestion(question.id, 'explanation', event.target.value)} rows={3} value={question.explanation} />
        </label>
      </div>
    </article>
  )
}

function createQuestionDrafts(data: RouteData, activity: ModuleActivity | null): QuestionDraft[] {
  if (!activity) return []
  return data.activityQuestions
    .filter((question) => question.activity === activity.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
    .map((question) => ({
      case_sensitive: question.case_sensitive,
      choices_text: choicesText(data, question),
      code_snippet: question.code_snippet,
      correct_text_answers: (question.correct_text_answers ?? []).join('\n'),
      deleted: false,
      expected_output: question.expected_output ?? '',
      explanation: question.explanation ?? '',
      id: `server-${question.id}`,
      is_published: question.is_published,
      matching_text: matchingText(data, question),
      order: String(question.order),
      points: question.points,
      prompt: question.prompt,
      question_type: question.question_type,
      serverId: question.id,
    }))
}

function createEmptyQuestionDraft(
  order: number,
  questionType: ModuleActivityQuestionType = 'multiple_choice',
): QuestionDraft {
  return {
    case_sensitive: false,
    choices_text:
      questionType === 'true_false'
        ? '* True\nFalse'
        : questionType === 'multiple_choice'
          ? '* Correct answer\nDistractor 1\nDistractor 2\nDistractor 3'
          : '',
    code_snippet: '',
    correct_text_answers: '',
    deleted: false,
    expected_output: '',
    explanation: '',
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    is_published: true,
    matching_text: '',
    order: String(order),
    points: '1',
    prompt: '',
    question_type: questionType,
  }
}

function getReadinessWarnings(drafts: QuestionDraft[]) {
  const warnings: string[] = []
  const publishedDrafts = drafts.filter((draft) => draft.is_published)
  if (!publishedDrafts.length) {
    warnings.push('Add at least one published question.')
  }

  publishedDrafts.forEach((draft, index) => {
    const label = `Question ${index + 1}`
    if (!draft.prompt.trim()) {
      warnings.push(`${label}: add a prompt.`)
    }
    if (draft.question_type === 'multiple_choice' || draft.question_type === 'true_false') {
      const choices = parseChoiceLines(draft.choices_text)
      if (choices.length < 2) {
        warnings.push(`${label}: add at least two choices.`)
      }
      if (!choices.some((choice) => choice.isCorrect)) {
        warnings.push(`${label}: mark one correct choice with *.`)
      }
    }
    if (draft.question_type === 'fill_blank' && !lineValues(draft.correct_text_answers).length) {
      warnings.push(`${label}: add at least one accepted answer.`)
    }
    if (draft.question_type === 'ordering' && lineValues(draft.choices_text).length < 2) {
      warnings.push(`${label}: add at least two ordered items.`)
    }
    if (draft.question_type === 'matching' && parseMatchingLines(draft.matching_text).length < 2) {
      warnings.push(`${label}: add at least two matching pairs.`)
    }
    if (draft.question_type === 'code_output' && !draft.expected_output.trim()) {
      warnings.push(`${label}: add expected output.`)
    }
  })

  return warnings
}

function lineValues(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function parseChoiceLines(value: string) {
  return lineValues(value).map((line) => ({
    isCorrect: line.startsWith('*'),
    text: line.replace(/^\*\s*/, '').replace(/^[A-Z][.)]\s*/i, '').trim(),
  })).filter((choice) => choice.text)
}

function parseMatchingLines(value: string) {
  return lineValues(value)
    .map((line) => {
      const [left, right] = line.split('=>')
      return {
        left: (left ?? '').trim(),
        right: (right ?? '').trim(),
      }
    })
    .filter((pair) => pair.left && pair.right)
}

function parseImportedQuestions(value: string, startOrder: number): QuestionDraft[] {
  const blocks = value
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
  const drafts: QuestionDraft[] = []

  blocks.forEach((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const first = lines[0] ?? ''
    const match = first.match(/^(MCQ|TF|FILL|ORDER|MATCH|CODE)\s*:\s*(.*)$/i)
    if (!match) return

    const typeKey = match[1].toUpperCase()
    const prompt = match[2] || lines[1] || ''
    const draft = createEmptyQuestionDraft(startOrder + drafts.length, importType(typeKey))
    draft.prompt = prompt

    const bodyLines = match[2] ? lines.slice(1) : lines.slice(2)
    if (draft.question_type === 'multiple_choice' || draft.question_type === 'true_false') {
      draft.choices_text = bodyLines
        .map((line) => line.replace(/^Answer\s*:\s*/i, '* ').replace(/\s*\(correct\)\s*$/i, ' *'))
        .map((line) => line.endsWith('*') && !line.startsWith('*') ? `* ${line.slice(0, -1).trim()}` : line)
        .map((line) => line.replace(/^\*\s*([A-Z][.)]\s*)/i, '* '))
        .join('\n')
    } else if (draft.question_type === 'fill_blank') {
      draft.correct_text_answers = bodyLines
        .join('\n')
        .replace(/^Answers?\s*:\s*/i, '')
        .split(/[|,]|\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .join('\n')
    } else if (draft.question_type === 'ordering') {
      draft.choices_text = bodyLines.map((line) => line.replace(/^\d+[.)]\s*/, '')).join('\n')
    } else if (draft.question_type === 'matching') {
      draft.matching_text = bodyLines.join('\n')
    } else if (draft.question_type === 'code_output') {
      const outputIndex = bodyLines.findIndex((line) => /^Output\s*:/i.test(line))
      draft.code_snippet = (outputIndex >= 0 ? bodyLines.slice(0, outputIndex) : bodyLines).join('\n')
      draft.expected_output =
        outputIndex >= 0
          ? bodyLines.slice(outputIndex).join('\n').replace(/^Output\s*:\s*/i, '').trim()
          : ''
    }

    drafts.push(draft)
  })

  return drafts
}

function importType(typeKey: string): ModuleActivityQuestionType {
  if (typeKey === 'TF') return 'true_false'
  if (typeKey === 'FILL') return 'fill_blank'
  if (typeKey === 'ORDER') return 'ordering'
  if (typeKey === 'MATCH') return 'matching'
  if (typeKey === 'CODE') return 'code_output'
  return 'multiple_choice'
}

function ActivityPreview({
  drafts,
  instructions,
  mode,
  title,
}: {
  drafts: QuestionDraft[]
  instructions: string
  mode: PreviewMode
  title: string
}) {
  return (
    <div className="activity-preview-surface">
      <div className="lesson-main-activity__header">
        <div>
          <p className="eyebrow">Main Activity</p>
          <h2>{title || 'Main Activity'}</h2>
          <p>{instructions || 'Student instructions will appear here.'}</p>
        </div>
        <span className={mode === 'review' ? 'status-pill status-pill--success' : 'status-pill'}>
          {mode === 'not_started'
            ? 'Not started'
            : mode === 'score_only'
              ? 'Score shown only'
              : 'Review unlocked'}
        </span>
      </div>
      {mode === 'score_only' ? (
        <div className="inline-alert">
          <Icon name="assessment" />
          <span>Score recorded. Correct answers stay hidden while attempts remain.</span>
        </div>
      ) : null}
      {mode === 'review' ? (
        <div className="inline-alert">
          <Icon name="check" />
          <span>Correct answers and explanations are visible in this state.</span>
        </div>
      ) : null}
      <div className="lesson-main-activity__questions">
        {drafts.filter((draft) => draft.is_published).map((draft, index) => (
          <article className="question-card" key={draft.id}>
            <div className="question-card__header">
              <span className="subject-chip">Question {index + 1}</span>
              <span className="status-pill">{draft.points || '1'} pts</span>
            </div>
            <h2>{draft.prompt || 'Question prompt'}</h2>
            <PreviewQuestionBody draft={draft} mode={mode} />
          </article>
        ))}
        {!drafts.filter((draft) => draft.is_published).length ? (
          <p className="admin-empty-line">Published questions will preview here.</p>
        ) : null}
      </div>
    </div>
  )
}

function PreviewQuestionBody({
  draft,
  mode,
}: {
  draft: QuestionDraft
  mode: PreviewMode
}) {
  if (draft.question_type === 'multiple_choice' || draft.question_type === 'true_false') {
    const choices = parseChoiceLines(draft.choices_text)
    return (
      <div className="choice-list">
        {choices.map((choice) => (
          <label className="choice-option" key={choice.text}>
            <input disabled type="radio" />
            <span>{choice.text}</span>
            {mode === 'review' && choice.isCorrect ? <strong className="answer-review__mark">Correct</strong> : null}
          </label>
        ))}
      </div>
    )
  }
  if (draft.question_type === 'ordering') {
    return <p>{lineValues(draft.choices_text).join(' -> ') || 'Ordered items appear here.'}</p>
  }
  if (draft.question_type === 'matching') {
    return <p>{parseMatchingLines(draft.matching_text).map((pair) => mode === 'review' ? `${pair.left}: ${pair.right}` : `${pair.left}: Choose match`).join('; ') || 'Matching pairs appear here.'}</p>
  }
  if (draft.question_type === 'code_output') {
    return (
      <>
        {draft.code_snippet ? <pre>{draft.code_snippet}</pre> : null}
        {mode === 'review' ? <p><strong>Expected output:</strong> {draft.expected_output || 'Missing expected output'}</p> : <textarea disabled rows={3} value="" />}
      </>
    )
  }
  return mode === 'review'
    ? <p><strong>Accepted:</strong> {lineValues(draft.correct_text_answers).join(', ') || 'Missing accepted answer'}</p>
    : <input disabled placeholder="Type your answer" type="text" />
}

function StructuredImportExampleModal({
  onClose,
  onDownload,
}: {
  onClose: () => void
  onDownload: () => void
}) {
  return (
    <div
      aria-labelledby="structured-import-title"
      aria-modal="true"
      className="attendance-modal"
      role="dialog"
    >
      <div className="attendance-modal__backdrop" onClick={onClose} />
      <div className="attendance-modal__panel attendance-modal__panel--wide structured-import-modal">
        <div className="attendance-modal__header">
          <div>
            <span>Structured import</span>
            <strong id="structured-import-title">Example Markdown Format</strong>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className="structured-import-modal__body">
          <p>
            Use one blank line between questions. Mark correct choices with
            <code>*</code>. Imported questions stay editable before saving.
          </p>
          <pre>{structuredImportExample}</pre>
        </div>
        <div className="lesson-editor__actions">
          <button className="button button--secondary" onClick={onDownload} type="button">
            <Icon name="file" />
            <span>Download MD Example</span>
          </button>
          <button className="button button--primary" onClick={onClose} type="button">
            <Icon name="check" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function choicesText(data: RouteData, question: ModuleActivityQuestion) {
  return data.activityChoices
    .filter((choice) => choice.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
    .map((choice) => `${choice.is_correct ? '* ' : ''}${choice.text}`)
    .join('\n')
}

function matchingText(data: RouteData, question: ModuleActivityQuestion) {
  return data.activityMatchingPairs
    .filter((pair) => pair.question === question.id)
    .sort((first, second) => first.order - second.order || first.id - second.id)
    .map((pair) => `${pair.left_text} => ${pair.right_text ?? ''}`)
    .join('\n')
}

async function syncQuestions(
  api: AuthedRequest,
  data: RouteData,
  activityId: number,
  drafts: QuestionDraft[],
  initialDrafts: QuestionDraft[],
) {
  const activeServerIds = new Set(
    drafts
      .filter((draft) => draft.serverId && !draft.deleted)
      .map((draft) => draft.serverId),
  )
  const deletedIds = initialDrafts
    .map((draft) => draft.serverId)
    .filter((id): id is number => Boolean(id) && !activeServerIds.has(id))

  await Promise.all(
    deletedIds.map((id) =>
      api(`/modules/activity-questions/${id}/`, { method: 'DELETE' }),
    ),
  )

  for (const draft of drafts.filter((item) => !item.deleted && item.prompt.trim())) {
    const question = await api<ModuleActivityQuestion>(
      draft.serverId
        ? `/modules/activity-questions/${draft.serverId}/`
        : '/modules/activity-questions/',
      {
        method: draft.serverId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          activity: activityId,
          question_type: draft.question_type,
          prompt: draft.prompt,
          points: draft.points || '1',
          order: Number(draft.order || 0),
          explanation: draft.explanation,
          correct_text_answers: draft.correct_text_answers
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          case_sensitive: draft.case_sensitive,
          code_snippet: draft.code_snippet,
          expected_output: draft.expected_output,
          is_published: draft.is_published,
        }),
      },
    )
    await replaceChoices(api, data, question.id, draft)
    await replaceMatchingPairs(api, data, question.id, draft)
  }
}

async function replaceChoices(
  api: AuthedRequest,
  data: RouteData,
  questionId: number,
  draft: QuestionDraft,
) {
  const existingChoices = data.activityChoices.filter((choice) => choice.question === questionId)
  await Promise.all(
    existingChoices.map((choice) =>
      api(`/modules/activity-choices/${choice.id}/`, { method: 'DELETE' }),
    ),
  )
  if (!['multiple_choice', 'true_false', 'ordering'].includes(draft.question_type)) {
    return
  }
  const lines = draft.choices_text.split('\n').map((line) => line.trim()).filter(Boolean)
  await Promise.all(
    lines.map((line, index) => {
      const isCorrect = line.startsWith('*')
      const text = line.replace(/^\*\s*/, '')
      return api('/modules/activity-choices/', {
        method: 'POST',
        body: JSON.stringify({
          question: questionId,
          text,
          is_correct: draft.question_type === 'ordering' ? false : isCorrect,
          order: index,
        }),
      })
    }),
  )
}

async function replaceMatchingPairs(
  api: AuthedRequest,
  data: RouteData,
  questionId: number,
  draft: QuestionDraft,
) {
  const existingPairs = data.activityMatchingPairs.filter((pair) => pair.question === questionId)
  await Promise.all(
    existingPairs.map((pair) =>
      api(`/modules/activity-matching-pairs/${pair.id}/`, { method: 'DELETE' }),
    ),
  )
  if (draft.question_type !== 'matching') {
    return
  }
  const lines = draft.matching_text.split('\n').map((line) => line.trim()).filter(Boolean)
  await Promise.all(
    lines.map((line, index) => {
      const [left, right] = line.split('=>')
      return api('/modules/activity-matching-pairs/', {
        method: 'POST',
        body: JSON.stringify({
          question: questionId,
          left_text: (left ?? '').trim(),
          right_text: (right ?? '').trim(),
          order: index,
        }),
      })
    }),
  )
}
