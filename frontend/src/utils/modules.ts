import type { WorkspaceData } from '../app/types'
import type { Module } from '../types'

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
    module.teacher_notes,
    module.student_activities,
    module.resources,
  ].join(' ')
}

export function modulesForSubject(modules: Module[], subjectId: number | null) {
  return modules
    .filter((module) => !subjectId || module.subjects.includes(subjectId))
    .sort((first, second) => first.title.localeCompare(second.title))
}

export function getLessonSections(module: Pick<
  Module,
  | 'content'
  | 'detailed_discussion'
  | 'examples'
  | 'learning_objectives'
  | 'lesson_overview'
  | 'resources'
  | 'student_activities'
  | 'teacher_notes'
>) {
  const sections = [
    ['Learning Objectives', module.learning_objectives],
    ['Lesson Overview', module.lesson_overview],
    ['Detailed Discussion', module.detailed_discussion],
    ['Examples', module.examples],
    ['Teacher Notes / Guide', module.teacher_notes],
    ['Student Activities', module.student_activities],
    ['Resources / References', module.resources],
  ]
    .filter(([, content]) => content.trim())
    .map(([title, content]) => ({ title, content }))

  if (sections.length || !module.content.trim()) {
    return sections
  }

  return [{ title: 'Lesson Notes', content: module.content }]
}

export function subjectName(data: WorkspaceData, subjectId: number | null) {
  const subject = data.subjects.find((item) => item.id === subjectId)
  return subject ? `${subject.code} - ${subject.name}` : 'All subjects'
}
