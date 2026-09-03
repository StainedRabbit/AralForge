import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { AuthedRequest, RouteData } from '../../app/types'
import type {
  GradeCategory,
  GradingPeriod,
  MainActivityEditorWorkspace,
  MainActivityGradingWorkspace,
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
import { queryKeys } from '../../queries/queryKeys'
import { isJsonObject, migrateStorageValue } from '../../utils/storageMigration'
import {
  compatibilityEncodingNotice,
  countReplacementCharacters,
  decodeTextFile,
  replacementCharacterWarning,
} from '../../utils/textFile'
import { ApiError } from '../../api'
import {
  ActivityQuestionInput,
  type ActivityDraft,
} from '../LessonMainActivityPanel'

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

type RecoveredEditorDraft = {
  baseRevision?: number
  title: string
  instructions: string
  maxAttempts: string
  passingScore: string
  isPublished: boolean
  gradingPeriod?: GradingPeriod | ''
  periodReassignments?: MainActivityBulkAssignmentRequest['assignments']
  questionDrafts: QuestionDraft[]
}

type PeriodChangeDialogState = {
  targetPeriod: GradingPeriod
  workspace: MainActivityGradingWorkspace
  linkedScheduleIds: number[]
  selections: Record<number, string>
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
  linkedClassCount,
  lesson,
  onWorkspaceSaved,
}: {
  api: AuthedRequest
  data: RouteData
  linkedClassCount: number
  lesson: ModuleLesson
  onWorkspaceSaved: (workspace: MainActivityEditorWorkspace) => void
}) {
  const topic = data.moduleTopics.find((item) => item.id === lesson.topic)
  const module = topic ? data.modules.find((item) => item.id === topic.module) : null
  const activity = data.activities.find((item) => item.lesson === lesson.id) ?? null
  const [currentLinkedClassCount, setCurrentLinkedClassCount] = useState(linkedClassCount)
  const initialDrafts = useMemo(
    () => createQuestionDrafts(data, activity),
    [activity, data],
  )
  const recoveryKey = `aralforge.main-activity-draft.${lesson.id}`
  const legacyRecoveryKey = `ezoryx.main-activity-draft.${lesson.id}`
  const recoveredDraft = useMemo(
    () => readRecoveredDraft(recoveryKey, legacyRecoveryKey),
    [legacyRecoveryKey, recoveryKey],
  )
  const recoverableDraft = recoveredDraft && (
    !activity || recoveredDraft.baseRevision === undefined || recoveredDraft.baseRevision === activity.revision
  ) ? recoveredDraft : null
  const [staleRecovery, setStaleRecovery] = useState(Boolean(recoveredDraft && !recoverableDraft))
  const [title, setTitle] = useState(recoverableDraft?.title ?? activity?.title ?? 'Main Activity')
  const [instructions, setInstructions] = useState(recoverableDraft?.instructions ?? activity?.instructions ?? '')
  const [maxAttempts, setMaxAttempts] = useState(recoverableDraft?.maxAttempts ?? String(activity?.max_attempts ?? 3))
  const [passingScore, setPassingScore] = useState(recoverableDraft?.passingScore ?? activity?.passing_score ?? '')
  const [isPublished, setIsPublished] = useState(recoverableDraft?.isPublished ?? activity?.is_published ?? false)
  const [gradingPeriod, setGradingPeriod] = useState<GradingPeriod | ''>(
    recoverableDraft?.gradingPeriod ?? activity?.grading_period ?? '',
  )
  const [periodReassignments, setPeriodReassignments] = useState<MainActivityBulkAssignmentRequest['assignments']>(
    recoverableDraft?.periodReassignments ?? [],
  )
  const [periodChangeDialog, setPeriodChangeDialog] = useState<PeriodChangeDialogState | null>(null)
  const [loadingPeriodChange, setLoadingPeriodChange] = useState(false)
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>(recoverableDraft?.questionDrafts ?? initialDrafts)
  const [savedActivityId, setSavedActivityId] = useState(activity?.id ?? null)
  const [savedRevision, setSavedRevision] = useState(activity?.revision ?? 1)
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('not_started')
  const [importText, setImportText] = useState('')
  const [importEncodingNotice, setImportEncodingNotice] = useState('')
  const [showImportExample, setShowImportExample] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('setup')
  const importReplacementCount = countReplacementCharacters(importText)
  const activeDrafts = questionDrafts.filter((question) => !question.deleted)
  const publishedPoints = activeDrafts
    .filter((question) => question.is_published)
    .reduce((total, question) => total + (Number(question.points) || 0), 0)
  const readinessWarnings = useMemo(
    () => getReadinessWarnings(activeDrafts, title, passingScore, publishedPoints, gradingPeriod),
    [activeDrafts, gradingPeriod, passingScore, publishedPoints, title],
  )
  const draftSignature = JSON.stringify({
    title,
    instructions,
    maxAttempts,
    passingScore,
    isPublished,
    gradingPeriod,
    periodReassignments,
    questionDrafts,
  })
  const savedSignature = useRef(JSON.stringify({
    title: activity?.title ?? 'Main Activity',
    instructions: activity?.instructions ?? '',
    maxAttempts: String(activity?.max_attempts ?? 3),
    passingScore: activity?.passing_score ?? '',
    isPublished: activity?.is_published ?? false,
    gradingPeriod: activity?.grading_period ?? '',
    periodReassignments: [],
    questionDrafts: initialDrafts,
  }))
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  const dirty = draftSignature !== savedSignature.current

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirty && saveState !== 'saving') return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [dirty, saveState])

  useEffect(() => {
    if (dirty) {
      window.localStorage.setItem(recoveryKey, JSON.stringify({
        ...JSON.parse(draftSignature),
        baseRevision: savedRevision,
      }))
    }
  }, [dirty, draftSignature, recoveryKey, savedRevision])

  useEffect(() => {
    if (
      !dirty || saving || activity?.is_published || !gradingPeriod ||
      (isPublished && readinessWarnings.length > 0)
    ) return
    const timer = window.setTimeout(() => void saveActivity(undefined, true), 1200)
    return () => window.clearTimeout(timer)
    // saveActivity intentionally uses the complete signature captured by this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.is_published, draftSignature, dirty, gradingPeriod, isPublished, readinessWarnings.length, saving])

  function moveQuestion(id: string, direction: -1 | 1) {
    setQuestionDrafts((current) => {
      const active = current.filter((question) => !question.deleted)
      const index = active.findIndex((question) => question.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= active.length) return current
      const reordered = [...active]
      ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
      const orders = new Map(reordered.map((question, order) => [question.id, String(order + 1)]))
      return current.map((question) => question.deleted
        ? question
        : { ...question, order: orders.get(question.id) ?? question.order })
    })
  }

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
    setQuestionDrafts((current) => {
      const next = current
        .map((question) =>
          question.id === id
            ? question.serverId
              ? { ...question, deleted: true }
              : null
            : question,
        )
        .filter((question): question is QuestionDraft => Boolean(question))
      let order = 0
      return next.map((question) => question.deleted
        ? question
        : { ...question, order: String(++order) })
    })
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
    if (importReplacementCount > 0) {
      setMessage(replacementCharacterWarning(importReplacementCount))
      return
    }
    const imported = parseImportedQuestions(importText, activeDrafts.length + 1)
    if (!imported.length) {
      setMessage('No questions were found. Start each block with MCQ:, TF:, FILL:, ORDER:, MATCH:, or CODE:.')
      return
    }
    setQuestionDrafts((current) => [...current, ...imported])
    setImportText('')
    setImportEncodingNotice('')
    setMessage(`${imported.length} question${imported.length === 1 ? '' : 's'} imported as drafts.`)
  }

  async function uploadImportFile(file: File | null) {
    if (!file) return
    setImportEncodingNotice('')
    try {
      const decoded = await decodeTextFile(file)
      setImportText(decoded.text)
      setImportEncodingNotice(
        decoded.usedCompatibilityFallback ? compatibilityEncodingNotice(file.name) : '',
      )
      setMessage(`${file.name} loaded into structured import.`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    }
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

  function downloadRecoveryDraft(draft: RecoveredEditorDraft | Record<string, unknown>) {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `main-activity-${lesson.id}-recovery.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function requestGradingPeriodChange(targetPeriod: GradingPeriod) {
    if (!activity || !currentLinkedClassCount || targetPeriod === activity.grading_period) {
      setGradingPeriod(targetPeriod)
      setPeriodReassignments([])
      return
    }

    setLoadingPeriodChange(true)
    setMessage('Loading linked class categories...')
    try {
      const workspace = await api<MainActivityGradingWorkspace>(
        `/modules/activities/${activity.id}/grading-workspace/`,
      )
      const linkedScheduleIds = Array.from(new Set(
        workspace.grade_items
          .filter((item) => {
            const schedule = workspace.schedules.find((candidate) => candidate.id === item.schedule)
            return item.module_activity === activity.id && schedule?.is_active && schedule.term_is_active
          })
          .map((item) => item.schedule as number),
      ))
      const selections = Object.fromEntries(linkedScheduleIds.map((scheduleId) => {
        const schedule = workspace.schedules.find((candidate) => candidate.id === scheduleId)
        const categories = workspace.grade_categories.filter((category) =>
          schedule &&
          category.subject === schedule.subject &&
          category.category === 'QUIZ' &&
          category.grading_period === targetPeriod,
        )
        return [scheduleId, categories.length === 1 ? String(categories[0].id) : '']
      }))
      setPeriodChangeDialog({ targetPeriod, workspace, linkedScheduleIds, selections })
      setMessage('')
    } catch (error) {
      setMessage(`Could not prepare the period change. ${toErrorMessage(error)}`)
    } finally {
      setLoadingPeriodChange(false)
    }
  }

  function confirmGradingPeriodChange() {
    if (!periodChangeDialog) return
    const assignments = periodChangeDialog.linkedScheduleIds.map((schedule) => ({
      schedule,
      grade_category: Number(periodChangeDialog.selections[schedule]),
    }))
    if (assignments.some((assignment) => !assignment.grade_category)) return
    setGradingPeriod(periodChangeDialog.targetPeriod)
    setPeriodReassignments(assignments)
    setPeriodChangeDialog(null)
  }

  async function saveActivity(nextTab?: EditorTab, silent = false) {
    if (!module || !topic) {
      setMessage('Lesson module context is missing.')
      return
    }
    if (!gradingPeriod) {
      setMessage('Select a grading period before saving this Main Activity.')
      setActiveTab('setup')
      return
    }
    if (isPublished && readinessWarnings.length) {
      setMessage(`Fix readiness warnings before publishing: ${readinessWarnings.join(' ')}`)
      return
    }

    setSaving(true)
    setSaveState('saving')
    if (!silent) setMessage('')
    try {
      const workspace = await api<MainActivityEditorWorkspace>(
        '/modules/activities/atomic-save/',
        {
          method: 'PUT',
          body: JSON.stringify({
            id: savedActivityId,
            expected_revision: savedActivityId ? savedRevision : undefined,
            module: module.id,
            topic: topic.id,
            lesson: lesson.id,
            title,
            instructions,
            activity_type: 'INTERACTIVE',
            order: lesson.order,
            max_attempts: Number(maxAttempts || 3),
            passing_score: passingScore || null,
            grading_period: gradingPeriod,
            period_reassignments: periodReassignments,
            accepts_text: false,
            accepts_file: false,
            is_published: isPublished,
            questions: activeDrafts.map(toAtomicQuestion),
          }),
        },
      )
      const savedActivity = workspace.activity
      if (!savedActivity) throw new Error('The saved Main Activity was not returned.')
      setSavedActivityId(savedActivity.id)
      setSavedRevision(savedActivity.revision)
      setRevisionConflict(false)
      savedSignature.current = draftSignature
      window.localStorage.removeItem(recoveryKey)
      setSaveState('saved')
      onWorkspaceSaved(workspace)
      setCurrentLinkedClassCount(workspace.linked_class_count)
      if (!silent) setMessage('Main Activity saved atomically.')
      if (nextTab) setActiveTab(nextTab)
    } catch (caughtError) {
      setSaveState('error')
      if (caughtError instanceof ApiError && caughtError.status === 409) {
        setRevisionConflict(true)
        setMessage('This Main Activity changed in another editor. Your local draft was not overwritten.')
      } else {
        setMessage(`Changes are still in this browser. ${toErrorMessage(caughtError)}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const publishedQuestionCount = activeDrafts.filter((question) => question.is_published).length
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
        subtitle="Website-based, auto-graded lesson work. This Main Activity saves separately from the lesson."
        title="Main Activity"
      />

      <div className="activity-readiness-strip" aria-label="Main Activity readiness summary">
        <span className={!dirty && saveState === 'saved' ? 'status-badge status-badge--ready' : 'status-badge'}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : dirty && activity?.is_published ? 'Unpublished changes' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <span className={isPublished ? 'status-badge status-badge--ready' : 'status-badge'}>
          {isPublished ? 'Published' : 'Draft'}
        </span>
        <span className={publishedQuestionCount ? 'status-badge status-badge--ready' : 'status-badge'}>
          {publishedQuestionCount} published question{publishedQuestionCount === 1 ? '' : 's'}
        </span>
        <span className="status-badge">{publishedPoints} question points</span>
        <span className={gradingPeriod ? 'status-badge status-badge--ready' : 'status-badge'}>
          {gradingPeriod ? formatPeriod(gradingPeriod) : 'Period not selected'}
        </span>
        <span className={currentLinkedClassCount ? 'status-badge status-badge--ready' : 'status-badge'}>
          {currentLinkedClassCount} linked class{currentLinkedClassCount === 1 ? '' : 'es'}
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

      {staleRecovery || revisionConflict ? (
        <section className="activity-readiness activity-readiness--warning" role="alert">
          <div>
            <p className="eyebrow">Version conflict</p>
            <h3>{revisionConflict ? 'A newer server revision is available' : 'An older local recovery draft was found'}</h3>
            <p>Download the local draft before reloading if you need to compare or recover its contents.</p>
          </div>
          <div className="lesson-editor__actions">
            <button className="button button--secondary button--compact" onClick={() => downloadRecoveryDraft(recoveredDraft ?? JSON.parse(draftSignature))} type="button">Download local draft</button>
            <button className="button button--primary button--compact" onClick={() => {
              window.localStorage.removeItem(recoveryKey)
              setStaleRecovery(false)
              window.location.reload()
            }} type="button">Reload server version</button>
          </div>
        </section>
      ) : null}

      <nav className="main-activity-tabs" aria-label="Main Activity editor sections">
        {([
          ['setup', 'Setup'],
          ['questions', `Questions (${activeDrafts.length})`],
          ['import', 'Import'],
          ['preview', 'Preview'],
          ...(activity ? [['grading', `Grading (${currentLinkedClassCount})`]] : []),
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
              <span>Grading period</span>
              <select
                disabled={loadingPeriodChange}
                onChange={(event) => {
                  const period = event.target.value as GradingPeriod
                  if (period) void requestGradingPeriodChange(period)
                }}
                required
                value={gradingPeriod}
              >
                <option disabled value="">Select grading period</option>
                {gradingPeriods.map((period) => <option key={period} value={period}>{formatPeriod(period)}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>Points (from published questions)</span>
              <input disabled type="number" value={publishedPoints} />
            </label>
            <label className="admin-field">
              <span>Max attempts</span>
              <input min={1} onChange={(event) => setMaxAttempts(event.target.value)} type="number" value={maxAttempts} />
            </label>
            <label className="admin-field">
              <span>Passing score</span>
              <input max={publishedPoints} min={0} onChange={(event) => setPassingScore(event.target.value)} type="number" value={passingScore} />
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
                moveQuestion={moveQuestion}
                key={question.id}
                question={question}
                removeQuestion={removeQuestion}
                totalQuestions={activeDrafts.length}
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
          onLinkedClassCountChange={setCurrentLinkedClassCount}
        />
      ) : null}

      {activeTab === 'import' ? (
        <section className="main-activity-tab-panel main-activity-tools main-activity-tools--import">
          <p className="eyebrow">Structured import</p>
          <label className="admin-field">
            <span>Paste blocks starting with MCQ:, TF:, FILL:, ORDER:, MATCH:, or CODE:</span>
            <textarea onChange={(event) => setImportText(event.target.value)} rows={10} value={importText} />
          </label>
          {importEncodingNotice ? <p className="admin-message text-import-notice" role="status">{importEncodingNotice}</p> : null}
          {importReplacementCount ? (
            <p className="admin-message text-import-warning" role="alert">
              {replacementCharacterWarning(importReplacementCount)}
            </p>
          ) : null}
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
            <button className="button button--primary button--compact" disabled={importReplacementCount > 0} onClick={importQuestionDrafts} type="button">
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
      <div className="lesson-editor__actions main-activity-editor__save-actions">
        <button className="button button--secondary" disabled={saving} onClick={() => void saveActivity()} type="button">
          <Icon name="save" />
          <span>{saving ? 'Saving...' : activity?.is_published && dirty ? 'Publish changes' : dirty ? 'Save draft' : 'Saved'}</span>
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
      {periodChangeDialog ? (
        <PeriodChangeDialog
          dialog={periodChangeDialog}
          onCancel={() => setPeriodChangeDialog(null)}
          onConfirm={confirmGradingPeriodChange}
          setSelection={(scheduleId, categoryId) => setPeriodChangeDialog((current) => current ? ({
            ...current,
            selections: { ...current.selections, [scheduleId]: categoryId },
          }) : current)}
        />
      ) : null}
    </section>
  )
}

const gradingPeriods = ['PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'] as const
type AssignmentDraft = {
  selected: boolean
  categoryId: string
}
type ActivityGradingData = Pick<
  RouteData,
  'users' | 'schedules' | 'enrollments' | 'gradeCategories' | 'gradeItems'
>

function ActivityGradingAssignments({
  activity,
  api,
  onLinkedClassCountChange,
}: {
  activity: ModuleActivity
  api: AuthedRequest
  onLinkedClassCountChange: (count: number) => void
}) {
  const workspacePath = `/modules/activities/${activity.id}/grading-workspace/`
  const workspaceQuery = useQuery({
    queryKey: queryKeys.resource(workspacePath),
    queryFn: () => api<MainActivityGradingWorkspace>(workspacePath),
    staleTime: 30_000,
  })
  const fetchedLinkedClassCount = workspaceQuery.data?.linked_class_count

  useEffect(() => {
    if (fetchedLinkedClassCount !== undefined) {
      onLinkedClassCountChange(fetchedLinkedClassCount)
    }
  }, [fetchedLinkedClassCount, onLinkedClassCountChange])

  if (workspaceQuery.isPending) {
    return (
      <section className="main-activity-tab-panel activity-grading-panel">
        <p className="admin-empty-line">Loading class grading details...</p>
      </section>
    )
  }

  if (workspaceQuery.error || !workspaceQuery.data) {
    return (
      <section className="main-activity-tab-panel activity-grading-panel">
        <p className="admin-message" role="alert">
          {toErrorMessage(workspaceQuery.error ?? new Error('Grading details are unavailable.'))}
        </p>
        <button className="button button--secondary" onClick={() => void workspaceQuery.refetch()} type="button">
          Retry
        </button>
      </section>
    )
  }

  const workspace = workspaceQuery.data
  const scopedData: ActivityGradingData = {
    users: workspace.users,
    schedules: workspace.schedules,
    enrollments: workspace.enrollments,
    gradeCategories: workspace.grade_categories,
    gradeItems: workspace.grade_items,
  }

  return (
    <ActivityGradingAssignmentsContent
      activity={activity}
      api={api}
      data={scopedData}
      refresh={async () => { await workspaceQuery.refetch() }}
    />
  )
}

function ActivityGradingAssignmentsContent({
  activity,
  api,
  data,
  refresh,
}: {
  activity: ModuleActivity
  api: AuthedRequest
  data: ActivityGradingData
  refresh: () => Promise<void>
}) {
  const schedules = data.schedules
  const period = activity.grading_period
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
  const [drafts, setDrafts] = useState<Record<number, AssignmentDraft>>(() =>
    Object.fromEntries(schedules.map((schedule) => {
      const existing = existingItemsBySchedule.get(schedule.id)?.[0]
      const category = data.gradeCategories.find((candidate) => candidate.id === existing?.grade_category)
      const automaticCategory = period ? quizCategoriesFor(data, schedule.id, period)[0] : undefined
      return [schedule.id, {
        selected: Boolean(existing) && schedule.is_active && schedule.term_is_active && Boolean(period),
        categoryId: String(category?.grading_period === period ? category.id : automaticCategory?.id ?? ''),
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
    const category = current?.categoryId && data.gradeCategories.some((candidate) =>
      candidate.id === Number(current.categoryId) && candidate.grading_period === period,
    )
      ? current.categoryId
      : String(period ? quizCategoriesFor(data, scheduleId, period)[0]?.id ?? '' : '')
    updateDraft(scheduleId, {
      selected,
      categoryId: category,
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
        <span className={period ? 'status-badge status-badge--ready' : 'status-badge status-badge--error'}>
          {period ? formatPeriod(period) : 'Select a period in Setup'}
        </span>
        <div className="lesson-editor__actions">
          <button
            className="button button--secondary button--compact"
            disabled={!period}
            onClick={() => schedules.filter((schedule) => schedule.is_active && schedule.term_is_active).forEach((schedule) => selectSchedule(schedule.id, true))}
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
          const draft = drafts[schedule.id] ?? { selected: false, categoryId: '' }
          const categories = period ? quizCategoriesFor(data, schedule.id, period) : []
          const existingItems = existingItemsBySchedule.get(schedule.id) ?? []
          const existingItem = existingItems[0]
          const existingCategory = data.gradeCategories.find((category) => category.id === existingItem?.grade_category)
          return (
            <article className={`activity-grading-row${draft.selected ? ' activity-grading-row--selected' : ''}`} key={schedule.id}>
              <label className="activity-grading-row__select">
                <input
                  checked={draft.selected}
                  disabled={!period || !schedule.is_active || !schedule.term_is_active || existingItems.length > 1}
                  onChange={(event) => selectSchedule(schedule.id, event.target.checked)}
                  type="checkbox"
                />
                <span className="activity-grading-row__class">
                   <strong>{schedule.subject_code} {schedule.section || ''}</strong>
                   <span>{schedule.term_name}{schedule.is_active && schedule.term_is_active ? '' : ' · Archived'}</span>
                </span>
              </label>
              <span className={`status-badge ${existingItems.length > 1 ? 'status-badge--error' : existingItem ? 'status-badge--ready' : ''}`}>
                {existingItems.length > 1 ? 'Error: duplicate links' : existingItem ? 'Linked' : 'Not linked'}
              </span>
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
                  No Quiz category for {period ? formatPeriod(period) : 'this period'}. <Link to="/admin/grades">Configure grade categories</Link>.
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

function quizCategoriesFor(data: ActivityGradingData, scheduleId: number, period: GradingPeriod): GradeCategory[] {
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
  moveQuestion,
  question,
  removeQuestion,
  totalQuestions,
  updateQuestion,
}: {
  duplicateQuestion: (question: QuestionDraft) => void
  index: number
  moveQuestion: (id: string, direction: -1 | 1) => void
  question: QuestionDraft
  removeQuestion: (id: string) => void
  totalQuestions: number
  updateQuestion: UpdateQuestion
}) {
  const warnings = getQuestionWarnings(question)
  return (
    <article className={warnings.length ? 'main-activity-question-editor main-activity-question-editor--warning' : 'main-activity-question-editor'}>
      <div className="main-activity-question-editor__header">
        <div>
          <strong>Question {index + 1}</strong>
          <small>{questionTypeOptions.find((option) => option.value === question.question_type)?.label}</small>
        </div>
        <div className="lesson-editor__actions">
          <button
            aria-label={`Move Question ${index + 1} up`}
            className="button button--secondary button--compact"
            disabled={index === 0}
            onClick={() => moveQuestion(question.id, -1)}
            type="button"
          >
            Move up
          </button>
          <button
            aria-label={`Move Question ${index + 1} down`}
            className="button button--secondary button--compact"
            disabled={index === totalQuestions - 1}
            onClick={() => moveQuestion(question.id, 1)}
            type="button"
          >
            Move down
          </button>
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
      {warnings.length ? (
        <ul className="main-activity-question-editor__warnings" aria-label={`Readiness issues for Question ${index + 1}`}>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
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

function getReadinessWarnings(
  drafts: QuestionDraft[],
  title: string,
  passingScore: string,
  publishedPoints: number,
  gradingPeriod: GradingPeriod | '',
) {
  const warnings: string[] = []
  if (!title.trim()) warnings.push('Add an activity title.')
  if (!gradingPeriod) warnings.push('Select a grading period.')
  if (passingScore && Number(passingScore) > publishedPoints) {
    warnings.push('Passing score cannot exceed published question points.')
  }
  if (Number(passingScore) < 0) warnings.push('Passing score cannot be negative.')
  const publishedDrafts = drafts.filter((draft) => draft.is_published)
  if (!publishedDrafts.length) {
    warnings.push('Add at least one published question.')
  }

  publishedDrafts.forEach((draft, index) => {
    const label = `Question ${index + 1}`
    getQuestionWarnings(draft).forEach((warning) => warnings.push(`${label}: ${warning}`))
  })

  return warnings
}

function toAtomicQuestion(draft: QuestionDraft) {
  const choiceLines = parseChoiceLines(draft.choices_text)
  return {
    id: draft.serverId,
    question_type: draft.question_type,
    prompt: draft.prompt,
    points: draft.points || '1',
    order: Number(draft.order || 0),
    explanation: draft.explanation,
    correct_text_answers: lineValues(draft.correct_text_answers),
    case_sensitive: draft.case_sensitive,
    code_snippet: draft.code_snippet,
    expected_output: draft.expected_output,
    is_published: draft.is_published,
    choices: ['multiple_choice', 'true_false', 'ordering'].includes(draft.question_type)
      ? choiceLines.map((choice, index) => ({
          text: choice.text,
          is_correct: draft.question_type === 'ordering' ? false : choice.isCorrect,
          order: index,
        }))
      : [],
    matching_pairs: draft.question_type === 'matching'
      ? parseMatchingLines(draft.matching_text).map((pair, index) => ({
          left_text: pair.left,
          right_text: pair.right,
          order: index,
        }))
      : [],
  }
}

function readRecoveredDraft(key: string, legacyKey: string): RecoveredEditorDraft | null {
  try {
    const value = migrateStorageValue(key, legacyKey, isJsonObject)
    return value ? JSON.parse(value) as RecoveredEditorDraft : null
  } catch {
    return null
  }
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
          <Icon name="activity" />
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
            <PreviewQuestionBody draft={draft} mode={mode} questionId={index + 1} />
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
  questionId,
}: {
  draft: QuestionDraft
  mode: PreviewMode
  questionId: number
}) {
  const choices = parseChoiceLines(draft.choices_text).map((choice, index) => ({
    id: index + 1,
    is_correct: choice.isCorrect,
    text: choice.text,
  }))
  const pairs = parseMatchingLines(draft.matching_text).map((pair, index) => ({
    id: index + 1,
    left_text: pair.left,
    right_text: pair.right,
  }))
  const previewDraft: ActivityDraft = {
    selected_choice: null,
    text_answer: '',
    choice_order: choices.map((choice) => choice.id),
    matching_answer: mode === 'review'
      ? Object.fromEntries(pairs.map((pair) => [String(pair.id), pair.right_text]))
      : {},
  }
  return (
    <>
      {draft.code_snippet ? <pre>{draft.code_snippet}</pre> : null}
      <ActivityQuestionInput
        choices={choices}
        draft={previewDraft}
        matchingOptions={pairs.map((pair) => pair.right_text)}
        number={questionId}
        onChange={() => undefined}
        pairs={pairs}
        question={{ id: questionId, question_type: draft.question_type }}
        readonly
        reviewUnlocked={mode === 'review'}
      />
      {mode === 'review' && draft.question_type === 'fill_blank' ? (
        <p><strong>Accepted:</strong> {lineValues(draft.correct_text_answers).join(', ') || 'Missing accepted answer'}</p>
      ) : null}
      {mode === 'review' && draft.question_type === 'code_output' ? (
        <p><strong>Expected output:</strong> {draft.expected_output || 'Missing expected output'}</p>
      ) : null}
    </>
  )
}

function getQuestionWarnings(draft: QuestionDraft) {
  if (!draft.is_published) return []
  const warnings: string[] = []
  if (!draft.prompt.trim()) warnings.push('Add a prompt.')
  if (draft.question_type === 'multiple_choice' || draft.question_type === 'true_false') {
    const choices = parseChoiceLines(draft.choices_text)
    if (choices.length < 2) warnings.push('Add at least two choices.')
    if (choices.filter((choice) => choice.isCorrect).length !== 1) {
      warnings.push('Mark exactly one correct choice with *.')
    }
  }
  if (draft.question_type === 'fill_blank' && !lineValues(draft.correct_text_answers).length) {
    warnings.push('Add at least one accepted answer.')
  }
  if (draft.question_type === 'ordering' && lineValues(draft.choices_text).length < 2) {
    warnings.push('Add at least two ordered items.')
  }
  if (draft.question_type === 'matching' && parseMatchingLines(draft.matching_text).length < 2) {
    warnings.push('Add at least two matching pairs.')
  }
  if (draft.question_type === 'code_output' && !draft.expected_output.trim()) {
    warnings.push('Add expected output.')
  }
  return warnings
}

function PeriodChangeDialog({
  dialog,
  onCancel,
  onConfirm,
  setSelection,
}: {
  dialog: PeriodChangeDialogState
  onCancel: () => void
  onConfirm: () => void
  setSelection: (scheduleId: number, categoryId: string) => void
}) {
  const rows = dialog.linkedScheduleIds.map((scheduleId) => {
    const schedule = dialog.workspace.schedules.find((candidate) => candidate.id === scheduleId)
    const linkedItems = dialog.workspace.grade_items.filter((item) => item.schedule === scheduleId)
    const categories = dialog.workspace.grade_categories.filter((category) =>
      schedule &&
      category.subject === schedule.subject &&
      category.category === 'QUIZ' &&
      category.grading_period === dialog.targetPeriod,
    )
    return { categories, duplicate: linkedItems.length > 1, schedule, scheduleId }
  })
  const ready = rows.every((row) =>
    row.schedule && !row.duplicate && Boolean(dialog.selections[row.scheduleId]),
  )

  return (
    <div aria-labelledby="period-change-title" aria-modal="true" className="attendance-modal" role="dialog">
      <div className="attendance-modal__backdrop" onClick={onCancel} />
      <div className="attendance-modal__panel attendance-modal__panel--wide">
        <div className="attendance-modal__header">
          <div>
            <span>Main Activity grading</span>
            <strong id="period-change-title">Change period to {formatPeriod(dialog.targetPeriod)}</strong>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onCancel} type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className="structured-import-modal__body">
          <p>Choose the replacement Quiz category for every linked class. Existing item scores will be preserved and recalculated in the new period.</p>
          <div className="activity-grading-list">
            {rows.map(({ categories, duplicate, schedule, scheduleId }) => (
              <article className="activity-grading-row activity-grading-row--selected" key={scheduleId}>
                <span className="activity-grading-row__class">
                  <strong>{schedule ? `${schedule.subject_code} ${schedule.section || ''}` : `Class #${scheduleId}`}</strong>
                  <span>{schedule?.term_name ?? 'Class details unavailable'}</span>
                </span>
                <label className="admin-field">
                  <span>Replacement Quiz category</span>
                  <select
                    disabled={!schedule || duplicate || !categories.length}
                    onChange={(event) => setSelection(scheduleId, event.target.value)}
                    value={dialog.selections[scheduleId] ?? ''}
                  >
                    <option value="">Select Quiz category</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                {duplicate ? <p className="admin-message">Resolve duplicate gradebook links before changing the period.</p> : null}
                {!duplicate && !categories.length ? (
                  <p className="admin-message">
                    No Quiz category for {formatPeriod(dialog.targetPeriod)}. <Link to="/admin/grades">Configure grade categories</Link>.
                  </p>
                ) : null}
              </article>
            ))}
          </div>
          <div className="lesson-editor__actions">
            <button className="button button--secondary" onClick={onCancel} type="button">Cancel</button>
            <button className="button button--primary" disabled={!ready} onClick={onConfirm} type="button">
              Confirm replacements
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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
