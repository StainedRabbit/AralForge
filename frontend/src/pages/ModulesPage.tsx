import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../app/types'
import { Icon } from '../components/Icon'
import { RichLessonText } from '../components/RichLessonText'
import { EmptyState, Page, PageHeader, SearchBox, SkeletonCard } from '../components/ui'
import type { ModuleLesson, ModuleTopic } from '../types'
import {
  lessonSearchText,
  lessonsForTopic,
  modulesForSubject,
  topicsForModule,
  topicOwnSearchText,
} from '../utils/modules'
import {
  getStudentModuleSubjectIds,
  moduleAccessLabel,
} from '../utils/student'
import { toErrorMessage } from '../utils/format'

type ModuleSearchResult =
  | { kind: 'topic'; topic: ModuleTopic }
  | { kind: 'lesson'; lesson: ModuleLesson; topic: ModuleTopic }

export function ModulesPage({
  api,
  data,
}: {
  api: AuthedRequest
  data: WorkspaceData
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const activeSubjectIds = useMemo(() => getStudentModuleSubjectIds(data), [data])
  const visibleSubjects = useMemo(
    () => data.subjects.filter((subject) => activeSubjectIds.has(subject.id)),
    [activeSubjectIds, data.subjects],
  )
  const [subjectId, setSubjectId] = useState<number | null>(
    visibleSubjects[0]?.id ?? null,
  )
  const [topicId, setTopicId] = useState<number | null>(null)

  useEffect(() => {
    if (subjectId && visibleSubjects.some((subject) => subject.id === subjectId)) {
      return
    }
    queueMicrotask(() => setSubjectId(visibleSubjects[0]?.id ?? null))
  }, [subjectId, visibleSubjects])

  const selectedModule = useMemo(
    () =>
      modulesForSubject(data.modules, subjectId).find(
        (module) => module.is_published,
      ) ?? null,
    [data, subjectId],
  )
  const publishedTopics = useMemo(
    () =>
      selectedModule?.is_accessible
        ? topicsForModule(data.moduleTopics, selectedModule.id).filter(
            (topic) => topic.is_published,
          )
        : [],
    [data.moduleTopics, selectedModule],
  )

  useEffect(() => {
    if (!publishedTopics.length) {
      if (topicId !== null) {
        queueMicrotask(() => setTopicId(null))
      }
      return
    }
    if (!topicId || !publishedTopics.some((topic) => topic.id === topicId)) {
      queueMicrotask(() => setTopicId(publishedTopics[0].id))
    }
  }, [publishedTopics, topicId])

  const normalizedQuery = query.trim().toLowerCase()
  const searchResults = useMemo<ModuleSearchResult[]>(() => {
    if (!selectedModule) {
      return []
    }

    if (!normalizedQuery) {
      return publishedTopics.map((topic) => ({ kind: 'topic', topic }))
    }

    return publishedTopics.flatMap((topic) => {
      const lessons = lessonsForTopic(data.moduleLessons, topic.id).filter(
        (lesson) => lesson.is_published,
      )
      const results: ModuleSearchResult[] = []
      if (topicOwnSearchText(topic).toLowerCase().includes(normalizedQuery)) {
        results.push({ kind: 'topic', topic })
      }
      lessons.forEach((lesson) => {
        if (lessonSearchText(lesson).toLowerCase().includes(normalizedQuery)) {
          results.push({ kind: 'lesson', lesson, topic })
        }
      })
      return results
    })
  }, [
    data.moduleLessons,
    normalizedQuery,
    publishedTopics,
    selectedModule,
  ])

  const selectedSubject = data.subjects.find((subject) => subject.id === subjectId)

  function openSelectedTopic() {
    if (selectedModule?.is_accessible && topicId) {
      navigate(`/modules/${selectedModule.id}?topic=${topicId}`)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Learning library"
        title="Modules"
        description="Choose a subject, find a topic or lesson, and continue learning."
      />

      {data.loading ? (
        <div className="module-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <section className="student-module-browser section-block">
          <div className="student-module-controls">
            <label className="student-module-control">
              <span>Subject</span>
              <select
                onChange={(event) => {
                  setSubjectId(Number(event.target.value) || null)
                  setTopicId(null)
                  setQuery('')
                }}
                value={subjectId ?? ''}
              >
                {!visibleSubjects.length ? (
                  <option value="">No active subjects</option>
                ) : null}
                {visibleSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code} - {subject.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="student-module-control">
              <span>Topic</span>
              <select
                disabled={!publishedTopics.length}
                onChange={(event) => setTopicId(Number(event.target.value) || null)}
                value={topicId ?? ''}
              >
                {!publishedTopics.length ? <option value="">No topics</option> : null}
                {publishedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </label>

            <SearchBox
              onChange={setQuery}
              placeholder="Search topics or lessons"
              value={query}
            />

            <button
              className="button button--primary"
              disabled={!selectedModule || !topicId}
              onClick={openSelectedTopic}
              type="button"
            >
              <Icon name="arrow-right" />
              <span>Open Topic</span>
            </button>
          </div>

          <div className="student-module-browser__summary">
            <div>
              <p className="eyebrow">{selectedSubject?.code ?? 'Subject'}</p>
              <h2>{selectedModule?.title ?? selectedSubject?.name ?? 'Learning module'}</h2>
              <RichLessonText
                value={
                  selectedModule?.description ||
                  'Published learning content will appear here when it is available.'
                }
              />
            </div>
            {selectedModule ? (
              <div className="student-module-browser__meta">
                <span>{moduleAccessLabel(data, selectedModule)}</span>
                <span>{publishedTopics.length} topic{publishedTopics.length === 1 ? '' : 's'}</span>
                <Link to={`/modules/${selectedModule.id}`}>Module Contents</Link>
              </div>
            ) : null}
          </div>

          {selectedModule && !selectedModule.is_accessible ? (
            <LockedModuleSummary
              api={api}
              module={selectedModule}
            />
          ) : searchResults.length ? (
            <div className="student-learning-results">
              {searchResults.map((result) => {
                const topic = result.topic
                const lesson = result.kind === 'lesson' ? result.lesson : null
                const target = lesson
                  ? `/modules/${selectedModule?.id}?topic=${topic.id}&lesson=${lesson.id}`
                  : `/modules/${selectedModule?.id}?topic=${topic.id}`
                return (
                  <Link
                    className="student-learning-result"
                    key={`${result.kind}-${lesson?.id ?? topic.id}`}
                    to={target}
                  >
                    <span className="student-learning-result__icon">
                      <Icon name={lesson ? 'book' : 'module'} />
                    </span>
                    <div>
                      <small>{lesson ? topic.title : topic.unit || 'Competency topic'}</small>
                      <strong>{lesson?.title ?? topic.title}</strong>
                      <span>
                        {lesson
                          ? 'Open lesson'
                          : topic.overview || topic.competency_text}
                      </span>
                    </div>
                    <Icon name="arrow-right" />
                  </Link>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={selectedModule ? 'search' : 'module'}
              title={selectedModule ? 'No matching learning content' : 'No module available'}
              message={
                selectedModule
                  ? 'Try another search or choose a different subject.'
                  : 'No published module is available for this subject yet.'
              }
            />
          )}
        </section>
      )}
    </Page>
  )
}

function LockedModuleSummary({
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
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${module.slug || 'module'}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError) || 'Printable PDF is not available yet.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="locked-module-summary">
      <span className="locked-module-summary__icon">
        <Icon name="shield" />
      </span>
      <div>
        <p className="eyebrow">Module access</p>
        <h3>PDF available</h3>
        <p>
          Download the module PDF for offline study. Pay {Number(module.price).toFixed(2)}
          {' '}in cash to unlock web lessons, activities, coding exercises, mock exams,
          and progress tracking.
        </p>
      </div>
      <div className="locked-module-summary__actions">
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
      </div>
    </div>
  )
}
