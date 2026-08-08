import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { LessonExampleCards } from '../../components/LessonExampleCards'
import { RichLessonText } from '../../components/RichLessonText'
import { EmptyState } from '../../components/ui'
import type { ModuleLesson, ModuleTopic, ProgrammingProblem } from '../../types'
import {
  lessonSectionId,
  lessonsForTopic,
  topicsForModule,
} from '../../utils/modules'

type PresentationSection = {
  content: string
  lessonId?: number
  id: string
  kind: 'coding' | 'lesson'
  title: string
}

type PresentationTextSize = 'default' | 'large' | 'small'

const TEXT_SIZE_KEY = 'ezoryx:presentation-text-size'

export function LessonPresentationPage({ data }: { data: WorkspaceData }) {
  const { moduleId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const module = data.modules.find((item) => item.id === Number(moduleId))
  const topics = module ? topicsForModule(data.moduleTopics, module.id) : []
  const requestedTopicId = Number(searchParams.get('topic')) || null
  const selectedTopic =
    topics.find((topic) => topic.id === requestedTopicId) ?? topics[0] ?? null
  const topicLessons = selectedTopic
    ? lessonsForTopic(data.moduleLessons, selectedTopic.id)
        .filter((lesson) => lesson.is_published)
    : []
  const requestedLessonId = Number(searchParams.get('lesson')) || null
  const selectedLesson = requestedLessonId
    ? topicLessons.find((lesson) => lesson.id === requestedLessonId) ?? null
    : null
  const linkedProblems = selectedLesson
    ? data.problems.filter(
        (problem) => problem.lesson === selectedLesson.id && problem.is_published,
      )
    : []
  const sections = selectedLesson
    ? buildPresentationSections(selectedLesson, linkedProblems, data.lessonExamples.filter((example) => example.lesson === selectedLesson.id))
    : selectedTopic
      ? buildTopicIntroductionSections(selectedTopic)
      : []
  const requestedSectionId = searchParams.get('section')
  const sectionIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === requestedSectionId),
  )
  const currentSection = sections[sectionIndex] ?? sections[0]
  const lessonIndex = selectedLesson
    ? topicLessons.findIndex((lesson) => lesson.id === selectedLesson.id)
    : -1
  const [sectionDrawerOpen, setSectionDrawerOpen] = useState(false)
  const [lessonMenuOpen, setLessonMenuOpen] = useState(false)
  const [blankScreen, setBlankScreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [textSize, setTextSize] = useState<PresentationTextSize>(() =>
    readTextSize(),
  )
  const controlsPinned = sectionDrawerOpen || lessonMenuOpen || blankScreen
  const backUrl =
    module && selectedTopic
      ? `/admin/modules?subject=${module.subject ?? ''}&topic=${selectedTopic.id}${selectedLesson ? `&lesson=${selectedLesson.id}` : ''}`
      : '/admin/modules'

  function revealControls() {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
    }
    setControlsVisible(true)
    if (!controlsPinned) {
      hideTimerRef.current = window.setTimeout(() => {
        const focusedElement = document.activeElement
        if (!focusedElement?.closest('.presentation-chrome')) {
          setControlsVisible(false)
        }
      }, 3000)
    }
  }

  function selectSection(nextIndex: number) {
    const section = sections[nextIndex]
    if (!section || !selectedTopic) {
      return
    }

    const nextParams: Record<string, string> = {
      section: section.id,
      topic: String(selectedTopic.id),
    }
    if (selectedLesson) {
      nextParams.lesson = String(selectedLesson.id)
    }
    setSearchParams(
      nextParams,
      { replace: true },
    )
    setSectionDrawerOpen(false)
    revealControls()
  }

  function selectLesson(lesson: ModuleLesson) {
    if (!selectedTopic) {
      return
    }

    setSearchParams(
      {
        lesson: String(lesson.id),
        topic: String(selectedTopic.id),
      },
      { replace: true },
    )
    setLessonMenuOpen(false)
    revealControls()
  }

  function selectTopicIntroduction() {
    if (!selectedTopic) {
      return
    }
    setSearchParams({ topic: String(selectedTopic.id) }, { replace: true })
    setLessonMenuOpen(false)
    revealControls()
  }

  function movePresentation(direction: -1 | 1) {
    updatePresentationStep({
      direction,
      sectionIndex,
      sections,
      problems: data.problems,
      lessonExamples: data.lessonExamples,
      selectedLesson,
      selectedTopic,
      setSearchParams,
      topicLessons,
    })
    revealControls()
  }

  function changeTextSize(nextSize: PresentationTextSize) {
    setTextSize(nextSize)
    try {
      window.localStorage.setItem(TEXT_SIZE_KEY, nextSize)
    } catch {
      // Presentation preferences can remain session-only when storage is unavailable.
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (shellRef.current?.requestFullscreen) {
        await shellRef.current.requestFullscreen()
      }
    } catch {
      revealControls()
    }
  }

  useEffect(() => {
    if (!currentSection || !selectedTopic) {
      return
    }

    const hasCanonicalParams =
      requestedTopicId === selectedTopic.id &&
      requestedLessonId === (selectedLesson?.id ?? null) &&
      requestedSectionId === currentSection.id

    if (!hasCanonicalParams) {
      queueMicrotask(() => {
        const nextParams: Record<string, string> = {
          section: currentSection.id,
          topic: String(selectedTopic.id),
        }
        if (selectedLesson) {
          nextParams.lesson = String(selectedLesson.id)
        }
        setSearchParams(
          nextParams,
          { replace: true },
        )
      })
    }
  }, [
    currentSection,
    requestedLessonId,
    requestedSectionId,
    requestedTopicId,
    selectedLesson,
    selectedTopic,
    setSearchParams,
  ])

  useEffect(() => {
    stageRef.current?.scrollTo({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      top: 0,
    })
  }, [currentSection?.id, selectedLesson?.id])

  useEffect(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
    }

    if (!controlsVisible || controlsPinned) {
      return
    }

    hideTimerRef.current = window.setTimeout(() => {
      const focusedElement = document.activeElement
      const focusInsideChrome = Boolean(
        focusedElement?.closest('.presentation-chrome'),
      )
      if (!focusInsideChrome) {
        setControlsVisible(false)
      }
    }, 3000)

    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [controlsPinned, controlsVisible])

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    const keyboardTopicLessons = selectedTopic
      ? lessonsForTopic(data.moduleLessons, selectedTopic.id).filter(
          (lesson) => lesson.is_published,
        )
      : []
    const keyboardSections = selectedLesson
      ? buildPresentationSections(
          selectedLesson,
          data.problems.filter(
            (problem) => problem.lesson === selectedLesson.id && problem.is_published,
          ),
          data.lessonExamples.filter((example) => example.lesson === selectedLesson.id),
        )
      : selectedTopic
        ? buildTopicIntroductionSections(selectedTopic)
        : []

    function handleKeyDown(event: KeyboardEvent) {
      if (
        blankScreen &&
        (event.key === 'Escape' || event.key.toLowerCase() === 'b')
      ) {
        event.preventDefault()
        setBlankScreen(false)
        return
      }
      if (sectionDrawerOpen && event.key === 'Escape') {
        event.preventDefault()
        setSectionDrawerOpen(false)
        return
      }
      if (lessonMenuOpen && event.key === 'Escape') {
        event.preventDefault()
        setLessonMenuOpen(false)
        return
      }

      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current)
      }
      setControlsVisible(true)
      if (!controlsPinned) {
        hideTimerRef.current = window.setTimeout(() => {
          const focusedElement = document.activeElement
          if (!focusedElement?.closest('.presentation-chrome')) {
            setControlsVisible(false)
          }
        }, 3000)
      }

      if (isInteractiveTarget(event.target)) {
        return
      }

      if (event.key === 'Escape') {
        if (document.fullscreenElement) {
          event.preventDefault()
          void document.exitFullscreen()
        }
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        void togglePresentationFullscreen(shellRef.current)
        return
      }
      if (key === 'b') {
        event.preventDefault()
        setBlankScreen((current) => !current)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        updatePresentationStep({
          direction: 1,
          sectionIndex,
          sections: keyboardSections,
          problems: data.problems,
          lessonExamples: data.lessonExamples,
          selectedLesson,
          selectedTopic,
          setSearchParams,
          topicLessons: keyboardTopicLessons,
        })
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        updatePresentationStep({
          direction: -1,
          sectionIndex,
          sections: keyboardSections,
          problems: data.problems,
          lessonExamples: data.lessonExamples,
          selectedLesson,
          selectedTopic,
          setSearchParams,
          topicLessons: keyboardTopicLessons,
        })
        return
      }
      if (event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault()
        scrollStage(event.shiftKey ? -1 : 1, stageRef.current)
        return
      }
      if (event.key === 'PageUp') {
        event.preventDefault()
        scrollStage(-1, stageRef.current)
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        updateStoredTextSize(increaseTextSize(textSize), setTextSize)
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        updateStoredTextSize(decreaseTextSize(textSize), setTextSize)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    blankScreen,
    controlsPinned,
    data.problems,
    data.lessonExamples,
    lessonMenuOpen,
    sectionDrawerOpen,
    sectionIndex,
    data.moduleLessons,
    selectedLesson,
    selectedTopic,
    setSearchParams,
    textSize,
  ])

  if (!module || !selectedTopic || !currentSection) {
    return (
      <div className="presentation-shell">
        <EmptyState
          icon="book"
          title="No lesson to present"
          message="Choose a module topic with at least one lesson before opening presentation mode."
        />
      </div>
    )
  }

  const progress = ((sectionIndex + 1) / sections.length) * 100

  return (
    <div
      className={[
        'presentation-shell',
        `presentation-shell--text-${textSize}`,
        controlsVisible || controlsPinned ? '' : 'presentation-shell--controls-hidden',
      ].filter(Boolean).join(' ')}
      onFocusCapture={revealControls}
      onMouseMove={revealControls}
      onPointerDown={revealControls}
      onTouchStart={revealControls}
      ref={shellRef}
    >
      <header className="presentation-topbar presentation-chrome">
        <Link className="presentation-icon-button" title="Back to Modules" to={backUrl}>
          <Icon name="arrow-left" />
          <span className="sr-only">Back to Modules</span>
        </Link>
        <div className="presentation-title">
          <span>{module.title} / {selectedTopic.title}</span>
          <strong>{selectedLesson?.title ?? 'Topic Introduction'}</strong>
        </div>
        <div className="presentation-topbar__actions">
          <div className="presentation-menu">
            <button
              aria-expanded={lessonMenuOpen}
              aria-haspopup="menu"
              className="presentation-lesson-trigger"
              onClick={() => {
                setLessonMenuOpen((current) => !current)
                setSectionDrawerOpen(false)
              }}
              type="button"
            >
              <span>{selectedLesson ? `Lesson ${lessonIndex + 1} of ${topicLessons.length}` : 'Topic Introduction'}</span>
              <Icon name="menu" />
            </button>
            {lessonMenuOpen ? (
              <div className="presentation-menu__panel presentation-lesson-menu" role="menu">
                <button
                  aria-current={!selectedLesson ? 'page' : undefined}
                  className={!selectedLesson ? 'active' : ''}
                  onClick={selectTopicIntroduction}
                  role="menuitem"
                  type="button"
                >
                  <span>00</span>
                  <strong>Topic Introduction</strong>
                </button>
                {topicLessons.map((lesson, index) => (
                  <button
                    aria-current={lesson.id === selectedLesson?.id ? 'page' : undefined}
                    className={lesson.id === selectedLesson?.id ? 'active' : ''}
                    key={lesson.id}
                    onClick={() => selectLesson(lesson)}
                    role="menuitem"
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{lesson.title}</strong>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="presentation-icon-button"
            disabled={!document.fullscreenEnabled}
            onClick={() => void toggleFullscreen()}
            title={document.fullscreenEnabled ? (isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)') : 'Fullscreen is unavailable'}
            type="button"
          >
            <Icon name={isFullscreen ? 'shrink' : 'expand'} />
          </button>
        </div>
      </header>

      <main
        className={`presentation-stage presentation-stage--${currentSection.kind}`}
        ref={stageRef}
        tabIndex={-1}
      >
        <div className="presentation-stage__inner">
          <span className="presentation-kicker">
            {!selectedLesson
              ? 'Topic Introduction'
              : currentSection.kind === 'coding'
              ? 'Coding Activity'
              : `Section ${sectionIndex + 1} of ${sections.length}`}
          </span>
          <h1>{currentSection.title}</h1>
          <PresentationContent data={data} section={currentSection} />
        </div>
      </main>

      <footer className="presentation-controls presentation-chrome">
        <div className="presentation-controls__navigation">
          <button
            aria-label="Previous section"
            className="presentation-icon-button"
            disabled={!selectedLesson && sectionIndex === 0}
            onClick={() => movePresentation(-1)}
            title="Previous section (Left Arrow)"
            type="button"
          >
            <Icon name="arrow-left" />
          </button>
          <div className="presentation-progress">
            <div>
              <strong>{currentSection.title}</strong>
              <span>
                {selectedLesson
                  ? `Lesson ${lessonIndex + 1} / ${topicLessons.length}`
                  : 'Topic Introduction'} | Section {sectionIndex + 1} / {sections.length}
              </span>
            </div>
            <span className="presentation-progress__track" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          </div>
          <button
            aria-label="Next section"
            className="presentation-icon-button presentation-icon-button--primary"
            disabled={
              Boolean(selectedLesson) &&
              lessonIndex === topicLessons.length - 1 &&
              sectionIndex >= sections.length - 1
            }
            onClick={() => movePresentation(1)}
            title="Next section (Right Arrow)"
            type="button"
          >
            <Icon name="arrow-right" />
          </button>
        </div>
        <div className="presentation-controls__tools">
          <button
            aria-expanded={sectionDrawerOpen}
            aria-label="Open section list"
            className="presentation-icon-button"
            onClick={() => {
              setSectionDrawerOpen((current) => !current)
              setLessonMenuOpen(false)
            }}
            title="Sections"
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="presentation-text-controls" aria-label="Presentation text size">
            <button
              aria-label="Decrease text size"
              disabled={textSize === 'small'}
              onClick={() => changeTextSize(decreaseTextSize(textSize))}
              title="Decrease text size (-)"
              type="button"
            >
              <Icon name="minus" />
            </button>
            <span>{textSize === 'small' ? 'S' : textSize === 'large' ? 'L' : 'M'}</span>
            <button
              aria-label="Increase text size"
              disabled={textSize === 'large'}
              onClick={() => changeTextSize(increaseTextSize(textSize))}
              title="Increase text size (+)"
              type="button"
            >
              <Icon name="plus" />
            </button>
          </div>
          <button
            aria-label="Blank the presentation screen"
            className="presentation-icon-button"
            onClick={() => setBlankScreen(true)}
            title="Blank screen (B)"
            type="button"
          >
            <Icon name="eye-off" />
          </button>
        </div>
      </footer>

      {sectionDrawerOpen ? (
        <>
          <button
            aria-label="Close section list"
            className="presentation-drawer-backdrop"
            onClick={() => setSectionDrawerOpen(false)}
            type="button"
          />
          <aside className="presentation-section-drawer presentation-chrome">
            <div className="presentation-section-drawer__header">
              <div>
                <span>Lesson sections</span>
                <strong>{selectedLesson?.title ?? 'Topic Introduction'}</strong>
              </div>
              <button
                aria-label="Close section list"
                className="presentation-icon-button"
                onClick={() => setSectionDrawerOpen(false)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="presentation-section-list">
              {sections.map((section, index) => (
                <button
                  aria-current={index === sectionIndex ? 'location' : undefined}
                  className={index === sectionIndex ? 'active' : ''}
                  key={section.id}
                  onClick={() => selectSection(index)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{section.title}</strong>
                </button>
              ))}
            </div>
          </aside>
        </>
      ) : null}

      {blankScreen ? (
        <button
          aria-label="Restore lesson presentation"
          className="presentation-blank-screen"
          onClick={() => setBlankScreen(false)}
          type="button"
        >
          <span>Press B or click to return</span>
        </button>
      ) : null}
    </div>
  )
}

function buildPresentationSections(
  lesson: ModuleLesson,
  problems: ProgrammingProblem[],
  examples = [] as { lesson: number }[],
): PresentationSection[] {
  const lessonSections = [
    ["What We'll Learn", lesson.learning_targets || lesson.objectives],
    ['Before We Start', lesson.before_you_start],
    ["Let's Understand", lesson.short_discussion || lesson.overview],
    ["Let's Look at Examples", ''],
    ["Let's Practice", lesson.lets_practice],
    ['Challenge Task', lesson.challenge_task],
  ]
    .filter(
      ([title, content]) =>
        (title === "Let's Look at Examples" && examples.length > 0) ||
        (typeof content === 'string' && content.trim()),
    )
    .map(([title, content]) => ({
      content,
      id: presentationSectionId(title),
      kind: 'lesson' as const,
      lessonId: lesson.id,
      title,
    }))
  const codingSections = problems.map((problem) => ({
    content: [
      problem.description,
      `Difficulty: ${problem.difficulty}`,
      `Points: ${problem.points_possible}`,
      problem.starter_code ? `\`\`\`java\n${problem.starter_code}\n\`\`\`` : '',
    ].filter(Boolean).join('\n\n'),
    id: `coding-${problem.id}`,
    kind: 'coding' as const,
    title: problem.title,
  }))

  return [...lessonSections, ...codingSections]
}

function buildTopicIntroductionSections(topic: ModuleTopic): PresentationSection[] {
  return [
    ['Topic Overview', topic.overview],
    ['Learning Competencies', topic.competency_text],
    ['Essential Question', topic.essential_question],
    ['Enduring Understanding', topic.enduring_understanding],
    ['Performance Task', topic.performance_task],
    ['Success Criteria', topic.success_criteria],
  ]
    .filter(([, content]) => content.trim())
    .map(([title, content]) => ({
      content,
      id: `topic-${presentationSectionId(title)}`,
      kind: 'lesson' as const,
      title,
    }))
}

function PresentationContent({
  data,
  section,
}: {
  data: WorkspaceData
  section: PresentationSection
}) {
  const examples = section.lessonId
    ? data.lessonExamples.filter((example) => example.lesson === section.lessonId)
    : []

  return (
    <>
      {section.content.trim() ? (
        <RichLessonText value={section.content} variant="presentation" />
      ) : null}
      {section.title === "Let's Look at Examples" ? (
        <LessonExampleCards examples={examples} variant="presentation" />
      ) : null}
    </>
  )
}

function presentationSectionId(title: string) {
  return lessonSectionId(title).replace('lesson-section-', '')
}

function readTextSize(): PresentationTextSize {
  try {
    const storedSize = window.localStorage.getItem(TEXT_SIZE_KEY)
    if (storedSize === 'large' || storedSize === 'small') {
      return storedSize
    }
  } catch {
    // Use the default when storage is unavailable.
  }
  return 'default'
}

function increaseTextSize(size: PresentationTextSize): PresentationTextSize {
  return size === 'small' ? 'default' : 'large'
}

function decreaseTextSize(size: PresentationTextSize): PresentationTextSize {
  return size === 'large' ? 'default' : 'small'
}

function scrollStage(direction: -1 | 1, stage: HTMLElement | null) {
  if (!stage) {
    return
  }

  stage.scrollBy({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    top: stage.clientHeight * 0.82 * direction,
  })
}

async function togglePresentationFullscreen(shell: HTMLElement | null) {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (shell?.requestFullscreen) {
      await shell.requestFullscreen()
    }
  } catch {
    // Fullscreen remains optional when the browser or embedding context blocks it.
  }
}

function updateStoredTextSize(
  nextSize: PresentationTextSize,
  setTextSize: (size: PresentationTextSize) => void,
) {
  setTextSize(nextSize)
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, nextSize)
  } catch {
    // Presentation preferences can remain session-only when storage is unavailable.
  }
}

function updatePresentationStep({
  direction,
  sectionIndex,
  sections,
  problems,
  lessonExamples,
  selectedLesson,
  selectedTopic,
  setSearchParams,
  topicLessons,
}: {
  direction: -1 | 1
  sectionIndex: number
  sections: PresentationSection[]
  problems: ProgrammingProblem[]
  lessonExamples: { lesson: number }[]
  selectedLesson: ModuleLesson | null
  selectedTopic: ModuleTopic | null
  setSearchParams: ReturnType<typeof useSearchParams>[1]
  topicLessons: ModuleLesson[]
}) {
  if (!selectedTopic) {
    return
  }

  const nextSectionIndex = sectionIndex + direction
  if (nextSectionIndex >= 0 && nextSectionIndex < sections.length) {
    const section = sections[nextSectionIndex]
    const params: Record<string, string> = {
      section: section.id,
      topic: String(selectedTopic.id),
    }
    if (selectedLesson) {
      params.lesson = String(selectedLesson.id)
    }
    setSearchParams(params, { replace: true })
    return
  }

  if (!selectedLesson && direction === 1) {
    const firstLesson = topicLessons[0]
    if (firstLesson) {
      setSearchParams(
        {
          lesson: String(firstLesson.id),
          topic: String(selectedTopic.id),
        },
        { replace: true },
      )
    }
    return
  }

  if (!selectedLesson) {
    return
  }

  const lessonIndex = topicLessons.findIndex(
    (lesson) => lesson.id === selectedLesson.id,
  )
  if (direction === -1 && lessonIndex === 0) {
    const introductionSections = buildTopicIntroductionSections(selectedTopic)
    const lastIntroduction = introductionSections[introductionSections.length - 1]
    setSearchParams(
      {
        section: lastIntroduction?.id ?? '',
        topic: String(selectedTopic.id),
      },
      { replace: true },
    )
    return
  }

  const adjacentLesson = topicLessons[lessonIndex + direction]
  if (!adjacentLesson) {
    return
  }
  const adjacentProblems = problems.filter(
    (problem) =>
      problem.lesson === adjacentLesson.id && problem.is_published,
  )
  const adjacentSections = buildPresentationSections(
    adjacentLesson,
    adjacentProblems,
    lessonExamples.filter((example) => example.lesson === adjacentLesson.id),
  )
  const targetSection =
    direction === 1
      ? adjacentSections[0]
      : adjacentSections[adjacentSections.length - 1]
  setSearchParams(
    {
      lesson: String(adjacentLesson.id),
      section: targetSection?.id ?? '',
      topic: String(selectedTopic.id),
    },
    { replace: true },
  )
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(
    target.closest('a, button, input, select, textarea, [contenteditable="true"]'),
  )
}
