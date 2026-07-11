import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../app/types'
import { ActivityCard } from '../components/cards'
import { Icon } from '../components/Icon'
import { LessonExampleCards } from '../components/LessonExampleCards'
import { LessonMainActivityPanel } from '../components/LessonMainActivityPanel'
import { RichLessonText } from '../components/RichLessonText'
import { NotFoundState, Page, PageHeader } from '../components/ui'
import { useActiveLessonSection } from '../hooks/useActiveLessonSection'
import type { ModuleLesson, ModuleTopic } from '../types'
import { toErrorMessage } from '../utils/format'
import {
  getLessonSections,
  lessonSectionId,
  lessonsForTopic,
  topicsForModule,
} from '../utils/modules'
import {
  hasActiveModuleAccess,
  isMockAssessment,
  moduleAccessLabel,
} from '../utils/student'

export function ModuleDetailPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const { moduleId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewedLessonIds = useRef(new Set<number>())
  const [progressMessage, setProgressMessage] = useState('')
  const [savingProgress, setSavingProgress] = useState(false)
  const module = data.modules.find((item) => item.id === Number(moduleId))
  const topics = topicsForModule(data.moduleTopics, module?.id ?? null).filter(
    (topic) => topic.is_published,
  )
  const publishedLessons = topics.flatMap((topic) =>
    lessonsForTopic(data.moduleLessons, topic.id).filter(
      (lesson) => lesson.is_published,
    ),
  )
  const requestedTopicId = Number(searchParams.get('topic')) || null
  const requestedLessonId = Number(searchParams.get('lesson')) || null
  const selectedLesson =
    publishedLessons.find((lesson) => lesson.id === requestedLessonId) ?? null
  const selectedTopic =
    (selectedLesson
      ? topics.find((topic) => topic.id === selectedLesson.topic)
      : topics.find((topic) => topic.id === requestedTopicId)) ?? null
  const currentUserId = data.currentUser?.id ?? null
  const studentLessonProgress = useMemo(
    () =>
      data.lessonProgress.filter(
        (progress) => !currentUserId || progress.student === currentUserId,
      ),
    [currentUserId, data.lessonProgress],
  )
  const selectedProgress = selectedLesson
    ? studentLessonProgress.find((progress) => progress.lesson === selectedLesson.id) ?? null
    : null
  const completedLessonIds = new Set(
    studentLessonProgress
      .filter((progress) => progress.completed_at)
      .map((progress) => progress.lesson),
  )
  const startedLessonIds = new Set(
    studentLessonProgress.map((progress) => progress.lesson),
  )
  const resumeLesson =
    [...studentLessonProgress]
      .filter(
        (progress) =>
          !progress.completed_at &&
          publishedLessons.some((lesson) => lesson.id === progress.lesson),
      )
      .sort(
        (first, second) =>
          new Date(second.last_viewed_at).getTime() -
          new Date(first.last_viewed_at).getTime(),
      )
      .map((progress) =>
        publishedLessons.find((lesson) => lesson.id === progress.lesson),
      )
      .find((lesson): lesson is ModuleLesson => Boolean(lesson)) ??
    publishedLessons.find((lesson) => !completedLessonIds.has(lesson.id)) ??
    publishedLessons[0] ??
    null
  const completedCount = publishedLessons.filter((lesson) =>
    completedLessonIds.has(lesson.id),
  ).length
  const completionPercent = publishedLessons.length
    ? Math.round((completedCount / publishedLessons.length) * 100)
    : 0

  useEffect(() => {
    if (!selectedLesson || requestedTopicId === selectedLesson.topic) {
      return
    }
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('topic', String(selectedLesson.topic))
    setSearchParams(nextParams, { replace: true })
  }, [
    requestedTopicId,
    searchParams,
    selectedLesson,
    setSearchParams,
  ])

  useEffect(() => {
    if (
      !selectedLesson ||
      !currentUserId ||
      viewedLessonIds.current.has(selectedLesson.id)
    ) {
      return
    }

    viewedLessonIds.current.add(selectedLesson.id)
    const progress = data.lessonProgress.find(
      (item) =>
        item.lesson === selectedLesson.id && item.student === currentUserId,
    )
    const timer = window.setTimeout(async () => {
      try {
        if (progress) {
          await api(`/modules/lesson-progress/${progress.id}/`, {
            body: JSON.stringify({}),
            method: 'PATCH',
          })
        } else {
          await api('/modules/lesson-progress/', {
            body: JSON.stringify({
              lesson: selectedLesson.id,
              student: currentUserId,
            }),
            method: 'POST',
          })
        }
        await refresh()
      } catch (caughtError) {
        setProgressMessage(toErrorMessage(caughtError))
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [api, currentUserId, data.lessonProgress, refresh, selectedLesson])

  async function toggleLessonComplete() {
    if (!selectedLesson || !currentUserId) {
      return
    }

    setSavingProgress(true)
    setProgressMessage('')
    try {
      const completedAt = selectedProgress?.completed_at
        ? null
        : new Date().toISOString()
      if (selectedProgress) {
        await api(`/modules/lesson-progress/${selectedProgress.id}/`, {
          body: JSON.stringify({ completed_at: completedAt }),
          method: 'PATCH',
        })
      } else {
        await api('/modules/lesson-progress/', {
          body: JSON.stringify({
            completed_at: completedAt,
            lesson: selectedLesson.id,
            student: currentUserId,
          }),
          method: 'POST',
        })
      }
      await refresh()
    } catch (caughtError) {
      setProgressMessage(toErrorMessage(caughtError))
    } finally {
      setSavingProgress(false)
    }
  }

  function openLesson(lesson: ModuleLesson) {
    setSearchParams({
      lesson: String(lesson.id),
      topic: String(lesson.topic),
    })
  }

  function openTopic(topic: ModuleTopic) {
    setSearchParams({ topic: String(topic.id) })
  }

  function openContents() {
    setSearchParams({})
  }

  if (!module) {
    return (
      <Page>
        <NotFoundState
          message="This module is not available for your active classes."
          to="/modules"
        />
      </Page>
    )
  }

  if (!hasActiveModuleAccess(data, module)) {
    return (
      <Page>
        <PageHeader
          eyebrow="Module access"
          title={module.title}
          description={module.description || 'Learning module'}
        />
        <LockedModuleDetail api={api} module={module} />
      </Page>
    )
  }

  const moduleSubjectIds = Array.from(
    new Set([
      ...(module.subject ? [module.subject] : []),
      ...module.subjects,
    ]),
  )
  const subjects = moduleSubjectIds
    .map((id) => data.subjects.find((subject) => subject.id === id))
    .filter(Boolean)

  return (
    <Page>
      <PageHeader
        eyebrow={subjects.map((subject) => subject?.code).join(' / ') || 'Module'}
        title={module.title}
        description={module.description || 'Learning module'}
        actions={
          <>
            <span className={module.is_accessible ? 'status-pill status-pill--success' : 'status-pill'}>
              <Icon name={module.is_paid ? 'shield' : 'spark'} />
              {moduleAccessLabel(data, module)}
            </span>
            {selectedTopic ? (
              <button
                className="button button--secondary"
                onClick={openContents}
                type="button"
              >
                <Icon name="module" />
                <span>Module Contents</span>
              </button>
            ) : null}
            <ModulePdfButton api={api} module={module} />
          </>
        }
      />

      {selectedLesson && selectedTopic ? (
        <StudentLessonReader
          api={api}
          apiMessage={progressMessage}
          completed={Boolean(selectedProgress?.completed_at)}
          completedLessonIds={completedLessonIds}
          data={data}
          lesson={selectedLesson}
          onOpenContents={openContents}
          onOpenTopic={() => openTopic(selectedTopic)}
          onSelectLesson={openLesson}
          onToggleComplete={toggleLessonComplete}
          publishedLessons={publishedLessons}
          refresh={refresh}
          savingProgress={savingProgress}
          startedLessonIds={startedLessonIds}
          topic={selectedTopic}
          topicLessons={lessonsForTopic(data.moduleLessons, selectedTopic.id).filter(
            (lesson) => lesson.is_published,
          )}
        />
      ) : selectedTopic ? (
        <TopicOverview
          completedLessonIds={completedLessonIds}
          data={data}
          onOpenContents={openContents}
          onOpenLesson={openLesson}
          startedLessonIds={startedLessonIds}
          topic={selectedTopic}
        />
      ) : (
        <ModuleContents
          completedLessonIds={completedLessonIds}
          completionPercent={completionPercent}
          data={data}
          hasStarted={studentLessonProgress.length > 0}
          moduleId={module.id}
          moduleOverview={module.lesson_overview}
          moduleOutcomes={module.learning_objectives}
          onOpenLesson={openLesson}
          onOpenTopic={openTopic}
          resumeLesson={resumeLesson}
          startedLessonIds={startedLessonIds}
          topics={topics}
        />
      )}
    </Page>
  )
}

function LockedModuleDetail({
  api,
  module,
}: {
  api: AuthedRequest
  module: WorkspaceData['modules'][number]
}) {
  return (
    <section className="locked-module-detail section-block">
      <span className="locked-module-summary__icon">
        <Icon name="shield" />
      </span>
      <div>
        <p className="eyebrow">Offline study</p>
        <h2>PDF available</h2>
        <p>
          Download the module PDF now. After the {Number(module.price).toFixed(2)}
          {' '}cash payment, your teacher will activate web lessons, activities,
          coding exercises, assessments, mock exams, and progress tracking for five
          months.
        </p>
      </div>
      <ModulePdfButton api={api} module={module} />
    </section>
  )
}

function ModulePdfButton({
  api,
  module,
}: {
  api: AuthedRequest
  module: WorkspaceData['modules'][number]
}) {
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState('')

  async function downloadPdf() {
    setDownloading(true)
    setMessage('')
    try {
      const blob = await api<Blob>(
        `/modules/modules/${module.id}/download-pdf/`,
      )
      downloadBlob(blob, `${module.slug || 'module'}.pdf`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError) || 'Printable PDF is not available yet.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <button
        className="button button--secondary"
        disabled={downloading}
        onClick={() => void downloadPdf()}
        type="button"
      >
        <Icon name="file" />
        <span>{downloading ? 'Downloading...' : 'Download Module PDF'}</span>
      </button>
      {message ? <p className="admin-message">{message}</p> : null}
    </>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function ModuleContents({
  completedLessonIds,
  completionPercent,
  data,
  hasStarted,
  moduleId,
  moduleOutcomes,
  moduleOverview,
  onOpenLesson,
  onOpenTopic,
  resumeLesson,
  startedLessonIds,
  topics,
}: {
  completedLessonIds: Set<number>
  completionPercent: number
  data: WorkspaceData
  hasStarted: boolean
  moduleId: number
  moduleOutcomes: string
  moduleOverview: string
  onOpenLesson: (lesson: ModuleLesson) => void
  onOpenTopic: (topic: ModuleTopic) => void
  resumeLesson: ModuleLesson | null
  startedLessonIds: Set<number>
  topics: ModuleTopic[]
}) {
  return (
    <div className="student-module-contents">
      <section className="student-module-overview section-block">
        <div className="student-module-overview__header">
          <div>
            <p className="eyebrow">Complete digital module</p>
            <h2>Module Contents</h2>
            <p>{moduleOverview || 'Explore the competency topics and lessons in curriculum order.'}</p>
          </div>
          {resumeLesson ? (
            <button className="button button--primary" onClick={() => onOpenLesson(resumeLesson)} type="button">
              <Icon name="arrow-right" />
              <span>
                {completionPercent === 100
                  ? 'Review Module'
                  : hasStarted
                    ? 'Resume Module'
                    : 'Start Module'}
              </span>
            </button>
          ) : null}
        </div>
        <div className="student-module-progress">
          <div>
            <strong>{completionPercent}% complete</strong>
            <span>{topics.length} competency topic{topics.length === 1 ? '' : 's'}</span>
          </div>
          <span
            aria-label="Module completion"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={completionPercent}
            className="student-module-progress__track"
            role="progressbar"
          >
            <span style={{ width: `${completionPercent}%` }} />
          </span>
        </div>
        {moduleOutcomes ? (
          <details className="student-module-outcomes">
            <summary>Overall learning outcomes</summary>
            <RichLessonText value={moduleOutcomes} />
          </details>
        ) : null}
      </section>

      <div className="student-topic-chapters">
        {topics.map((topic, topicIndex) => {
          const lessons = lessonsForTopic(data.moduleLessons, topic.id).filter(
            (lesson) => lesson.is_published,
          )
          const topicCompleted = lessons.filter((lesson) =>
            completedLessonIds.has(lesson.id),
          ).length
          return (
            <section className="student-topic-chapter" key={topic.id}>
              <div className="student-topic-chapter__header">
                <span>{String(topicIndex + 1).padStart(2, '0')}</span>
                <div>
                  <p>{topic.unit || topic.competency_code || 'Competency topic'}</p>
                  <h2>{topic.title}</h2>
                  <RichLessonText value={topic.overview} />
                </div>
                <small>{topicCompleted}/{lessons.length} lessons</small>
              </div>
              {topic.essential_question ? (
                <div className="student-topic-question">
                  <strong>Essential Question</strong>
                  <p>{topic.essential_question}</p>
                </div>
              ) : null}
              <div className="student-topic-lesson-list">
                {lessons.map((lesson) => (
                  <button key={lesson.id} onClick={() => onOpenLesson(lesson)} type="button">
                    <span className={completedLessonIds.has(lesson.id) ? 'complete' : ''}>
                      <Icon name={completedLessonIds.has(lesson.id) ? 'check' : 'book'} />
                    </span>
                    <div>
                      <strong>{lesson.title}</strong>
                      <small>
                        {completedLessonIds.has(lesson.id)
                          ? 'Completed'
                          : startedLessonIds.has(lesson.id)
                            ? 'In progress'
                            : 'Not started'}
                      </small>
                    </div>
                    <Icon name="arrow-right" />
                  </button>
                ))}
              </div>
              <button
                className="student-topic-open"
                onClick={() => onOpenTopic(topic)}
                type="button"
              >
                <span>View topic overview</span>
                <Icon name="arrow-right" />
              </button>
              {(topic.performance_task || topic.success_criteria) ? (
                <details className="student-topic-task">
                  <summary>Topic performance task</summary>
                  {topic.performance_task ? <RichLessonText value={topic.performance_task} /> : null}
                  {topic.success_criteria ? (
                    <>
                      <h3>Success Criteria</h3>
                      <RichLessonText value={topic.success_criteria} />
                    </>
                  ) : null}
                </details>
              ) : null}
            </section>
          )
        })}
      </div>
      <ModuleMockAssessments data={data} moduleId={moduleId} />
    </div>
  )
}

function TopicOverview({
  completedLessonIds,
  data,
  onOpenContents,
  onOpenLesson,
  startedLessonIds,
  topic,
}: {
  completedLessonIds: Set<number>
  data: WorkspaceData
  onOpenContents: () => void
  onOpenLesson: (lesson: ModuleLesson) => void
  startedLessonIds: Set<number>
  topic: ModuleTopic
}) {
  const lessons = lessonsForTopic(data.moduleLessons, topic.id).filter(
    (lesson) => lesson.is_published,
  )
  const completedCount = lessons.filter((lesson) =>
    completedLessonIds.has(lesson.id),
  ).length
  const topicPercent = lessons.length
    ? Math.round((completedCount / lessons.length) * 100)
    : 0
  const recentIncompleteLesson =
    [...data.lessonProgress]
      .filter(
        (progress) =>
          !progress.completed_at &&
          lessons.some((lesson) => lesson.id === progress.lesson),
      )
      .sort(
        (first, second) =>
          new Date(second.last_viewed_at).getTime() -
          new Date(first.last_viewed_at).getTime(),
      )
      .map((progress) =>
        lessons.find((lesson) => lesson.id === progress.lesson),
      )
      .find((lesson): lesson is ModuleLesson => Boolean(lesson)) ?? null
  const nextLesson =
    recentIncompleteLesson ??
    lessons.find((lesson) => !completedLessonIds.has(lesson.id)) ??
    lessons[0] ??
    null
  const hasStarted = lessons.some((lesson) => startedLessonIds.has(lesson.id))

  return (
    <div className="student-topic-overview">
      <section className="student-topic-overview__hero section-block">
        <div className="student-topic-overview__breadcrumbs">
          <button onClick={onOpenContents} type="button">
            <Icon name="module" />
            <span>Module Contents</span>
          </button>
          <span>/</span>
          <strong>Topic {topic.order}</strong>
        </div>
        <div className="student-topic-overview__heading">
          <div>
            <p className="eyebrow">{topic.unit || topic.competency_code || 'Competency topic'}</p>
            <h2>{topic.title}</h2>
            <RichLessonText value={topic.overview} />
          </div>
          {nextLesson ? (
            <button
              className="button button--primary"
              onClick={() => onOpenLesson(nextLesson)}
              type="button"
            >
              <Icon name="arrow-right" />
              <span>
                {completedCount === lessons.length
                  ? 'Review Topic'
                  : hasStarted
                    ? 'Continue Topic'
                    : 'Start Topic'}
              </span>
            </button>
          ) : null}
        </div>
        <div className="student-module-progress">
          <div>
            <strong>{topicPercent}% complete</strong>
            <span>{completedCount} of {lessons.length} lessons completed</span>
          </div>
          <span
            aria-label="Topic completion"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={topicPercent}
            className="student-module-progress__track"
            role="progressbar"
          >
            <span style={{ width: `${topicPercent}%` }} />
          </span>
        </div>
      </section>

      <section className="student-topic-framework section-block">
        {topic.essential_question ? (
          <TopicContext
            label="Essential Question"
            value={topic.essential_question}
          />
        ) : null}
        {topic.enduring_understanding ? (
          <TopicContext
            label="Enduring Understanding"
            value={topic.enduring_understanding}
          />
        ) : null}
        {topic.performance_task ? (
          <TopicContext label="Performance Task" value={topic.performance_task} />
        ) : null}
        {topic.success_criteria ? (
          <TopicContext label="Success Criteria" value={topic.success_criteria} />
        ) : null}
      </section>

      <section className="student-topic-lessons section-block">
        <div className="student-topic-lessons__header">
          <div>
            <p className="eyebrow">Learning sequence</p>
            <h2>Lessons</h2>
          </div>
          <span>{lessons.length} lesson{lessons.length === 1 ? '' : 's'}</span>
        </div>
        <div className="student-topic-lesson-list">
          {lessons.map((lesson) => {
            const completed = completedLessonIds.has(lesson.id)
            return (
              <button
                key={lesson.id}
                onClick={() => onOpenLesson(lesson)}
                type="button"
              >
                <span className={completed ? 'complete' : ''}>
                  <Icon name={completed ? 'check' : 'book'} />
                </span>
                <div>
                  <small>Lesson {lesson.order}</small>
                  <strong>{lesson.title}</strong>
                  <small>
                    {completed
                      ? 'Completed'
                      : startedLessonIds.has(lesson.id)
                        ? 'In progress'
                        : 'Not started'}
                  </small>
                </div>
                <Icon name="arrow-right" />
              </button>
            )
          })}
        </div>
      </section>

      <TopicActivities data={data} topic={topic} />
    </div>
  )
}

function TopicContext({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <strong>{label}</strong>
      <RichLessonText value={value} />
    </article>
  )
}

function StudentLessonReader({
  api,
  apiMessage,
  completed,
  completedLessonIds,
  data,
  lesson,
  onOpenContents,
  onOpenTopic,
  onSelectLesson,
  onToggleComplete,
  publishedLessons,
  refresh,
  savingProgress,
  startedLessonIds,
  topic,
  topicLessons,
}: {
  api: AuthedRequest
  apiMessage: string
  completed: boolean
  completedLessonIds: Set<number>
  data: WorkspaceData
  lesson: ModuleLesson
  onOpenContents: () => void
  onOpenTopic: () => void
  onSelectLesson: (lesson: ModuleLesson) => void
  onToggleComplete: () => Promise<void>
  publishedLessons: ModuleLesson[]
  refresh: () => Promise<void>
  savingProgress: boolean
  startedLessonIds: Set<number>
  topic: ModuleTopic
  topicLessons: ModuleLesson[]
}) {
  const [sectionContainer, setSectionContainer] = useState<HTMLElement | null>(null)
  const [pdfMessage, setPdfMessage] = useState('')
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const lessonHeadingRef = useRef<HTMLElement | null>(null)
  const lessonExamples = useMemo(
    () => data.lessonExamples.filter((example) => example.lesson === lesson.id),
    [data.lessonExamples, lesson.id],
  )
  const lessonSections = useMemo(
    () => getLessonSections(lesson, { hasStructuredExamples: lessonExamples.length > 0 }),
    [lesson, lessonExamples.length],
  )
  const mainActivity =
    data.activities.find(
      (activity) =>
        activity.lesson === lesson.id &&
        activity.activity_type === 'INTERACTIVE' &&
        activity.is_published,
    ) ?? null
  const mainActivityAttempts = useMemo(
    () =>
      mainActivity
        ? data.activityAttempts.filter((attempt) => attempt.activity === mainActivity.id)
        : [],
    [data.activityAttempts, mainActivity],
  )
  const submittedMainActivityAttempts = mainActivityAttempts.filter(
    (attempt) => attempt.is_submitted,
  )
  const mainActivitySubmitted = mainActivityAttempts.some(
    (attempt) => attempt.is_submitted,
  )
  const mainActivityReviewUnlocked = Boolean(
    mainActivity &&
      (submittedMainActivityAttempts.length >= mainActivity.max_attempts ||
        submittedMainActivityAttempts.some(
          (attempt) =>
            Number(attempt.max_score) > 0 &&
            Number(attempt.score ?? 0) >= Number(attempt.max_score),
        )),
  )
  const completionBlocked = Boolean(
    mainActivity && !mainActivitySubmitted && !completed,
  )
  const challengeSection =
    lessonSections.find((section) => section.title === 'Challenge Task') ?? null
  const openMainActivityAttempt = mainActivityAttempts.find((attempt) => !attempt.is_submitted)
  const attemptsRemaining = mainActivity
    ? Math.max(mainActivity.max_attempts - mainActivityAttempts.length, 0)
    : 0
  const bestMainActivityAttempt = submittedMainActivityAttempts
    .filter((attempt) => attempt.score !== null)
    .sort((first, second) => Number(second.score ?? 0) - Number(first.score ?? 0))[0] ?? null
  const mainActivityStatus = mainActivity
    ? mainActivityReviewUnlocked
      ? 'Review unlocked'
      : openMainActivityAttempt
        ? 'In progress'
        : mainActivitySubmitted
          ? attemptsRemaining > 0
            ? 'Submitted - retry available'
            : 'Submitted'
          : 'Not started'
    : 'No Main Activity'
  const challengeStatus = challengeSection
    ? mainActivity
      ? mainActivityReviewUnlocked
        ? 'Challenge unlocked'
        : 'Challenge locked'
      : 'Challenge available'
    : 'No challenge'
  const completeButtonLabel = savingProgress
    ? 'Saving...'
    : completed
      ? 'Mark Incomplete'
      : completionBlocked
        ? 'Finish Main Activity first'
        : 'Mark Complete'
  const displayedLessonSections = useMemo(
    () =>
      mainActivity
        ? lessonSections.filter((section) => section.title !== 'Challenge Task')
        : lessonSections,
    [lessonSections, mainActivity],
  )
  const sectionIds = useMemo(
    () => displayedLessonSections.map((section) => lessonSectionId(section.title)),
    [displayedLessonSections],
  )
  const activeSectionId = useActiveLessonSection(sectionContainer, sectionIds)
  const lessonIndex = publishedLessons.findIndex((item) => item.id === lesson.id)
  const previousLesson = lessonIndex > 0 ? publishedLessons[lessonIndex - 1] : null
  const nextLesson =
    lessonIndex >= 0 && lessonIndex < publishedLessons.length - 1
      ? publishedLessons[lessonIndex + 1]
      : null
  const lessonPositionLabel = `Lesson ${lessonIndex + 1} of ${publishedLessons.length}`
  const completionStatusLabel = completed
    ? 'Completed'
    : completionBlocked
      ? 'Main Activity needed'
      : startedLessonIds.has(lesson.id)
        ? 'In progress'
        : 'Ready to start'
  const nextActionLabel = completed
    ? nextLesson
      ? 'Next Lesson'
      : 'Review Module Contents'
    : completionBlocked
      ? 'Go to Main Activity'
      : mainActivityReviewUnlocked && challengeSection
        ? 'Go to Challenge'
        : 'Mark Complete'
  useEffect(() => {
    window.requestAnimationFrame(() => {
      lessonHeadingRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      })
    })
  }, [lesson.id])

  async function downloadLessonPdf() {
    setPdfDownloading(true)
    setPdfMessage('')
    try {
      const blob = await api<Blob>(`/modules/lessons/${lesson.id}/download_pdf/`)
      downloadBlob(blob, `${slugify(lesson.title) || 'lesson'}.pdf`)
    } catch (caughtError) {
      setPdfMessage(toErrorMessage(caughtError) || 'Printable PDF is not available yet.')
    } finally {
      setPdfDownloading(false)
    }
  }

  function runNextAction() {
    if (completed) {
      if (nextLesson) {
        onSelectLesson(nextLesson)
      } else {
        onOpenContents()
      }
      return
    }

    if (completionBlocked) {
      scrollToStudentSection('main-activity')
      return
    }

    if (mainActivityReviewUnlocked && challengeSection) {
      scrollToStudentSection(lessonSectionId(challengeSection.title))
      return
    }

    void onToggleComplete()
  }

  return (
    <div className="student-lesson-reader">
      <section className="student-reading-position" aria-label="Reading position">
        <div>
          <span>{topic.title}</span>
          <strong>{lessonPositionLabel}</strong>
          <small>{completionStatusLabel}</small>
        </div>
        <button
          className="button button--secondary button--compact"
          disabled={savingProgress}
          onClick={runNextAction}
          type="button"
        >
          <Icon name={completed && nextLesson ? 'arrow-right' : completed ? 'module' : completionBlocked ? 'assessment' : 'check'} />
          <span>{nextActionLabel}</span>
        </button>
      </section>
      <section
        className="student-lesson-context section-block"
        id="selected-lesson"
        ref={lessonHeadingRef}
      >
        <div>
          <div className="student-lesson-breadcrumbs">
            <button onClick={onOpenContents} type="button">Module Contents</button>
            <span>/</span>
            <button onClick={onOpenTopic} type="button">{topic.title}</button>
          </div>
          <p className="eyebrow">Lesson {lesson.order}</p>
          <h2>{lesson.title}</h2>
          <p>{topic.essential_question || topic.overview}</p>
        </div>
        <div className="student-lesson-context__actions">
          <button
            className={completed ? 'button button--secondary' : 'button button--primary'}
            disabled={savingProgress || completionBlocked}
            onClick={() => void onToggleComplete()}
            type="button"
          >
            <Icon name="check" />
            <span>{completeButtonLabel}</span>
          </button>
          <button
            className="button button--secondary"
            disabled={pdfDownloading}
            onClick={() => void downloadLessonPdf()}
            type="button"
          >
            <Icon name="file" />
            <span>{pdfDownloading ? 'Downloading...' : 'Download Printable PDF'}</span>
          </button>
        </div>
      </section>
      {pdfMessage ? <p className="admin-message">{pdfMessage}</p> : null}
      {apiMessage ? <p className="admin-message">{apiMessage}</p> : null}
      {mainActivity ? (
        <section className="lesson-progress-status">
          <div>
            <p className="eyebrow">Main Activity status</p>
            <h3>{mainActivityStatus}</h3>
            <p>
              {bestMainActivityAttempt
                ? `Best score: ${bestMainActivityAttempt.score}/${bestMainActivityAttempt.max_score}. `
                : ''}
              {mainActivityReviewUnlocked
                ? 'Review the answers, then continue to the challenge.'
                : attemptsRemaining > 0
                  ? `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`
                  : 'No attempts remaining.'}
            </p>
          </div>
          <div className="lesson-progress-status__actions">
            <span className={mainActivityReviewUnlocked ? 'status-pill status-pill--success' : 'status-pill'}>
              <Icon name={mainActivityReviewUnlocked ? 'check' : 'assessment'} />
              {challengeStatus}
            </span>
            {mainActivityReviewUnlocked && challengeSection ? (
              <button
                className="button button--secondary button--compact"
                onClick={() => scrollToStudentSection(lessonSectionId(challengeSection.title))}
                type="button"
              >
                <Icon name="arrow-right" />
                <span>Go to Challenge</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <div className="module-lesson-strip" aria-label="Topic lessons">
        {topicLessons.map((topicLesson) => (
          <button
            className={[
              'module-lesson-chip',
              topicLesson.id === lesson.id ? 'active' : '',
              completedLessonIds.has(topicLesson.id) ? 'complete' : '',
            ].filter(Boolean).join(' ')}
            key={topicLesson.id}
            onClick={() => onSelectLesson(topicLesson)}
            type="button"
          >
            <span>Lesson {topicLesson.order || '-'}</span>
            <strong>{topicLesson.title}</strong>
            <small>
              {topicLesson.id === lesson.id
                ? 'Current'
                : completedLessonIds.has(topicLesson.id)
                  ? 'Completed'
                  : startedLessonIds.has(topicLesson.id)
                    ? 'In progress'
                    : 'Not started'}
            </small>
          </button>
        ))}
      </div>
      <article
        className="reading-panel student-lesson-material"
        ref={setSectionContainer}
      >
        {lessonSections.length ? (
          <nav className="lesson-section-nav" aria-label="Lesson sections">
            {displayedLessonSections.map((section) => {
              const sectionId = lessonSectionId(section.title)
              return (
                <button
                  aria-current={activeSectionId === sectionId ? 'location' : undefined}
                  className={activeSectionId === sectionId ? 'active' : ''}
                  key={section.title}
                  onClick={() => scrollToStudentSection(sectionId)}
                  type="button"
                >
                  {section.title}
                </button>
              )
            })}
          </nav>
        ) : null}
        {displayedLessonSections.map((section) => (
          <Fragment key={section.title}>
            {section.title === "Let's Reflect" ? (
              <>
                <LessonMainActivityPanel
                  activity={mainActivity}
                  api={api}
                  data={data}
                  onSubmitted={refresh}
                />
                {mainActivity && challengeSection ? (
                  mainActivityReviewUnlocked ? (
                    <section
                      className="lesson-content-section"
                      id={lessonSectionId(challengeSection.title)}
                    >
                      <p className="eyebrow">Ready for Challenge</p>
                      <h2>{challengeSection.title}</h2>
                      <RichLessonText value={challengeSection.content} />
                    </section>
                  ) : (
                    <section className="lesson-content-section lesson-content-section--locked">
                      <p className="eyebrow">Challenge locked</p>
                      <h2>Challenge Task</h2>
                      <p>Review Answers unlocks after a full score or after all Main Activity attempts are used.</p>
                    </section>
                  )
                ) : null}
              </>
            ) : null}
            <section
              className="lesson-content-section"
              id={lessonSectionId(section.title)}
            >
              <h2>{section.title}</h2>
              {section.content.trim() ? <RichLessonText value={section.content} /> : null}
              {section.title === "Let's Look at Examples" ? (
                <LessonExampleCards examples={lessonExamples} />
              ) : null}
            </section>
          </Fragment>
        ))}
        {mainActivity && !displayedLessonSections.some((section) => section.title === "Let's Reflect") ? (
          <>
            <LessonMainActivityPanel
              activity={mainActivity}
              api={api}
              data={data}
              onSubmitted={refresh}
            />
            {challengeSection ? (
              mainActivityReviewUnlocked ? (
                <section
                  className="lesson-content-section"
                  id={lessonSectionId(challengeSection.title)}
                >
                  <p className="eyebrow">Ready for Challenge</p>
                  <h2>{challengeSection.title}</h2>
                  <RichLessonText value={challengeSection.content} />
                </section>
              ) : (
                <section className="lesson-content-section lesson-content-section--locked">
                  <p className="eyebrow">Challenge locked</p>
                  <h2>Challenge Task</h2>
                  <p>Review Answers unlocks after a full score or after all Main Activity attempts are used.</p>
                </section>
              )
            ) : null}
          </>
        ) : null}
        <LessonCodingAssessments data={data} lessonId={lesson.id} />
        {lesson.assessment_url ? (
          <a className="button button--secondary" href={lesson.assessment_url} rel="noreferrer" target="_blank">
            <Icon name="assessment" />
            <span>Open Assessment</span>
          </a>
        ) : null}
        <section className="student-lesson-completion">
          <div>
            <p className="eyebrow">Lesson progress</p>
            <h2>{completed ? 'Lesson completed' : 'Ready to finish?'}</h2>
            <p>
              {completed
                ? 'You can review this lesson anytime or continue to the next one.'
                : completionBlocked
                  ? 'Submit the Main Activity first, then come back here to finish the lesson.'
                  : mainActivityReviewUnlocked && challengeSection
                    ? 'Challenge is unlocked. Finish the challenge, then mark this lesson complete.'
                    : 'Mark this lesson complete when you have finished the examples and practice.'}
            </p>
          </div>
          <button
            className={completed ? 'button button--secondary' : 'button button--primary'}
            disabled={savingProgress || completionBlocked}
            onClick={() => void onToggleComplete()}
            type="button"
          >
            <Icon name="check" />
            <span>{completeButtonLabel}</span>
          </button>
          {completionBlocked ? (
            <div className="student-lesson-completion__hint">
              <Icon name="warning" />
              <span>Submit the Main Activity before marking this lesson complete.</span>
            </div>
          ) : null}
          {completed && nextLesson ? (
            <button
              className="button button--primary"
              onClick={() => onSelectLesson(nextLesson)}
              type="button"
            >
              <Icon name="arrow-right" />
              <span>Next Lesson</span>
            </button>
          ) : null}
        </section>
      </article>
      <nav className="student-lesson-bottom-paths" aria-label="Lesson paths">
        <button onClick={onOpenTopic} type="button">
          <Icon name="book" />
          <span>Back to Topic</span>
        </button>
        <button onClick={onOpenContents} type="button">
          <Icon name="module" />
          <span>Module Contents</span>
        </button>
      </nav>
      <TopicActivities data={data} topic={topic} />
      <nav className="floating-lesson-nav" aria-label="Module lesson navigation">
        <button
          aria-label={previousLesson ? `Previous lesson: ${previousLesson.title}` : 'No previous lesson'}
          disabled={!previousLesson}
          onClick={() => previousLesson && onSelectLesson(previousLesson)}
          type="button"
        >
          <Icon name="arrow-left" />
          <span><small>Previous</small><strong>{previousLesson?.title ?? 'First lesson'}</strong></span>
        </button>
        <span className="floating-lesson-nav__count">Lesson {lessonIndex + 1} of {publishedLessons.length}</span>
        <button
          aria-label={nextLesson ? `Next lesson: ${nextLesson.title}` : 'No next lesson'}
          disabled={!nextLesson}
          onClick={() => nextLesson && onSelectLesson(nextLesson)}
          type="button"
        >
          <span><small>Next</small><strong>{nextLesson?.title ?? 'Last lesson'}</strong></span>
          <Icon name="arrow-right" />
        </button>
      </nav>
    </div>
  )
}

function TopicActivities({
  data,
  topic,
}: {
  data: WorkspaceData
  topic: ModuleTopic
}) {
  const activities = data.activities.filter(
    (activity) => activity.topic === topic.id && activity.is_published,
  )

  if (!activities.length) {
    return null
  }

  return (
    <section className="student-topic-work section-block">
      <div className="student-topic-work__header">
        <div>
          <p className="eyebrow">Practice and checks</p>
          <h2>Topic Work</h2>
        </div>
        <span>{activities.length} available</span>
      </div>
      {activities.length ? (
        <div className="student-topic-work__group">
          <h3>Activities</h3>
          <div className="activity-list">
            {activities.map((activity) => (
              <ActivityCard activity={activity} data={data} key={activity.id} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ModuleMockAssessments({
  data,
  moduleId,
}: {
  data: WorkspaceData
  moduleId: number
}) {
  const assessments = data.assessments.filter(
    (assessment) =>
      assessment.module === moduleId &&
      assessment.is_published &&
      isMockAssessment(assessment),
  )

  if (!assessments.length) {
    return null
  }

  return (
    <section className="student-topic-work section-block">
      <div className="student-topic-work__header">
        <div>
          <p className="eyebrow">Module practice</p>
          <h2>Mock Exams</h2>
        </div>
        <span>{assessments.length} available</span>
      </div>
      <div className="card-list">
        {assessments.map((assessment) => (
          <Link
            className="resource-row"
            key={assessment.id}
            to={`/assessments/${assessment.id}`}
          >
            <span className="resource-row__icon">
              <Icon name="assessment" />
            </span>
            <div>
              <strong>{assessment.title}</strong>
              <span>Select topics and start a practice attempt.</span>
            </div>
            <Icon name="arrow-right" />
          </Link>
        ))}
      </div>
    </section>
  )
}

function scrollToStudentSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    block: 'start',
  })
}

function LessonCodingAssessments({ data, lessonId }: { data: WorkspaceData; lessonId: number }) {
  const problems = data.problems.filter(
    (problem) => problem.lesson === lessonId && problem.is_published,
  )
  if (!problems.length) return null

  return (
    <section>
      <h2>Coding Assessments</h2>
      <div className="card-list">
        {problems.map((problem) => (
          <Link className="resource-row" key={problem.id} to={`/coding/${problem.id}`}>
            <span className="resource-row__icon"><Icon name="code" /></span>
            <div>
              <strong>{problem.title}</strong>
              <span>{problem.difficulty} | {problem.blanks.length} blank{problem.blanks.length === 1 ? '' : 's'}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
