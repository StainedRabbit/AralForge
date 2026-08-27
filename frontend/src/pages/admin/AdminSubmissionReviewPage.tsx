import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AuthedRequest } from '../../app/types'
import { Icon } from '../../components/Icon'
import { MetaStrip, Page, PageHeader, SkeletonList, StatusBanner } from '../../components/ui'
import { queryKeys } from '../../queries/queryKeys'
import type { ModuleActivitySubmission } from '../../types'
import { formatDateTime, resolveMediaUrl, toErrorMessage } from '../../utils/format'

type LinkedGradeItem = {
  id: number
  schedule_id: number
  subject_code: string
  section: string
  grade_category_id: number
  grading_period: string
}

type SubmissionReview = ModuleActivitySubmission & {
  student_name: string
  student_username: string
  activity_title: string
  activity_type: 'TEXT' | 'FILE_UPLOAD'
  activity_points_possible: string
  module_id: number
  module_title: string
  topic_id: number | null
  lesson_id: number | null
  linked_grade_items: LinkedGradeItem[]
}

export function AdminSubmissionReviewPage({ api }: { api: AuthedRequest }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submissionId = Number(useParams().submissionId)

  const query = useQuery({
    enabled: Number.isInteger(submissionId) && submissionId > 0,
    queryKey: ['submission-review', submissionId],
    queryFn: ({ signal }) => api<SubmissionReview>(`/modules/submissions/${submissionId}/review/`, { signal }),
  })

  const gradeMutation = useMutation({
    mutationFn: (grade: { feedback: string; score: string }) => api<SubmissionReview>(`/modules/submissions/${submissionId}/grade/`, {
      body: JSON.stringify(grade),
      method: 'POST',
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.navigation }),
        queryClient.invalidateQueries({ queryKey: ['submission-review', submissionId] }),
      ])
      navigate('/admin', { replace: true })
    },
  })

  if (!Number.isInteger(submissionId) || submissionId < 1) {
    return <Page><StatusBanner tone="warning" title="Submission not found" message="Return to Overview and choose a submission from the review queue." /></Page>
  }
  if (query.isPending) return <Page><SkeletonList count={3} /></Page>
  if (!query.data || query.error) {
    return <Page><StatusBanner tone="warning" title="Submission could not load" message={query.error ? toErrorMessage(query.error) : 'Return to Overview and try again.'} /></Page>
  }

  const submission = query.data
  const settingsUrl = submission.lesson_id && submission.topic_id
    ? `/admin/modules/${submission.module_id}/topics/${submission.topic_id}/lessons/${submission.lesson_id}/edit#main-activity`
    : `/admin/modules/${submission.module_id}/edit`

  function submitGrade(event: FormEvent) {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    gradeMutation.mutate({
      feedback: String(form.get('feedback') ?? ''),
      score: String(form.get('score') ?? ''),
    })
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Focused review"
        title={submission.activity_title}
        description={`Review ${submission.student_name}'s submission without leaving the grading task.`}
        actions={<Link className="button button--secondary" to="/admin"><Icon name="arrow-left" /><span>Back to Overview</span></Link>}
      />

      <div className="submission-review-grid">
        <section className="section-block submission-review-panel">
          <div className="submission-review-heading">
            <div><span className="eyebrow">Student response</span><h2>{submission.student_name}</h2><p>@{submission.student_username}</p></div>
            <span className="status-pill">{submission.activity_type === 'FILE_UPLOAD' ? 'File upload' : 'Text response'}</span>
          </div>
          <MetaStrip items={[
            ['Module', submission.module_title],
            ['Submitted', formatDateTime(submission.submitted_at)],
            ['Points possible', String(Number(submission.activity_points_possible))],
          ]} />

          {submission.text_answer ? (
            <div className="submission-response"><span>Response</span><p>{submission.text_answer}</p></div>
          ) : null}
          {submission.file ? (
            <a className="submission-file-link" href={resolveMediaUrl(submission.file)} rel="noreferrer" target="_blank">
              <Icon name="file" /><span><strong>Open submitted file</strong><small>Opens in a new tab</small></span><Icon name="arrow-right" />
            </a>
          ) : null}
          {!submission.text_answer && !submission.file ? <p className="admin-empty-line">This submission does not contain a response or file.</p> : null}
        </section>

        <aside className="section-block submission-review-panel">
          <div className="submission-review-heading"><div><span className="eyebrow">Assessment</span><h2>Grade submission</h2></div></div>

          {submission.linked_grade_items.length ? (
            <div className="gradebook-link-status gradebook-link-status--linked">
              <Icon name="check" />
              <div><strong>Linked to the gradebook</strong><span>Saving will update {submission.linked_grade_items.length} linked grade item{submission.linked_grade_items.length === 1 ? '' : 's'}.</span></div>
            </div>
          ) : (
            <div className="gradebook-link-status gradebook-link-status--warning">
              <Icon name="warning" />
              <div><strong>Not linked to a gradebook item</strong><span>The score will remain on this submission.</span><Link to={settingsUrl}>Open Main Activity settings</Link></div>
            </div>
          )}

          <form className="submission-grade-form" onSubmit={submitGrade}>
            <label className="admin-field">
              <span>Score</span>
              <div className="submission-score-input"><input autoFocus defaultValue={submission.score ?? ''} max={submission.activity_points_possible} min="0" name="score" required step="0.01" type="number" /><span>/ {Number(submission.activity_points_possible)}</span></div>
            </label>
            <label className="admin-field"><span>Feedback</span><textarea defaultValue={submission.feedback ?? ''} name="feedback" placeholder="Share clear, useful feedback with the student." rows={8} /></label>
            {gradeMutation.error ? <StatusBanner tone="warning" title="Grade could not be saved" message={toErrorMessage(gradeMutation.error)} /> : null}
            <button className="button button--primary" disabled={gradeMutation.isPending} type="submit"><Icon name="save" /><span>{gradeMutation.isPending ? 'Saving…' : 'Save grade'}</span></button>
          </form>

          {submission.linked_grade_items.length ? (
            <div className="submission-gradebook-links"><span>Linked classes</span>{submission.linked_grade_items.map((item) => <Link key={item.id} to={`/admin/gradebook?schedule=${item.schedule_id}&category=${item.grade_category_id}&item=${item.id}`}>{item.subject_code} · {item.section || 'No section'} · {periodLabel(item.grading_period)}</Link>)}</div>
          ) : null}
        </aside>
      </div>
    </Page>
  )
}

function periodLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase()
}
