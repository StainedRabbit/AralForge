import { useMemo, useState } from 'react'
import type { RouteData } from '../app/types'
import { ProblemCard } from '../components/cards'
import { EmptyState, Page, PageHeader, SearchBox, SkeletonCard, Toolbar } from '../components/ui'

export function CodingPage({ data }: { data: RouteData }) {
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('all')
  const problems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return data.problems.filter((problem) => {
      const matchesQuery =
        !normalizedQuery ||
        `${problem.title} ${problem.description}`
          .toLowerCase()
          .includes(normalizedQuery)
      const matchesDifficulty =
        difficulty === 'all' || problem.difficulty === difficulty

      return matchesQuery && matchesDifficulty
    })
  }, [data.problems, difficulty, query])

  return (
    <Page>
      <PageHeader
        eyebrow="Practice lab"
        title="Coding"
        description="Solve programming problems and submit multiple fill-in-the-blank answers when a problem includes blanks."
      />

      <Toolbar>
        <SearchBox
          onChange={setQuery}
          placeholder="Search coding problems"
          value={query}
        />
        <label className="select-control">
          <span>Difficulty</span>
          <select
            onChange={(event) => setDifficulty(event.target.value)}
            value={difficulty}
          >
            <option value="all">All levels</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </label>
      </Toolbar>

      <div className="problem-grid">
        {data.loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : problems.length ? (
          problems.map((problem) => (
            <ProblemCard data={data} key={problem.id} problem={problem} />
          ))
        ) : (
          <EmptyState
            icon="code"
            title="No coding problems"
            message="Published programming problems from Django will appear here."
          />
        )}
      </div>
    </Page>
  )
}
