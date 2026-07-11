import type { WorkspaceData } from '../app/types'
import type { Module, ModuleLesson, ModuleTopic } from '../types'

export type LessonSection = {
  content: string
  title: string
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
    lesson.key_terms,
    lesson.before_you_start,
    lesson.short_discussion,
    lesson.lets_practice,
    lesson.apply_what_you_learned,
    lesson.challenge_task,
    lesson.rubric,
    lesson.reflection,
    lesson.evidence_of_learning,
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
  | 'apply_what_you_learned'
  | 'before_you_start'
  | 'challenge_task'
  | 'key_terms'
  | 'learning_targets'
  | 'lets_practice'
  | 'objectives'
  | 'overview'
  | 'reflection'
  | 'evidence_of_learning'
  | 'resources'
  | 'rubric'
  | 'short_discussion'
  | 'student_activities'
  | 'title'
>, options: { hasStructuredExamples?: boolean } = {}) {
  const sections = [
    ["What We'll Learn", lesson.learning_targets || lesson.objectives],
    ["Words We'll Use", lesson.key_terms],
    ['Before We Start', lesson.before_you_start],
    ["Let's Understand", lesson.short_discussion || lesson.overview],
    ["Let's Look at Examples", ''],
    ["Let's Practice", lesson.lets_practice],
    ['Now We Apply', lesson.apply_what_you_learned],
    ['Challenge Task', lesson.challenge_task],
    ['How Our Work Will Be Checked', lesson.rubric],
    ["Let's Reflect", lesson.reflection],
    ['How We Show Learning', lesson.evidence_of_learning],
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
