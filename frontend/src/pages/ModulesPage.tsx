import { useMemo, useState } from 'react'
import type { WorkspaceData } from '../app/types'
import { ModuleCard } from '../components/cards'
import { EmptyState, Page, PageHeader, SearchBox, SkeletonCard, Toolbar } from '../components/ui'
import { hasActiveModuleAccess } from '../utils/student'

export function ModulesPage({ data }: { data: WorkspaceData }) {
  const [query, setQuery] = useState('')
  const [subjectId, setSubjectId] = useState('all')

  const modules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return data.modules.filter((module) => {
      const matchesQuery =
        !normalizedQuery ||
        `${module.title} ${module.description} ${module.content} ${module.learning_objectives} ${module.lesson_overview} ${module.detailed_discussion} ${module.examples} ${module.teacher_notes} ${module.student_activities} ${module.resources}`
          .toLowerCase()
          .includes(normalizedQuery)
      const matchesSubject =
        subjectId === 'all' || module.subjects.includes(Number(subjectId))

      return matchesQuery && matchesSubject && hasActiveModuleAccess(data, module)
    })
  }, [data, query, subjectId])

  return (
    <Page>
      <PageHeader
        eyebrow="Learning library"
        title="Modules"
        description="Browse published learning modules and open the activities attached to each lesson."
      />

      <Toolbar>
        <SearchBox
          onChange={setQuery}
          placeholder="Search modules"
          value={query}
        />
        <label className="select-control">
          <span>Subject</span>
          <select
            onChange={(event) => setSubjectId(event.target.value)}
            value={subjectId}
          >
            <option value="all">All subjects</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.code} - {subject.name}
              </option>
            ))}
          </select>
        </label>
      </Toolbar>

      {data.loading ? (
        <div className="module-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : modules.length ? (
        <div className="module-grid">
          {modules.map((module) => (
            <ModuleCard data={data} key={module.id} module={module} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="search"
          title="No matching modules"
          message="Try another search or subject filter."
        />
      )}
    </Page>
  )
}
