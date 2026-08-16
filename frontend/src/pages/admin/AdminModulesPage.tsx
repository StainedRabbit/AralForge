import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { LessonExampleCards } from '../../components/LessonExampleCards'
import { RichLessonText } from '../../components/RichLessonText'
import { EmptyState, Page, SearchBox, SkeletonList, StatusBanner } from '../../components/ui'
import { useActiveLessonSection } from '../../hooks/useActiveLessonSection'
import { usePaginatedResource } from '../../queries/useScopedWorkspace'
import type {
  Module,
  ModuleLesson,
  ModuleLessonExample,
  ModuleTopic,
} from '../../types'
import { formatDateTime, numeric, toErrorMessage } from '../../utils/format'
import { cleanImportedName } from '../../utils/importCleaning'
import {
  getLessonSections,
  lessonSearchText,
  lessonSectionId,
  lessonsForTopic,
  modulesForSubject,
  topicOwnSearchText,
} from '../../utils/modules'

export function AdminModulesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    Number(searchParams.get('subject')) || data.subjects[0]?.id || null,
  )
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(
    Number(searchParams.get('topic')) || null,
  )
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(
    Number(searchParams.get('lesson')) || null,
  )
  const [query, setQuery] = useState('')
  const [showOutlineImport, setShowOutlineImport] = useState(false)
  const [showModuleOutline, setShowModuleOutline] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState('')
  const shouldScrollToLesson = useRef(false)

  const selectedModule =
    modulesForSubject(data.modules, selectedSubjectId)[0] ?? null
  const topicsPath = selectedModule
    ? `/modules/topics/?module=${selectedModule.id}`
    : null
  const topicsQuery = usePaginatedResource<ModuleTopic>(api, topicsPath)
  const moduleTopics = useMemo(() => topicsQuery.data ?? [], [topicsQuery.data])
  const normalizedQuery = query.trim().toLowerCase()
  const selectedTopic = normalizedQuery
    ? moduleTopics.find((topic) => topic.id === selectedTopicId) ??
      moduleTopics.find((topic) => topicOwnSearchText(topic).toLowerCase().includes(normalizedQuery)) ??
      null
    : moduleTopics.find((topic) => topic.id === selectedTopicId) ??
      moduleTopics[0] ??
      null
  const lessonsPath = selectedTopic
    ? `/modules/lessons/?topic=${selectedTopic.id}`
    : null
  const lessonsQuery = usePaginatedResource<ModuleLesson>(api, lessonsPath)
  const selectedLessons = useMemo(() => lessonsQuery.data ?? [], [lessonsQuery.data])
  const visibleTopics = useMemo(
    () => moduleTopics.filter((topic) => {
      if (!normalizedQuery) {
        return true
      }
      if (topicOwnSearchText(topic).toLowerCase().includes(normalizedQuery)) {
        return true
      }
      return topic.id === selectedTopic?.id && selectedLessons.some((lesson) =>
        lessonSearchText(lesson).toLowerCase().includes(normalizedQuery),
      )
    }),
    [moduleTopics, normalizedQuery, selectedLessons, selectedTopic?.id],
  )
  const selectedTopicMatchesQuery = selectedTopic
    ? topicOwnSearchText(selectedTopic).toLowerCase().includes(normalizedQuery)
    : false
  const visibleLessons =
    normalizedQuery && !selectedTopicMatchesQuery
      ? selectedLessons.filter((lesson) =>
          lessonSearchText(lesson).toLowerCase().includes(normalizedQuery),
        )
      : selectedLessons
  const selectedLesson =
    visibleLessons.find((lesson) => lesson.id === selectedLessonId) ??
    visibleLessons[0] ??
    null
  const examplesPath = selectedLesson
    ? `/modules/lesson-examples/?lesson=${selectedLesson.id}`
    : null
  const examplesQuery = usePaginatedResource<ModuleLessonExample>(api, examplesPath)
  const loadFullModule = Boolean(
    selectedModule && (showModuleOutline || showOutlineImport),
  )
  const outlineLessonsPath = loadFullModule && selectedModule
    ? `/modules/lessons/?module=${selectedModule.id}`
    : null
  const outlineLessonsQuery = usePaginatedResource<ModuleLesson>(api, outlineLessonsPath)
  const scopedData = {
    ...data,
    lessonExamples: examplesQuery.data ?? [],
    moduleLessons: selectedLessons,
    moduleTopics,
  }

  async function refreshWorkspace() {
    await refresh()
    await Promise.all([
      topicsQuery.refetch(),
      lessonsPath ? lessonsQuery.refetch() : Promise.resolve(),
      examplesPath ? examplesQuery.refetch() : Promise.resolve(),
      outlineLessonsPath ? outlineLessonsQuery.refetch() : Promise.resolve(),
    ])
  }

  useEffect(() => {
    if (selectedSubjectId || !data.subjects.length) {
      return
    }

    queueMicrotask(() => setSelectedSubjectId(data.subjects[0].id))
  }, [data.subjects, selectedSubjectId])

  useEffect(() => {
    if (topicsQuery.isPending) {
      return
    }
    if (!selectedTopic && selectedTopicId !== null) {
      queueMicrotask(() => setSelectedTopicId(null))
      return
    }

    if (selectedTopic?.id && selectedTopic.id !== selectedTopicId) {
      queueMicrotask(() => setSelectedTopicId(selectedTopic.id))
    }
  }, [selectedTopic, selectedTopicId, topicsQuery.isPending])

  useEffect(() => {
    if (lessonsQuery.isPending) {
      return
    }
    if (!visibleLessons.length) {
      if (selectedLessonId !== null) {
        queueMicrotask(() => setSelectedLessonId(null))
      }
      return
    }

    if (selectedLesson?.id && selectedLesson.id !== selectedLessonId) {
      queueMicrotask(() => setSelectedLessonId(selectedLesson.id))
    }
  }, [lessonsQuery.isPending, selectedLesson, selectedLessonId, visibleLessons])

  useEffect(() => {
    const nextParams = new URLSearchParams()
    if (selectedSubjectId) {
      nextParams.set('subject', String(selectedSubjectId))
    }
    if (selectedTopicId) {
      nextParams.set('topic', String(selectedTopicId))
    }
    if (selectedLessonId) {
      nextParams.set('lesson', String(selectedLessonId))
    }
    setSearchParams(nextParams, { replace: true })
  }, [selectedLessonId, selectedSubjectId, selectedTopicId, setSearchParams])

  useEffect(() => {
    if (!shouldScrollToLesson.current || !selectedLesson?.id) {
      return
    }

    shouldScrollToLesson.current = false
    window.requestAnimationFrame(() => {
      document.getElementById('selected-lesson')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }, [selectedLesson?.id])

  function navigateLesson(lessonId: number) {
    shouldScrollToLesson.current = true
    setQuery('')
    setSelectedLessonId(lessonId)
  }

  async function moveTopic(topic: ModuleTopic, direction: -1 | 1) {
    const topicIndex = moduleTopics.findIndex((item) => item.id === topic.id)
    const targetTopic = moduleTopics[topicIndex + direction]
    if (topicIndex < 0 || !targetTopic) {
      return
    }

    setWorkspaceBusy(true)
    setWorkspaceMessage('')
    try {
      const currentOrder = topic.order || topicIndex + 1
      const targetOrder = targetTopic.order || topicIndex + direction + 1
      const nextCurrentOrder = currentOrder === targetOrder ? topicIndex + direction + 1 : targetOrder
      const nextTargetOrder = currentOrder === targetOrder ? topicIndex + 1 : currentOrder
      await Promise.all([
        api<ModuleTopic>(`/modules/topics/${topic.id}/`, {
          body: JSON.stringify({ order: nextCurrentOrder }),
          method: 'PATCH',
        }),
        api<ModuleTopic>(`/modules/topics/${targetTopic.id}/`, {
          body: JSON.stringify({ order: nextTargetOrder }),
          method: 'PATCH',
        }),
      ])
      await refreshWorkspace()
      setSelectedTopicId(topic.id)
      setWorkspaceMessage('Topic order updated.')
    } catch (caughtError) {
      setWorkspaceMessage(toErrorMessage(caughtError))
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function moveLesson(lesson: ModuleLesson, direction: -1 | 1) {
    const lessonSource = outlineLessonsQuery.data ?? selectedLessons
    const lessonGroup = lessonsForTopic(lessonSource, lesson.topic)
    const lessonIndex = lessonGroup.findIndex((item) => item.id === lesson.id)
    const targetLesson = lessonGroup[lessonIndex + direction]
    if (lessonIndex < 0 || !targetLesson) {
      return
    }

    setWorkspaceBusy(true)
    setWorkspaceMessage('')
    try {
      const currentOrder = lesson.order || lessonIndex + 1
      const targetOrder = targetLesson.order || lessonIndex + direction + 1
      const nextCurrentOrder = currentOrder === targetOrder ? lessonIndex + direction + 1 : targetOrder
      const nextTargetOrder = currentOrder === targetOrder ? lessonIndex + 1 : currentOrder
      await Promise.all([
        api<ModuleLesson>(`/modules/lessons/${lesson.id}/`, {
          body: JSON.stringify({ order: nextCurrentOrder }),
          method: 'PATCH',
        }),
        api<ModuleLesson>(`/modules/lessons/${targetLesson.id}/`, {
          body: JSON.stringify({ order: nextTargetOrder }),
          method: 'PATCH',
        }),
      ])
      await refreshWorkspace()
      navigateLesson(lesson.id)
      setWorkspaceMessage('Lesson order updated.')
    } catch (caughtError) {
      setWorkspaceMessage(toErrorMessage(caughtError))
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function bulkSetTopicPublished(topic: ModuleTopic, isPublished: boolean) {
    const topicLessons = lessonsForTopic(selectedLessons, topic.id)
    setWorkspaceBusy(true)
    setWorkspaceMessage('')
    try {
      await Promise.all([
        api<ModuleTopic>(`/modules/topics/${topic.id}/`, {
          body: JSON.stringify({ is_published: isPublished }),
          method: 'PATCH',
        }),
        ...topicLessons.map((lesson) =>
          api<ModuleLesson>(`/modules/lessons/${lesson.id}/`, {
            body: JSON.stringify({ is_published: isPublished }),
            method: 'PATCH',
          }),
        ),
      ])
      await refreshWorkspace()
      setWorkspaceMessage(isPublished ? 'Topic and lessons published.' : 'Topic and lessons unpublished.')
    } catch (caughtError) {
      setWorkspaceMessage(toErrorMessage(caughtError))
    } finally {
      setWorkspaceBusy(false)
    }
  }

  return (
    <Page>
      <section className="module-workspace module-workspace--dashboard">
        <ModuleWorkspaceTopBar
          data={data}
          moduleTopics={moduleTopics}
          onImportClick={() => setShowOutlineImport(true)}
          onOutlineClick={() => setShowModuleOutline(true)}
          onQueryChange={setQuery}
          onSelectedSubjectChange={(subjectId) => {
            setSelectedSubjectId(subjectId)
            setSelectedTopicId(null)
            setSelectedLessonId(null)
          }}
          onSelectedTopicChange={(topicId) => {
            setSelectedTopicId(topicId)
            setSelectedLessonId(null)
          }}
          query={query}
          returnTo={`${location.pathname}${location.search}`}
          selectedLesson={selectedLesson}
          selectedModule={selectedModule}
          selectedSubjectId={selectedSubjectId}
          selectedTopic={selectedTopic}
          topicsLoading={topicsQuery.isPending}
          visibleTopics={visibleTopics}
        />

        {showModuleOutline && selectedModule && outlineLessonsQuery.isPending ? (
          <ModuleDataStateModal
            onClose={() => setShowModuleOutline(false)}
            title="Loading Module Outline"
          />
        ) : null}

        {showModuleOutline && selectedModule && outlineLessonsQuery.error ? (
          <ModuleDataStateModal
            error={toErrorMessage(outlineLessonsQuery.error)}
            onClose={() => setShowModuleOutline(false)}
            title="Module Outline Could Not Load"
          />
        ) : null}

        {showModuleOutline && selectedModule && outlineLessonsQuery.data ? (
          <ModuleOutlineModal
            lessons={outlineLessonsQuery.data}
            moduleTopics={moduleTopics}
            onClose={() => setShowModuleOutline(false)}
            onMoveLesson={moveLesson}
            onMoveTopic={moveTopic}
            onSelectLesson={navigateLesson}
            onSelectTopic={(topicId) => {
              setQuery('')
              setSelectedTopicId(topicId)
              setSelectedLessonId(null)
            }}
            selectedLesson={selectedLesson}
            selectedTopic={selectedTopic}
            visibleTopics={visibleTopics}
            workspaceBusy={workspaceBusy}
          />
        ) : null}

        {showOutlineImport && selectedModule && outlineLessonsQuery.isPending ? (
          <ModuleDataStateModal
            onClose={() => setShowOutlineImport(false)}
            title="Loading Outline Import"
          />
        ) : null}

        {showOutlineImport && selectedModule && outlineLessonsQuery.error ? (
          <ModuleDataStateModal
            error={toErrorMessage(outlineLessonsQuery.error)}
            onClose={() => setShowOutlineImport(false)}
            title="Outline Import Could Not Load"
          />
        ) : null}

        {showOutlineImport && selectedModule && outlineLessonsQuery.data ? (
          <ModuleOutlineImportModal
            api={api}
            data={{ ...scopedData, moduleLessons: outlineLessonsQuery.data }}
            module={selectedModule}
            moduleTopics={moduleTopics}
            onApplied={(topicId) => {
              setQuery('')
              setSelectedTopicId(topicId)
              setSelectedLessonId(null)
            }}
            onClose={() => setShowOutlineImport(false)}
            refresh={refreshWorkspace}
          />
        ) : null}

        {selectedModule && topicsQuery.error ? (
          <StatusBanner
            message={toErrorMessage(topicsQuery.error)}
            title="Topics could not load"
            tone="warning"
          />
        ) : selectedModule && topicsQuery.isPending ? (
          <section aria-label="Loading topics"><SkeletonList count={4} /></section>
        ) : selectedModule && selectedTopic && lessonsQuery.error ? (
          <StatusBanner
            message={toErrorMessage(lessonsQuery.error)}
            title="Lessons could not load"
            tone="warning"
          />
        ) : selectedModule && selectedTopic && lessonsQuery.isPending ? (
          <section aria-label="Loading lessons"><SkeletonList count={4} /></section>
        ) : selectedModule && selectedLesson && examplesQuery.error ? (
          <StatusBanner
            message={toErrorMessage(examplesQuery.error)}
            title="Lesson examples could not load"
            tone="warning"
          />
        ) : selectedModule && selectedLesson && examplesQuery.isPending ? (
          <section aria-label="Loading lesson examples"><SkeletonList count={2} /></section>
        ) : selectedModule ? (
          <ModuleLessonWorkspace
            api={api}
            data={scopedData}
            lessons={visibleLessons}
            module={selectedModule}
            onBulkPublishTopic={bulkSetTopicPublished}
            onMoveLesson={moveLesson}
            navigateLesson={navigateLesson}
            onSelectLesson={navigateLesson}
            query={query}
            refresh={refreshWorkspace}
            selectedLesson={selectedLesson}
            topicLessons={selectedLessons}
            selectedTopic={selectedTopic}
            totalLessons={selectedLessons.length}
            visibleTopics={visibleTopics}
            workspaceBusy={workspaceBusy}
            workspaceMessage={workspaceMessage}
          />
        ) : (
          <div className="module-preview__empty">
            <EmptyState
              icon="book"
              title="Create the subject module"
              message="The selected subject does not have its one main learning module yet."
            />
          </div>
        )}
      </section>

    </Page>
  )
}

function ModuleWorkspaceTopBar({
  data,
  moduleTopics,
  onImportClick,
  onOutlineClick,
  onQueryChange,
  onSelectedSubjectChange,
  onSelectedTopicChange,
  query,
  returnTo,
  selectedLesson,
  selectedModule,
  selectedSubjectId,
  selectedTopic,
  topicsLoading,
  visibleTopics,
}: {
  data: RouteData
  moduleTopics: ModuleTopic[]
  onImportClick: () => void
  onOutlineClick: () => void
  onQueryChange: (value: string) => void
  onSelectedSubjectChange: (subjectId: number | null) => void
  onSelectedTopicChange: (topicId: number | null) => void
  query: string
  returnTo: string
  selectedLesson: ModuleLesson | null
  selectedModule: Module | null
  selectedSubjectId: number | null
  selectedTopic: ModuleTopic | null
  topicsLoading: boolean
  visibleTopics: ModuleTopic[]
}) {
  return (
    <header className="module-workspace-topbar">
      <div className="module-workspace-breadcrumb" aria-label="Workspace breadcrumb">
        <span>Modules</span>
        {selectedTopic ? <span>{selectedTopic.title}</span> : null}
        {selectedLesson ? <strong>Lesson {selectedLesson.order || '-'}</strong> : null}
      </div>
      <div className="module-workspace-search">
        <SearchBox onChange={onQueryChange} placeholder="Search topics or lessons" value={query} />
      </div>
      <div className="module-control-bar">
        <label className="admin-field">
          <span>Subject</span>
          <select
            onChange={(event) => onSelectedSubjectChange(Number(event.target.value) || null)}
            value={selectedSubjectId ?? ''}
          >
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code} - {subject.name}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Topic</span>
          <select
            disabled={topicsLoading || !moduleTopics.length}
            onChange={(event) => onSelectedTopicChange(Number(event.target.value) || null)}
            value={selectedTopic?.id ?? ''}
          >
            {topicsLoading ? <option value="">Loading topics...</option> : null}
            {!topicsLoading && !moduleTopics.length ? <option value="">No topics yet</option> : null}
            {moduleTopics.length && !visibleTopics.length ? (
              <option value="">No matching topics</option>
            ) : null}
            {visibleTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
        </label>

        <div className="module-control-bar__actions">
          {!selectedModule ? (
            <Link
              className="button button--primary"
              to={`/admin/modules/new${selectedSubjectId ? `?subject=${selectedSubjectId}` : ''}`}
            >
              <Icon name="plus" />
              <span>Create Subject Module</span>
            </Link>
          ) : null}
          {selectedModule ? (
            <ModuleManageMenu
              module={selectedModule}
              onImportClick={onImportClick}
              onOutlineClick={onOutlineClick}
              returnTo={returnTo}
              topic={selectedTopic}
            />
          ) : null}
          {selectedModule && selectedTopic ? (
            <Link
              className="button button--primary"
              to={`/admin/modules/${selectedModule.id}/topics/${selectedTopic.id}/lessons/new`}
            >
              <Icon name="plus" />
              <span>New Lesson</span>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function ModuleDataStateModal({
  error,
  onClose,
  title,
}: {
  error?: string
  onClose: () => void
  title: string
}) {
  return (
    <div className="lesson-focus-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="lesson-focus-modal__backdrop" />
      <div className="lesson-focus-modal__panel">
        <div className="lesson-focus-modal__header">
          <strong>{title}</strong>
          <button className="button button--secondary button--compact" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="lesson-import-modal__body">
          {error ? (
            <StatusBanner message={error} title="Data could not load" tone="warning" />
          ) : (
            <section aria-label={title}><SkeletonList count={4} /></section>
          )}
        </div>
      </div>
    </div>
  )
}

type ParsedOutlineLesson = {
  order: number
  title: string
}

type ParsedOutlineTopic = {
  competency_code: string
  lessons: ParsedOutlineLesson[]
  order: number
  overview: string
  title: string
  unit: string
}

type ParsedModuleOutline = {
  ignoredLines: string[]
  moduleTitle: string
  topics: ParsedOutlineTopic[]
}

type ModuleOutlineAnalysisTopic = {
  badges: string[]
  competency_code: string
  duplicateLessonCount: number
  lessons: {
    duplicateInImport: boolean
    exists: boolean
    title: string
  }[]
  order: number
  overview: string
  status: string
  title: string
  unit: string
}

type ModuleOutlineAnalysis = {
  duplicateLessonsSkipped: number
  existingTopics: number
  ignoredLines: string[]
  lessonsToCreate: number
  newTopics: number
  topics: ModuleOutlineAnalysisTopic[]
  warnings: string[]
}

function ModuleOutlineImportModal({
  api,
  data,
  module,
  moduleTopics,
  onApplied,
  onClose,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  module: Module
  moduleTopics: ModuleTopic[]
  onApplied: (topicId: number) => void
  onClose: () => void
  refresh: () => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const parsed = useMemo(() => parseModuleOutlineMarkdown(text), [text])
  const analysis = useMemo(
    () => analyzeModuleOutlineImport(parsed, moduleTopics, data.moduleLessons),
    [data.moduleLessons, moduleTopics, parsed],
  )

  async function uploadMarkdownFile(file: File | null) {
    if (!file) {
      return
    }

    setMessage('')
    try {
      setText(await file.text())
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    }
  }

  async function copyModuleOutlineExample() {
    const copied = await copyTextToClipboard(
      moduleTopicsAndLessonsExampleMarkdown(module.title),
    )
    setMessage(
      copied
        ? 'Topics + Lessons Markdown copied.'
        : 'Copy failed. You can still download the Topics + Lessons MD.',
    )
  }

  async function applyOutlineImport() {
    if (!parsed.topics.length) {
      setMessage('Add at least one topic heading before applying the outline.')
      return
    }

    setBusy(true)
    setMessage('')

    const topicByTitle = new Map(
      moduleTopics.map((topic) => [normalizeImportTitle(topic.title), topic]),
    )
    const lessonsByTopic = new Map<number, ModuleLesson[]>(
      moduleTopics.map((topic) => [
        topic.id,
        data.moduleLessons.filter((lesson) => lesson.topic === topic.id),
      ]),
    )
    const nextTopicOrder =
      moduleTopics.reduce((highest, topic) => Math.max(highest, topic.order), 0) + 1
    let createdTopics = 0
    let matchedTopics = 0
    let createdLessons = 0
    let skippedLessons = 0
    let firstAppliedTopicId: number | null = null

    try {
      for (const topic of parsed.topics) {
        const topicKey = normalizeImportTitle(topic.title)
        const existingTopic = topicByTitle.get(topicKey) ?? null
        let savedTopic = existingTopic

        if (!savedTopic) {
          savedTopic = await api<ModuleTopic>('/modules/topics/', {
            body: JSON.stringify({
              competency_code: topic.competency_code,
              module: module.id,
              order: topic.order || nextTopicOrder + createdTopics,
              overview: topic.overview,
              title: topic.title,
              unit: topic.unit,
              is_published: false,
            }),
            method: 'POST',
          })
          topicByTitle.set(topicKey, savedTopic)
          lessonsByTopic.set(savedTopic.id, [])
          createdTopics += 1
        } else {
          matchedTopics += 1
        }

        firstAppliedTopicId ??= savedTopic.id

        const topicLessons = lessonsByTopic.get(savedTopic.id) ?? []
        const lessonTitleSet = new Set(
          topicLessons.map((lesson) => normalizeImportTitle(lesson.title)),
        )
        const nextLessonOrder =
          topicLessons.reduce((highest, lesson) => Math.max(highest, lesson.order), 0) + 1
        let createdLessonsForTopic = 0

        for (const lesson of topic.lessons) {
          const lessonKey = normalizeImportTitle(lesson.title)
          if (lessonTitleSet.has(lessonKey)) {
            skippedLessons += 1
            continue
          }

          const savedLesson = await api<ModuleLesson>('/modules/lessons/', {
            body: JSON.stringify({
              topic: savedTopic.id,
              title: lesson.title,
              order: lesson.order || nextLessonOrder + createdLessonsForTopic,
              is_published: false,
            }),
            method: 'POST',
          })
          topicLessons.push(savedLesson)
          lessonTitleSet.add(lessonKey)
          createdLessons += 1
          createdLessonsForTopic += 1
        }
      }

      await refresh()
      if (firstAppliedTopicId) {
        onApplied(firstAppliedTopicId)
      }
      setMessage(
        [
          createdTopics ? `${createdTopics} topic${createdTopics === 1 ? '' : 's'} created.` : '',
          matchedTopics ? `${matchedTopics} existing topic${matchedTopics === 1 ? '' : 's'} matched.` : '',
          createdLessons ? `${createdLessons} lesson${createdLessons === 1 ? '' : 's'} created.` : '',
          skippedLessons ? `${skippedLessons} duplicate lesson${skippedLessons === 1 ? '' : 's'} skipped.` : '',
        ].filter(Boolean).join(' ') || 'No new topics or lessons were created.',
      )
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lesson-focus-modal" role="dialog" aria-modal="true" aria-labelledby="module-outline-import-title">
      <div className="lesson-focus-modal__backdrop" />
      <div className="lesson-focus-modal__panel lesson-import-modal">
        <div className="lesson-focus-modal__header">
          <div>
            <span>Structured import</span>
            <strong id="module-outline-import-title">Import Module Outline Markdown</strong>
          </div>
          <button className="button button--secondary button--compact" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="lesson-import-modal__body">
          <section className="lesson-import-modal__inputs">
            <div className="lesson-editor__actions">
              <button className="button button--secondary button--compact" onClick={() => downloadModuleTopicsOnlyExample(module.title)} type="button">
                <Icon name="file" />
                <span>Download Topics Only MD</span>
              </button>
              <button className="button button--secondary button--compact" onClick={() => downloadModuleTopicsAndLessonsExample(module.title)} type="button">
                <Icon name="file" />
                <span>Download Topics + Lessons MD</span>
              </button>
              <button className="button button--secondary button--compact" onClick={() => void copyModuleOutlineExample()} type="button">
                <Icon name="file" />
                <span>Copy Topics + Lessons</span>
              </button>
              <label className="button button--secondary button--compact import-file-button">
                <Icon name="upload" />
                <span>Upload MD</span>
                <input accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => void uploadMarkdownFile(event.target.files?.[0] ?? null)} type="file" />
              </label>
            </div>
            <label className="admin-field">
              <span>Module Outline Markdown</span>
              <textarea
                onChange={(event) => setText(event.target.value)}
                rows={18}
                value={text}
              />
              <small>Use topic headings with optional lesson bullets. Topics without lessons are valid; lesson bullets create blank lesson shells.</small>
            </label>
            {message ? <p className="admin-message">{message}</p> : null}
          </section>
          <section className="lesson-import-preview">
            <p className="eyebrow">Preview</p>
            <div className="lesson-import-preview__grid">
              <span>Module</span>
              <strong>{parsed.moduleTitle || module.title}</strong>
              <span>New topics</span>
              <strong>{analysis.newTopics}</strong>
              <span>Existing topics</span>
              <strong>{analysis.existingTopics}</strong>
              <span>Lessons to create</span>
              <strong>{analysis.lessonsToCreate}</strong>
              <span>Duplicate lessons skipped</span>
              <strong>{analysis.duplicateLessonsSkipped}</strong>
              <span>Warnings</span>
              <strong>{analysis.warnings.length}</strong>
            </div>
            {analysis.warnings.length ? (
              <div className="module-outline-warnings">
                <strong>Warnings</strong>
                {analysis.warnings.map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </div>
            ) : null}
            <div className="module-outline-preview">
              {analysis.topics.length ? analysis.topics.map((topic) => (
                <article key={`${topic.title}-${topic.order}`}>
                  <div>
                    <strong>{topic.title}</strong>
                    <span>{topic.status}</span>
                  </div>
                  <div className="module-outline-badges">
                    {topic.badges.map((badge) => (
                      <span key={`${topic.title}-${badge}`}>{badge}</span>
                    ))}
                  </div>
                  <small>
                    {[topic.competency_code, topic.unit, topic.overview ? 'Overview' : '']
                      .filter(Boolean)
                      .join(' | ') || 'Basic topic details only'}
                  </small>
                  <div className="lesson-import-preview__sections">
                    {topic.lessons.length ? topic.lessons.map((lesson) => (
                      <span className={lesson.exists || lesson.duplicateInImport ? '' : 'is-filled'} key={`${topic.title}-${lesson.title}`}>
                        {lesson.exists || lesson.duplicateInImport ? 'Skip: ' : 'Create: '}
                        {lesson.title}
                      </span>
                    )) : <span>Topic only</span>}
                  </div>
                </article>
              )) : <small>No topic headings found yet.</small>}
            </div>
            {analysis.ignoredLines.length ? (
              <details className="module-outline-ignored">
                <summary>Ignored lines</summary>
                {analysis.ignoredLines.map((line, index) => (
                  <small key={`${line}-${index}`}>{line}</small>
                ))}
              </details>
            ) : null}
          </section>
        </div>
        <div className="lesson-focus-modal__footer">
          <button className="button button--primary" disabled={busy || !parsed.topics.length} onClick={() => void applyOutlineImport()} type="button">
            <Icon name="upload" />
            <span>{busy ? 'Applying...' : 'Apply Outline'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ModuleLessonWorkspace({
  api,
  data,
  lessons,
  module,
  navigateLesson,
  onBulkPublishTopic,
  onMoveLesson,
  onSelectLesson,
  query,
  refresh,
  selectedLesson,
  topicLessons,
  selectedTopic,
  totalLessons,
  visibleTopics,
  workspaceBusy,
  workspaceMessage,
}: {
  api: AuthedRequest
  data: RouteData
  lessons: ModuleLesson[]
  module: Module
  navigateLesson: (lessonId: number) => void
  onBulkPublishTopic: (topic: ModuleTopic, isPublished: boolean) => Promise<void>
  onMoveLesson: (lesson: ModuleLesson, direction: -1 | 1) => Promise<void>
  onSelectLesson: (lessonId: number) => void
  query: string
  refresh: () => Promise<void>
  selectedLesson: ModuleLesson | null
  topicLessons: ModuleLesson[]
  selectedTopic: ModuleTopic | null
  totalLessons: number
  visibleTopics: ModuleTopic[]
  workspaceBusy: boolean
  workspaceMessage: string
}) {
  if (!selectedTopic) {
    return (
      <div className="module-preview__empty">
        <EmptyState
          icon="module"
          title={query && !visibleTopics.length ? 'No matching topics' : 'No topics yet'}
          message={query && !visibleTopics.length ? 'Try a different search or create a new topic.' : 'Create the first competency topic for this subject module.'}
        />
        <Link
          className="button button--primary"
          to={`/admin/modules/${module.id}/topics/new`}
        >
          <Icon name="plus" />
          <span>New Topic</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="module-preview">
        <TopicSummaryCard
          api={api}
          data={data}
          module={module}
          onBulkPublishTopic={onBulkPublishTopic}
          refresh={refresh}
          selectedTopic={selectedTopic}
          totalLessons={totalLessons}
          workspaceBusy={workspaceBusy}
          workspaceMessage={workspaceMessage}
        />

        {lessons.length ? (
          <LessonSwitcher
            lessons={lessons}
            onMoveLesson={onMoveLesson}
            onSelectLesson={onSelectLesson}
            selectedLesson={selectedLesson}
            workspaceBusy={workspaceBusy}
          />
        ) : null}

        {selectedLesson ? (
          <div className="lesson-material module-lesson-preview" id="selected-lesson">
            <LessonPreview
              api={api}
              lesson={selectedLesson}
              module={module}
              navigateLesson={navigateLesson}
              lessonExamples={data.lessonExamples.filter((example) => example.lesson === selectedLesson.id)}
              refresh={refresh}
              topic={selectedTopic}
              topicLessons={topicLessons}
            />
          </div>
        ) : (
          <div className="module-preview__empty">
            <EmptyState
              icon="book"
              title={query ? 'No matching lessons' : 'No lessons yet'}
              message={query ? 'Try a different search term or clear the search box.' : 'Add the first lesson for this topic.'}
            />
          </div>
        )}
    </div>
  )
}

function ModuleOutlineModal({
  lessons,
  moduleTopics,
  onClose,
  onMoveLesson,
  onMoveTopic,
  onSelectLesson,
  onSelectTopic,
  selectedLesson,
  selectedTopic,
  visibleTopics,
  workspaceBusy,
}: {
  lessons: ModuleLesson[]
  moduleTopics: ModuleTopic[]
  onClose: () => void
  onMoveLesson: (lesson: ModuleLesson, direction: -1 | 1) => Promise<void>
  onMoveTopic: (topic: ModuleTopic, direction: -1 | 1) => Promise<void>
  onSelectLesson: (lessonId: number) => void
  onSelectTopic: (topicId: number) => void
  selectedLesson: ModuleLesson | null
  selectedTopic: ModuleTopic | null
  visibleTopics: ModuleTopic[]
  workspaceBusy: boolean
}) {
  return (
    <div className="lesson-focus-modal" role="dialog" aria-modal="true" aria-labelledby="module-outline-title">
      <div className="lesson-focus-modal__backdrop" />
      <div className="lesson-focus-modal__panel module-outline-modal">
        <div className="lesson-focus-modal__header">
          <div>
            <span>Navigation</span>
            <strong id="module-outline-title">Module Outline</strong>
          </div>
          <button className="button button--secondary button--compact" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <ModuleOutlinePanel
          lessons={lessons}
          moduleTopics={moduleTopics}
          onMoveLesson={onMoveLesson}
          onMoveTopic={onMoveTopic}
          onSelectLesson={onSelectLesson}
          onSelectTopic={onSelectTopic}
          selectedLesson={selectedLesson}
          selectedTopic={selectedTopic}
          visibleTopics={visibleTopics}
          workspaceBusy={workspaceBusy}
        />
      </div>
    </div>
  )
}

function ModuleOutlinePanel({
  lessons,
  moduleTopics,
  onMoveLesson,
  onMoveTopic,
  onSelectLesson,
  onSelectTopic,
  selectedLesson,
  selectedTopic,
  visibleTopics,
  workspaceBusy,
}: {
  lessons: ModuleLesson[]
  moduleTopics: ModuleTopic[]
  onMoveLesson: (lesson: ModuleLesson, direction: -1 | 1) => Promise<void>
  onMoveTopic: (topic: ModuleTopic, direction: -1 | 1) => Promise<void>
  onSelectLesson: (lessonId: number) => void
  onSelectTopic: (topicId: number) => void
  selectedLesson: ModuleLesson | null
  selectedTopic: ModuleTopic | null
  visibleTopics: ModuleTopic[]
  workspaceBusy: boolean
}) {
  const topicOrderIds = moduleTopics.map((topic) => topic.id)

  return (
    <aside className="module-outline-panel" aria-label="Module outline">
      <div className="module-outline-panel__header">
        <strong>Module Outline</strong>
        <small>{visibleTopics.length} topic{visibleTopics.length === 1 ? '' : 's'}</small>
      </div>
      <div className="module-outline-panel__list">
        {visibleTopics.map((topic) => {
          const topicLessons = lessonsForTopic(lessons, topic.id)
          const topicIndex = topicOrderIds.indexOf(topic.id)
          return (
            <article className={selectedTopic?.id === topic.id ? 'active' : ''} key={topic.id}>
              <div className="module-outline-topic-row">
                <button
                  className="module-outline-topic-button"
                  onClick={() => onSelectTopic(topic.id)}
                  type="button"
                >
                  <span>{topic.order || topicIndex + 1}</span>
                  <strong>{topic.title}</strong>
                  <small>{topic.is_published ? 'Published' : 'Draft'} | {topicLessons.length} lesson{topicLessons.length === 1 ? '' : 's'}</small>
                </button>
                <div className="module-reorder-actions">
                  <button aria-label={`Move topic ${topic.title} up`} disabled={workspaceBusy || topicIndex <= 0} onClick={() => void onMoveTopic(topic, -1)} title="Move topic up" type="button">
                    <Icon name="arrow-up" />
                  </button>
                  <button aria-label={`Move topic ${topic.title} down`} disabled={workspaceBusy || topicIndex < 0 || topicIndex >= moduleTopics.length - 1} onClick={() => void onMoveTopic(topic, 1)} title="Move topic down" type="button">
                    <Icon name="arrow-down" />
                  </button>
                </div>
              </div>
              {topicLessons.length ? (
                <div className="module-outline-lessons">
                  {topicLessons.map((lesson, lessonIndex) => (
                    <div className={selectedLesson?.id === lesson.id ? 'active' : ''} key={lesson.id}>
                      <button className="module-outline-lesson-button" onClick={() => onSelectLesson(lesson.id)} type="button">
                        <span>{lesson.order || lessonIndex + 1}</span>
                        <strong>{lesson.title}</strong>
                        <small>{lesson.is_published ? 'Published' : 'Draft'}</small>
                      </button>
                      <div className="module-reorder-actions">
                        <button aria-label={`Move lesson ${lesson.title} up`} disabled={workspaceBusy || lessonIndex <= 0} onClick={() => void onMoveLesson(lesson, -1)} title="Move lesson up" type="button">
                          <Icon name="arrow-up" />
                        </button>
                        <button aria-label={`Move lesson ${lesson.title} down`} disabled={workspaceBusy || lessonIndex >= topicLessons.length - 1} onClick={() => void onMoveLesson(lesson, 1)} title="Move lesson down" type="button">
                          <Icon name="arrow-down" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </aside>
  )
}

function TopicSummaryCard({
  api,
  data,
  module,
  onBulkPublishTopic,
  refresh,
  selectedTopic,
  totalLessons,
  workspaceBusy,
  workspaceMessage,
}: {
  api: AuthedRequest
  data: RouteData
  module: Module
  onBulkPublishTopic: (topic: ModuleTopic, isPublished: boolean) => Promise<void>
  refresh: () => Promise<void>
  selectedTopic: ModuleTopic
  totalLessons: number
  workspaceBusy: boolean
  workspaceMessage: string
}) {
  const hasFramework = [
    selectedTopic.essential_question,
    selectedTopic.enduring_understanding,
    selectedTopic.performance_task,
    selectedTopic.success_criteria,
    selectedTopic.values_focus,
  ].some(Boolean)

  return (
    <div className="module-topic-summary">
      <div className="module-topic-summary__main">
        <p className="eyebrow">{selectedTopic.competency_code || (module.subject ? subjectCode(data, module.subject) : 'Subject module')}</p>
        <h2>{selectedTopic.title}</h2>
        <RichLessonText value={selectedTopic.competency_text || selectedTopic.overview || module.description || 'Curriculum-aligned learning module'} />
        <div className="module-topic-pills" aria-label="Topic metadata">
          <span>Topic: {selectedTopic.is_published ? 'Published' : 'Draft'}</span>
          <span>Module: {module.is_published ? 'Published' : 'Draft'}</span>
          <span>{module.is_paid ? `Paid ${numeric(module.price).toFixed(2)}` : 'Free'}</span>
          <span>{totalLessons} lesson{totalLessons === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="module-topic-summary__aside">
        <div className="module-topic-summary__actions">
          <button
            className="button button--secondary"
            disabled={workspaceBusy}
            onClick={() => void onBulkPublishTopic(selectedTopic, !selectedTopic.is_published)}
            type="button"
          >
            <Icon name={selectedTopic.is_published ? 'eye-off' : 'check'} />
            <span>{selectedTopic.is_published ? 'Unpublish Topic' : 'Publish Topic'}</span>
          </button>
          <Link
            className="button button--secondary"
            to={`/admin/modules/${module.id}/topics/${selectedTopic.id}/edit`}
          >
            <Icon name="edit" />
            <span>Edit Topic</span>
          </Link>
        </div>
        <PdfControls
          api={api}
          downloadPath={`/modules/modules/${module.id}/download-pdf/`}
          filename={`${module.slug || 'module'}.pdf`}
          item={module}
          label="Module PDF"
          regeneratePath={`/modules/modules/${module.id}/regenerate_pdf/`}
          refresh={refresh}
        />
        {workspaceMessage ? <p className="admin-message">{workspaceMessage}</p> : null}
      </div>
      {hasFramework ? (
        <details className="topic-framework">
          <summary>Topic teaching framework</summary>
          <div className="topic-framework__grid">
            {selectedTopic.essential_question ? (
              <TopicFrameworkItem label="Essential Question" value={selectedTopic.essential_question} />
            ) : null}
            {selectedTopic.enduring_understanding ? (
              <TopicFrameworkItem label="Enduring Understanding" value={selectedTopic.enduring_understanding} />
            ) : null}
            {selectedTopic.performance_task ? (
              <TopicFrameworkItem label="Performance Task" value={selectedTopic.performance_task} />
            ) : null}
            {selectedTopic.success_criteria ? (
              <TopicFrameworkItem label="Success Criteria" value={selectedTopic.success_criteria} />
            ) : null}
            {selectedTopic.values_focus ? (
              <TopicFrameworkItem label="Values Focus" value={selectedTopic.values_focus} />
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function LessonSwitcher({
  lessons,
  onMoveLesson,
  onSelectLesson,
  selectedLesson,
  workspaceBusy,
}: {
  lessons: ModuleLesson[]
  onMoveLesson: (lesson: ModuleLesson, direction: -1 | 1) => Promise<void>
  onSelectLesson: (lessonId: number) => void
  selectedLesson: ModuleLesson | null
  workspaceBusy: boolean
}) {
  const selectedIndex = selectedLesson
    ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id)
    : -1
  const previousLesson = selectedIndex > 0 ? lessons[selectedIndex - 1] : null
  const nextLesson =
    selectedIndex >= 0 && selectedIndex < lessons.length - 1
      ? lessons[selectedIndex + 1]
      : null

  return (
    <div className="module-lesson-switcher">
      <button
        aria-label={previousLesson ? `Previous lesson: ${previousLesson.title}` : 'No previous lesson'}
        className="module-lesson-switcher__arrow"
        disabled={!previousLesson}
        onClick={() => previousLesson && onSelectLesson(previousLesson.id)}
        type="button"
      >
        <Icon name="arrow-left" />
      </button>
      <div className="module-lesson-strip" aria-label="Topic lessons">
        {lessons.map((lesson, index) => (
          <div
            className={
              selectedLesson?.id === lesson.id
                ? 'module-lesson-chip active'
                : 'module-lesson-chip'
            }
            key={lesson.id}
          >
            <button onClick={() => onSelectLesson(lesson.id)} type="button">
              <span>Lesson {lesson.order || '-'}</span>
              <strong>{lesson.title}</strong>
              <small>
                <span aria-hidden="true" />
                {lesson.is_published ? 'Published' : 'Draft'}
              </small>
            </button>
            <div className="module-reorder-actions">
              <button aria-label={`Move lesson ${lesson.title} left`} disabled={workspaceBusy || index <= 0} onClick={() => void onMoveLesson(lesson, -1)} title="Move lesson left" type="button">
                <Icon name="arrow-left" />
              </button>
              <button aria-label={`Move lesson ${lesson.title} right`} disabled={workspaceBusy || index >= lessons.length - 1} onClick={() => void onMoveLesson(lesson, 1)} title="Move lesson right" type="button">
                <Icon name="arrow-right" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        aria-label={nextLesson ? `Next lesson: ${nextLesson.title}` : 'No next lesson'}
        className="module-lesson-switcher__arrow"
        disabled={!nextLesson}
        onClick={() => nextLesson && onSelectLesson(nextLesson.id)}
        type="button"
      >
        <Icon name="arrow-right" />
      </button>
    </div>
  )
}

function ModuleManageMenu({
  module,
  onImportClick,
  onOutlineClick,
  returnTo,
  topic,
}: {
  module: Module
  onImportClick: () => void
  onOutlineClick: () => void
  returnTo: string
  topic: ModuleTopic | null
}) {
  return (
    <details className="action-menu">
      <summary className="button button--secondary">
        <Icon name="menu" />
        <span>Manage</span>
      </summary>
      <div className="action-menu__content">
        <button onClick={onOutlineClick} type="button">
          <Icon name="module" />
          <span>Module Outline</span>
        </button>
        <button onClick={onImportClick} type="button">
          <Icon name="upload" />
          <span>Import Outline MD</span>
        </button>
        <Link to={`/admin/modules/${module.id}/topics/new`}>
          <Icon name="plus" />
          <span>New Topic</span>
        </Link>
        {topic ? (
          <Link to={`/admin/modules/${module.id}/topics/${topic.id}/edit`}>
            <Icon name="edit" />
            <span>Edit Topic</span>
          </Link>
        ) : null}
        <Link to={`/admin/modules/${module.id}/edit${module.subject ? `?subject=${module.subject}` : ''}`}>
          <Icon name="edit" />
          <span>Edit Module</span>
        </Link>
        <Link to={`/admin/modules/${module.id}/progress?returnTo=${encodeURIComponent(returnTo)}`}>
          <Icon name="users" />
          <span>Module Progress</span>
        </Link>
      </div>
    </details>
  )
}

function LessonPreview({
  api,
  lesson,
  module,
  navigateLesson,
  lessonExamples,
  refresh,
  topic,
  topicLessons,
}: {
  api: AuthedRequest
  lesson: ModuleLesson
  module: Module
  navigateLesson: (lessonId: number) => void
  lessonExamples: ModuleLessonExample[]
  refresh: () => Promise<void>
  topic: ModuleTopic
  topicLessons: ModuleLesson[]
}) {
  const [sectionContainer, setSectionContainer] = useState<HTMLElement | null>(null)
  const lessonSections = useMemo(
    () => getLessonSections(lesson, { hasStructuredExamples: lessonExamples.length > 0 }),
    [lesson, lessonExamples.length],
  )
  const sectionIds = useMemo(
    () => lessonSections.map((section) => lessonSectionId(section.title)),
    [lessonSections],
  )
  const activeSectionId = useActiveLessonSection(sectionContainer, sectionIds)
  const lessonIndex = topicLessons.findIndex((topicLesson) => topicLesson.id === lesson.id)
  const previousLesson = lessonIndex > 0 ? topicLessons[lessonIndex - 1] : null
  const nextLesson =
    lessonIndex >= 0 && lessonIndex < topicLessons.length - 1
      ? topicLessons[lessonIndex + 1]
      : null

  return (
    <section className="lesson-section" ref={setSectionContainer}>
      <div className="lesson-workspace-header">
        <div>
          <p className="eyebrow">Modules / {topic.title} / Lesson {lesson.order || lessonIndex + 1}</p>
          <h2>Lesson {lesson.order || lessonIndex + 1}: {lesson.title}</h2>
          {lesson.pdf_generated_at ? <small>Generated {formatDateTime(lesson.pdf_generated_at)}</small> : null}
          <div className="module-topic-pills" aria-label="Lesson metadata">
            <span>{lesson.is_published ? 'Published' : 'Draft'}</span>
            <span>{lessonSections.length} section{lessonSections.length === 1 ? '' : 's'}</span>
            <span>Lesson {lessonIndex + 1} of {topicLessons.length}</span>
          </div>
        </div>
        <div className="lesson-section__actions">
          <Link
            className="button button--primary"
            to={`/admin/modules/${module.id}/present?topic=${topic.id}${lessonIndex === 0 ? '' : `&lesson=${lesson.id}`}`}
          >
            <Icon name="spark" />
            <span>Present</span>
          </Link>
          <Link
            className="button button--secondary"
            to={`/admin/modules/${module.id}/topics/${topic.id}/lessons/${lesson.id}/edit`}
          >
            <Icon name="edit" />
            <span>Edit Lesson</span>
          </Link>
        </div>
      </div>
      <div className="lesson-workspace-utility">
        <PdfControls
          api={api}
          downloadPath={`/modules/lessons/${lesson.id}/download_pdf/`}
          filename={`${slugify(lesson.title) || 'lesson'}.pdf`}
          item={lesson}
          label="Lesson PDF"
          regeneratePath={`/modules/lessons/${lesson.id}/regenerate_pdf/`}
          refresh={refresh}
        />
      </div>
      {lessonSections.length ? (
        <LessonSectionNavigation
          activeSectionId={activeSectionId}
          lessonSections={lessonSections}
        />
      ) : null}
      <div className="lesson-workspace-grid">
        <div className="lesson-workspace-main">
          {lessonSections.map((section) => (
            <div
              className="lesson-content-section"
              id={lessonSectionId(section.title)}
              key={section.title}
            >
              <h3>{section.title}</h3>
              {section.content.trim() ? <RichLessonText value={section.content} /> : null}
              {section.title === "Let's Look at Examples" ? (
                <LessonExampleCards examples={lessonExamples} />
              ) : null}
            </div>
          ))}
        </div>
        {lessonSections.length ? (
          <LessonWorkspaceOutline
            activeSectionId={activeSectionId}
            lessonSections={lessonSections}
          />
        ) : null}
      </div>
      <nav className="floating-lesson-nav" aria-label="Lesson navigation">
        <button
          aria-label={previousLesson ? `Previous lesson: ${previousLesson.title}` : 'No previous lesson'}
          disabled={!previousLesson}
          onClick={() => previousLesson && navigateLesson(previousLesson.id)}
          type="button"
        >
          <Icon name="arrow-left" />
          <span>
            <small>Previous</small>
            <strong>{previousLesson?.title ?? 'First lesson'}</strong>
          </span>
        </button>
        <span className="floating-lesson-nav__count">
          Lesson {lessonIndex + 1} of {topicLessons.length}
        </span>
        <button
          aria-label={nextLesson ? `Next lesson: ${nextLesson.title}` : 'No next lesson'}
          disabled={!nextLesson}
          onClick={() => nextLesson && navigateLesson(nextLesson.id)}
          type="button"
        >
          <span>
            <small>Next</small>
            <strong>{nextLesson?.title ?? 'Last lesson'}</strong>
          </span>
          <Icon name="arrow-right" />
        </button>
      </nav>
    </section>
  )
}

function LessonSectionNavigation({
  activeSectionId,
  lessonSections,
}: {
  activeSectionId: string | null
  lessonSections: ReturnType<typeof getLessonSections>
}) {
  return (
    <nav className="lesson-section-nav" aria-label="Lesson sections">
      {lessonSections.map((section) => {
        const sectionId = lessonSectionId(section.title)
        return (
          <button
            aria-current={activeSectionId === sectionId ? 'location' : undefined}
            className={activeSectionId === sectionId ? 'active' : ''}
            key={section.title}
            onClick={() => scrollToLessonSection(sectionId)}
            type="button"
          >
            {section.title}
          </button>
        )
      })}
    </nav>
  )
}

function LessonWorkspaceOutline({
  activeSectionId,
  lessonSections,
}: {
  activeSectionId: string | null
  lessonSections: ReturnType<typeof getLessonSections>
}) {
  const sectionCount = lessonSections.length

  return (
    <aside className="lesson-workspace-outline" aria-label="Lesson outline">
      <div className="lesson-workspace-outline__progress">
        <strong>Lesson Sections</strong>
        <small>{sectionCount} filled section{sectionCount === 1 ? '' : 's'}</small>
      </div>
      <strong>On this lesson</strong>
      <div>
        {lessonSections.map((section, index) => {
          const sectionId = lessonSectionId(section.title)
          return (
            <button
              className={activeSectionId === sectionId ? 'active' : ''}
              key={section.title}
              onClick={() => scrollToLessonSection(sectionId)}
              type="button"
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {section.title}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function PdfControls({
  api,
  downloadPath,
  filename,
  item,
  label,
  regeneratePath,
  refresh,
}: {
  api: AuthedRequest
  downloadPath: string
  filename: string
  item: { has_pdf?: boolean; pdf_generated_at?: string | null; pdf_is_outdated?: boolean }
  label: string
  regeneratePath: string
  refresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function regeneratePdf() {
    setBusy(true)
    setMessage('')
    try {
      await api(regeneratePath, { method: 'POST' })
      await refresh()
      setMessage('Printable PDF generated.')
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setBusy(false)
    }
  }

  async function downloadPdf() {
    setBusy(true)
    setMessage('')
    try {
      const blob = await api<Blob>(downloadPath)
      downloadBlob(blob, filename)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pdf-status-card pdf-status-card--inline">
      <div>
        <strong>{label}</strong>
        <span className={`pdf-status-card__pill pdf-status-card__pill--${pdfStatusKind(item)}`}>
          {pdfStatusLabel(item)}
        </span>
        {item.pdf_generated_at ? <small>Generated {formatDateTime(item.pdf_generated_at)}</small> : null}
      </div>
      <div className="pdf-status-card__actions">
        <button className="button button--secondary button--compact" disabled={busy} onClick={() => void regeneratePdf()} type="button">
          <Icon name="save" />
          <span>{item.has_pdf ? 'Regenerate PDF' : 'Generate PDF'}</span>
        </button>
        {item.has_pdf ? (
          <button className="button button--secondary button--compact" disabled={busy} onClick={() => void downloadPdf()} type="button">
            <Icon name="file" />
            <span>Download PDF</span>
          </button>
        ) : null}
      </div>
      {message ? <small>{message}</small> : null}
    </div>
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

function pdfStatusLabel(item: { has_pdf?: boolean; pdf_generated_at?: string | null; pdf_is_outdated?: boolean }) {
  if (!item.has_pdf && !item.pdf_generated_at) {
    return 'Not generated'
  }
  return item.pdf_is_outdated ? 'Outdated' : 'Updated'
}

function pdfStatusKind(item: { has_pdf?: boolean; pdf_generated_at?: string | null; pdf_is_outdated?: boolean }) {
  if (!item.has_pdf && !item.pdf_generated_at) {
    return 'missing'
  }
  return item.pdf_is_outdated ? 'outdated' : 'updated'
}

function parseModuleOutlineMarkdown(value: string): ParsedModuleOutline {
  const ignoredLines: string[] = []
  const topics: ParsedOutlineTopic[] = []
  let moduleTitle = ''
  let currentTopic: ParsedOutlineTopic | null = null

  value.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      return
    }

    const moduleMatch = line.match(/^#\s+(.+)$/)
    if (moduleMatch && !moduleTitle) {
      moduleTitle = cleanImportedName(moduleMatch[1])
      return
    }
    if (line.match(/^#\s+(.+)$/)) {
      ignoredLines.push(line)
      return
    }

    const topicMatch = line.match(/^##+\s+(?:(?:Topic|Unit)\s+(\d+)[:.)-]?\s*)?(.+)$/i)
    if (topicMatch) {
      const parsedOrder = Number(topicMatch[1] || topics.length + 1)
      currentTopic = {
        competency_code: '',
        lessons: [],
        order: Number.isFinite(parsedOrder) ? parsedOrder : topics.length + 1,
        overview: '',
        title: cleanImportedName(stripLeadingNumber(topicMatch[2])),
        unit: '',
      }
      topics.push(currentTopic)
      return
    }

    if (!currentTopic) {
      ignoredLines.push(line)
      return
    }

    const metadataMatch = line.match(/^(Competency Code|Code|Unit|Overview)\s*:\s*(.+)$/i)
    if (metadataMatch) {
      const key = metadataMatch[1].toLowerCase()
      const metadataValue = metadataMatch[2].trim()
      if (key === 'competency code' || key === 'code') {
        currentTopic.competency_code = metadataValue
      } else if (key === 'unit') {
        currentTopic.unit = cleanImportedName(metadataValue)
      } else if (key === 'overview') {
        currentTopic.overview = metadataValue
      }
      return
    }

    const lessonMatch = line.match(/^[-*]\s+(?:(?:Lesson)\s+(\d+)[:.)-]?\s*)?(.+)$/i)
    if (lessonMatch) {
      const parsedOrder = Number(lessonMatch[1] || currentTopic.lessons.length + 1)
      currentTopic.lessons.push({
        order: Number.isFinite(parsedOrder) ? parsedOrder : currentTopic.lessons.length + 1,
        title: cleanImportedName(stripLeadingNumber(lessonMatch[2])),
      })
      return
    }

    ignoredLines.push(line)
  })

  return {
    ignoredLines,
    moduleTitle,
    topics: topics.filter((topic) => topic.title),
  }
}

function analyzeModuleOutlineImport(
  parsed: ParsedModuleOutline,
  moduleTopics: ModuleTopic[],
  moduleLessons: ModuleLesson[],
): ModuleOutlineAnalysis {
  const topicByTitle = new Map(
    moduleTopics.map((topic) => [normalizeImportTitle(topic.title), topic]),
  )
  const importedTopicCounts = new Map<string, number>()
  parsed.topics.forEach((topic) => {
    const key = normalizeImportTitle(topic.title)
    importedTopicCounts.set(key, (importedTopicCounts.get(key) ?? 0) + 1)
  })

  let duplicateLessonsSkipped = 0
  let existingTopics = 0
  let lessonsToCreate = 0
  let newTopics = 0
  const warnings: string[] = []

  const topics = parsed.topics.map((topic) => {
    const topicKey = normalizeImportTitle(topic.title)
    const existingTopic = topicByTitle.get(normalizeImportTitle(topic.title))
    const existingLessons = existingTopic
      ? moduleLessons.filter((lesson) => lesson.topic === existingTopic.id)
      : []
    const existingLessonTitles = new Set(
      existingLessons.map((lesson) => normalizeImportTitle(lesson.title)),
    )
    const importedLessonCounts = new Map<string, number>()
    topic.lessons.forEach((lesson) => {
      const key = normalizeImportTitle(lesson.title)
      importedLessonCounts.set(key, (importedLessonCounts.get(key) ?? 0) + 1)
    })
    const topicDuplicateLessonCount = Array.from(importedLessonCounts.values())
      .reduce((count, itemCount) => count + Math.max(itemCount - 1, 0), 0)
    const badges = [existingTopic ? 'Existing' : 'New']

    if (existingTopic) {
      existingTopics += 1
    } else {
      newTopics += 1
    }
    if (!topic.lessons.length) {
      badges.push('Topic only')
    }
    if ((importedTopicCounts.get(topicKey) ?? 0) > 1) {
      badges.push('Duplicate topic')
      warnings.push(`${topic.title} appears more than once in this import.`)
    }
    if (topicDuplicateLessonCount) {
      badges.push('Duplicate lesson')
      warnings.push(`${topic.title} has ${topicDuplicateLessonCount} duplicate lesson title${topicDuplicateLessonCount === 1 ? '' : 's'} in this import.`)
    }
    const seenImportLessonTitles = new Set<string>()

    return {
      badges,
      competency_code: topic.competency_code,
      duplicateLessonCount: topicDuplicateLessonCount,
      lessons: topic.lessons.map((lesson) => {
        const lessonKey = normalizeImportTitle(lesson.title)
        const exists = existingLessonTitles.has(lessonKey)
        const duplicateInImport = seenImportLessonTitles.has(lessonKey)
        seenImportLessonTitles.add(lessonKey)
        if (exists || duplicateInImport) {
          duplicateLessonsSkipped += 1
        } else {
          lessonsToCreate += 1
        }
        return {
          duplicateInImport,
          exists,
          title: lesson.title,
        }
      }),
      order: topic.order,
      overview: topic.overview,
      status: topic.lessons.length
        ? existingTopic ? 'Existing topic: new lessons only' : 'New topic'
        : existingTopic ? 'Existing topic: no changes' : 'New topic',
      title: topic.title,
      unit: topic.unit,
    }
  })

  return {
    duplicateLessonsSkipped,
    existingTopics,
    ignoredLines: parsed.ignoredLines,
    lessonsToCreate,
    newTopics,
    topics,
    warnings: [
      ...warnings,
      ...parsed.ignoredLines.map((line) => `Ignored line: ${line}`),
    ],
  }
}

function downloadModuleTopicsOnlyExample(moduleTitle: string) {
  downloadBlob(
    new Blob([moduleTopicsOnlyExampleMarkdown(moduleTitle)], { type: 'text/markdown' }),
    'module-topics-only-template.md',
  )
}

function downloadModuleTopicsAndLessonsExample(moduleTitle: string) {
  downloadBlob(
    new Blob([moduleTopicsAndLessonsExampleMarkdown(moduleTitle)], { type: 'text/markdown' }),
    'module-topics-and-lessons-template.md',
  )
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function moduleTopicsOnlyExampleMarkdown(moduleTitle: string) {
  return `# ${moduleTitle || 'Introduction to Programming'}

## Topic 1: Input, Process, Output
Competency Code: CS11-IPO-001
Unit: Programming Basics
Overview: Students describe how programs receive input, process data, and produce output.

## Topic 2: Control Structures
Competency Code: CS11-CTRL-001
Unit: Program Flow
Overview: Students use decisions and repetition to control program behavior.
`
}

function moduleTopicsAndLessonsExampleMarkdown(moduleTitle: string) {
  return `# ${moduleTitle || 'Introduction to Programming'}

## Topic 1: Input, Process, Output
Competency Code: CS11-IPO-001
Unit: Programming Basics
Overview: Students describe how programs receive input, process data, and produce output.

- Lesson 1: IPO Model
- Lesson 2: Variables and Values

## Topic 2: Control Structures
Competency Code: CS11-CTRL-001
Unit: Program Flow
Overview: Students use decisions and repetition to control program behavior.

- Lesson 1: If Statements
- Lesson 2: Loops
`
}

function normalizeImportTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function stripLeadingNumber(value: string) {
  return value.replace(/^\d+[:.)-]?\s*/, '').trim()
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function TopicFrameworkItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{label}</strong>
      <RichLessonText value={value} />
    </div>
  )
}

function scrollToLessonSection(sectionId: string) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(sectionId)?.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}

function subjectCode(data: RouteData, subjectId: number) {
  return data.subjects.find((subject) => subject.id === subjectId)?.code ?? 'Subject'
}
