import { useParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../app/types'
import { CodingBlankPanel } from '../components/activityForms'
import { NotFoundState, Page, PageHeader, SectionHeading } from '../components/ui'
import { numeric } from '../utils/format'

export function CodingProblemPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const { problemId } = useParams()
  const problem = data.problems.find((item) => item.id === Number(problemId))

  if (!problem) {
    return (
      <Page>
        <NotFoundState
          message="This coding problem is not available right now."
          to="/coding"
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow={problem.difficulty}
        title={problem.title}
        description={`${numeric(problem.points_possible)} points possible`}
      />

      <section className="content-grid">
        <article className="reading-panel">
          <SectionHeading subtitle="Problem statement" title="Brief" />
          <div className="rich-text">
            {problem.description.split('\n').map((paragraph) =>
              paragraph.trim() ? <p key={paragraph}>{paragraph}</p> : null,
            )}
          </div>
          {problem.starter_code ? (
            <pre className="code-block">
              <code>{problem.starter_code}</code>
            </pre>
          ) : null}
        </article>

        <aside className="section-block">
          <CodingBlankPanel
            api={api}
            currentUser={data.currentUser}
            onSubmitted={refresh}
            problem={problem}
          />
        </aside>
      </section>
    </Page>
  )
}
