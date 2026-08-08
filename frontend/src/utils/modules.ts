import type { WorkspaceData } from '../app/types'
import type {
  Module,
  ModuleLesson,
  ModuleLessonProgress,
  ModuleTopic,
} from '../types'

export type LessonSection = {
  content: string
  title: string
}

export type LessonResumeMode = 'continue' | 'resume' | 'review' | 'start'

export type LessonResumeTarget = {
  lesson: ModuleLesson
  mode: LessonResumeMode
}

export function getLessonResumeTarget(
  lessons: ModuleLesson[],
  progressRecords: ModuleLessonProgress[],
  {
    currentUserId,
    isAccessible,
  }: {
    currentUserId: number | null
    isAccessible: boolean
  },
): LessonResumeTarget | null {
  if (!isAccessible) {
    return null
  }

  const publishedLessons = lessons.filter((lesson) => lesson.is_published)
  if (!publishedLessons.length) {
    return null
  }

  const lessonById = new Map(
    publishedLessons.map((lesson) => [lesson.id, lesson]),
  )
  const validProgress = progressRecords.filter(
    (progress) =>
      progress.student === currentUserId && lessonById.has(progress.lesson),
  )
  const progressByLesson = new Map(
    validProgress.map((progress) => [progress.lesson, progress]),
  )
  const byMostRecent = [...validProgress].sort(
    (first, second) =>
      resumeTimestamp(second.last_viewed_at) - resumeTimestamp(first.last_viewed_at),
  )
  const recentUnfinished = byMostRecent.find((progress) => !progress.completed_at)

  if (recentUnfinished) {
    return {
      lesson: lessonById.get(recentUnfinished.lesson)!,
      mode: 'resume',
    }
  }

  const firstUnstarted = publishedLessons.find(
    (lesson) => !progressByLesson.has(lesson.id),
  )
  if (firstUnstarted) {
    return {
      lesson: firstUnstarted,
      mode: validProgress.length ? 'continue' : 'start',
    }
  }

  const recentLesson = byMostRecent[0]
  return recentLesson
    ? { lesson: lessonById.get(recentLesson.lesson)!, mode: 'review' }
    : { lesson: publishedLessons[0], mode: 'start' }
}

export function lessonResumeActionLabel(mode: LessonResumeMode) {
  if (mode === 'resume') return 'Resume Lesson'
  if (mode === 'continue') return 'Continue Lesson'
  if (mode === 'review') return 'Review Last Lesson'
  return 'Start Lesson'
}

function resumeTimestamp(value: string) {
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function moduleSearchText(module: Module) {
  return [
    module.title,
    module.slug,
    module.description,
    module.content,
    module.learning_objectives,
    module.lesson_overview,
    module.detailed_discussion,
    module.examples,
    module.student_activities,
    module.resources,
  ].join(' ')
}

export function modulesForSubject(modules: Module[], subjectId: number | null) {
  return modules
    .filter(
      (module) =>
        !subjectId ||
        module.subject === subjectId ||
        module.subjects.includes(subjectId),
    )
    .sort((first, second) => first.title.localeCompare(second.title))
}

export function topicsForModule(topics: ModuleTopic[], moduleId: number | null) {
  return topics
    .filter((topic) => !moduleId || topic.module === moduleId)
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

export function lessonsForTopic(lessons: ModuleLesson[], topicId: number | null) {
  return lessons
    .filter((lesson) => !topicId || lesson.topic === topicId)
    .sort((first, second) => first.order - second.order || first.id - second.id)
}

export function topicSearchText(topic: ModuleTopic, lessons: ModuleLesson[]) {
  return [
    topic.title,
    topic.competency_code,
    topic.competency_text,
    topic.unit,
    topic.overview,
    ...lessons.map((lesson) => lessonSearchText(lesson)),
  ].join(' ')
}

export function lessonSearchText(lesson: ModuleLesson) {
  return [
    lesson.title,
    lesson.learning_targets,
    lesson.before_you_start,
    lesson.short_discussion,
    lesson.lets_practice,
    lesson.challenge_task,
    lesson.objectives,
    lesson.overview,
    lesson.student_activities,
    lesson.resources,
  ].join(' ')
}

export function topicOwnSearchText(topic: ModuleTopic) {
  return [
    topic.title,
    topic.competency_code,
    topic.competency_text,
    topic.unit,
    topic.overview,
    topic.essential_question,
    topic.enduring_understanding,
    topic.performance_task,
    topic.success_criteria,
    topic.values_focus,
  ].join(' ')
}

export function lessonSectionId(title: string) {
  return `lesson-section-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

export function getLessonSections(lesson: Pick<
  ModuleLesson,
  | 'before_you_start'
  | 'challenge_task'
  | 'learning_targets'
  | 'lets_practice'
  | 'objectives'
  | 'overview'
  | 'resources'
  | 'short_discussion'
  | 'student_activities'
  | 'title'
>, options: { hasStructuredExamples?: boolean } = {}) {
  const sections = [
    ["What We'll Learn", lesson.learning_targets || lesson.objectives],
    ['Before We Start', lesson.before_you_start],
    ["Let's Understand", lesson.short_discussion || lesson.overview],
    ["Let's Look at Examples", ''],
    ["Let's Practice", lesson.lets_practice],
    ['Challenge Task', lesson.challenge_task],
    ['Student Activities', lesson.student_activities],
    ['Resources / References', lesson.resources],
  ]
    .filter(
      ([title, content]) =>
        (title === "Let's Look at Examples" && options.hasStructuredExamples) ||
        (typeof content === 'string' && content.trim()),
    )
    .map(([title, content]) => ({
      title,
      content: String(content),
    }))

  return sections
}

export function subjectName(data: WorkspaceData, subjectId: number | null) {
  const subject = data.subjects.find((item) => item.id === subjectId)
  return subject ? `${subject.code} - ${subject.name}` : 'All subjects'
}
