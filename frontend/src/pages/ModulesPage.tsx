import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WorkspaceData } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, Page, PageHeader, SearchBox, SectionHeading, SkeletonCard } from '../components/ui'
import { getActiveStudentSubjectIds, hasActiveModuleAccess, moduleAccessLabel } from '../utils/student'
import { moduleSearchText, modulesForSubject } from '../utils/modules'

export function ModulesPage({ data }: { data: WorkspaceData }) {
  const [query, setQuery] = useState('')
  const activeSubjectIds = useMemo(() => getActiveStudentSubjectIds(data), [data])
  const visibleSubjects = useMemo(
    () => data.subjects.filter((subject) => activeSubjectIds.has(subject.id)),
    [activeSubjectIds, data.subjects],
  )
  const [subjectId, setSubjectId] = useState<number | null>(
    visibleSubjects[0]?.id ?? null,
  )

  useEffect(() => {
    if (subjectId && visibleSubjects.some((subject) => subject.id === subjectId)) {
      return
    }

    setSubjectId(visibleSubjects[0]?.id ?? null)
  }, [subjectId, visibleSubjects])

  const modules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return modulesForSubject(data.modules, subjectId).filter((module) => {
      const matchesQuery = !normalizedQuery || moduleSearchText(module)
        .toLowerCase()
        .includes(normalizedQuery)

      return matchesQuery && module.is_published && hasActiveModuleAccess(data, module)
    })
  }, [data, query, subjectId])

  const selectedSubject = data.subjects.find((subject) => subject.id === subjectId)

  return (
    <Page>
      <PageHeader
        eyebrow="Learning library"
        title="Modules"
        description="Choose a subject, then open the topic lesson material for that class."
      />

      {data.loading ? (
        <div className="module-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <section className="lesson-browser">
          <aside className="lesson-browser__subjects section-block">
            <SectionHeading
              subtitle={`${visibleSubjects.length} active subject${visibleSubjects.length === 1 ? '' : 's'}`}
              title="Subjects"
            />
            <div className="lesson-subject-list">
              {visibleSubjects.map((subject) => (
                <button
                  className={
                    subject.id === subjectId
                      ? 'lesson-subject active'
                      : 'lesson-subject'
                  }
                  key={subject.id}
                  onClick={() => setSubjectId(subject.id)}
                  type="button"
                >
                  <strong>{subject.code}</strong>
                  <span>{subject.name}</span>
                </button>
              ))}
              {!visibleSubjects.length ? (
                <p className="admin-empty-line">No active subjects yet.</p>
              ) : null}
            </div>
          </aside>

          <main className="lesson-browser__topics section-block">
            <SectionHeading
              subtitle={selectedSubject ? selectedSubject.name : 'Choose a subject'}
              title={selectedSubject?.code ?? 'Topics'}
              action={
                <SearchBox
                  onChange={setQuery}
                  placeholder="Search topics"
                  value={query}
                />
              }
            />

            {modules.length ? (
              <div className="topic-list">
                {modules.map((module) => (
                  <Link className="topic-row" key={module.id} to={`/modules/${module.id}`}>
                    <span className="topic-row__icon">
                      <Icon name="book" />
                    </span>
                    <div>
                      <strong>{module.title}</strong>
                      <span>{module.description || 'Lesson material'}</span>
                    </div>
                    <small>{moduleAccessLabel(data, module)}</small>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="search"
                title="No matching topics"
                message="Try another search or choose a different subject."
              />
            )}
          </main>
        </section>
      )}
    </Page>
  )
}
