import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest } from '../app/types'
import type {
  CodeSubmission,
  ModuleActivity,
  ModuleActivitySubmission,
  ProgrammingProblem,
  User,
} from '../types'
import { toErrorMessage } from '../utils/format'
import { Icon } from './Icon'
import { EmptyState, SectionHeading } from './ui'

export function ModuleSubmissionForm({
  activity,
  api,
  currentUser,
  existingSubmission,
  onSubmitted,
}: {
  activity: ModuleActivity
  api: AuthedRequest
  currentUser: User | null
  existingSubmission?: ModuleActivitySubmission
  onSubmitted: () => Promise<void>
}) {
  const [textAnswer, setTextAnswer] = useState(existingSubmission?.text_answer ?? '')
  const [code, setCode] = useState(existingSubmission?.code ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUser) {
      setMessage('Your account could not be loaded. Refresh and try again.')
      return
    }

    setSaving(true)
    setMessage('')

    const endpoint = existingSubmission
      ? `/modules/submissions/${existingSubmission.id}/`
      : '/modules/submissions/'
    const method = existingSubmission ? 'PATCH' : 'POST'

    try {
      if (activity.accepts_file || file) {
        const formData = new FormData()
        formData.append('activity', activity.id.toString())
        formData.append('student', currentUser.id.toString())
        formData.append('text_answer', textAnswer)
        formData.append('code', code)

        if (file) {
          formData.append('file', file)
        }

        await api(endpoint, { method, body: formData })
      } else {
        await api(endpoint, {
          method,
          body: JSON.stringify({
            activity: activity.id,
            student: currentUser.id,
            text_answer: textAnswer,
            code,
          }),
        })
      }

      setMessage('Submission saved.')
      await onSubmitted()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <SectionHeading
        subtitle={existingSubmission ? 'Update your submission.' : 'Send your work.'}
        title="Submit Activity"
      />

      {activity.accepts_text ? (
        <label>
          <span>Text answer</span>
          <textarea
            onChange={(event) => setTextAnswer(event.target.value)}
            placeholder="Write your answer here"
            rows={7}
            value={textAnswer}
          />
        </label>
      ) : null}

      {activity.accepts_code || activity.activity_type === 'CODE_COMPLETE' ? (
        <label>
          <span>Code</span>
          <textarea
            className="code-input"
            onChange={(event) => setCode(event.target.value)}
            placeholder="Paste or write your solution code"
            rows={10}
            value={code}
          />
        </label>
      ) : null}

      {activity.accepts_file || activity.activity_type === 'FILE_UPLOAD' ? (
        <label className="file-control">
          <span>Attachment</span>
          <input
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
      ) : null}

      {message ? (
        <div className="inline-alert">
          <Icon name={message.includes('saved') ? 'check' : 'warning'} />
          <span>{message}</span>
        </div>
      ) : null}

      <button className="button button--primary" disabled={saving} type="submit">
        <Icon name={activity.accepts_file ? 'upload' : 'send'} />
        <span>{saving ? 'Saving...' : 'Submit work'}</span>
      </button>
    </form>
  )
}

export function CodingBlankPanel({
  api,
  currentUser,
  onSubmitted,
  problem,
}: {
  api: AuthedRequest
  currentUser: User | null
  onSubmitted: () => Promise<void>
  problem: ProgrammingProblem
}) {
  const [sourceCode, setSourceCode] = useState(problem.starter_code)
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(problem.blanks.map((blank) => [blank.id, ''])),
  )
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUser) {
      setMessage('Your account could not be loaded. Refresh and try again.')
      return
    }

    if (!problem.blanks.length) {
      setMessage('This problem has no blanks yet.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const submission = await api<CodeSubmission>('/coding/submissions/', {
        method: 'POST',
        body: JSON.stringify({
          problem: problem.id,
          student: currentUser.id,
          language: problem.expected_language || 'python',
          source_code: sourceCode || problem.starter_code || problem.description,
        }),
      })

      await Promise.all(
        problem.blanks.map((blank) =>
          api('/coding/blank-answers/', {
            method: 'POST',
            body: JSON.stringify({
              submission: submission.id,
              blank: blank.id,
              answer: answers[blank.id] ?? '',
            }),
          }),
        ),
      )

      setMessage('Blank answers submitted.')
      await onSubmitted()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={submitAnswers}>
      <SectionHeading
        subtitle={`${problem.blanks.length} blank${problem.blanks.length === 1 ? '' : 's'} available`}
        title="Fill in the Blanks"
      />

      {problem.starter_code ? (
        <label>
          <span>Starter code</span>
          <textarea
            className="code-input"
            onChange={(event) => setSourceCode(event.target.value)}
            rows={8}
            value={sourceCode}
          />
        </label>
      ) : null}

      {problem.blanks.length ? (
        problem.blanks.map((blank, index) => (
          <label className="blank-field" key={blank.id}>
            <span>
              Blank {index + 1}: {blank.key}
            </span>
            {blank.prompt ? <small>{blank.prompt}</small> : null}
            <input
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [blank.id]: event.target.value,
                }))
              }
              placeholder={blank.hint || 'Enter your answer'}
              required
              type="text"
              value={answers[blank.id] ?? ''}
            />
          </label>
        ))
      ) : (
        <EmptyState
          icon="code"
          title="No blanks configured"
          message="Add CodeBlank rows to this programming problem in the backend."
        />
      )}

      {message ? (
        <div className="inline-alert">
          <Icon name={message.includes('submitted') ? 'check' : 'warning'} />
          <span>{message}</span>
        </div>
      ) : null}

      <button
        className="button button--primary"
        disabled={saving || !problem.blanks.length}
        type="submit"
      >
        <Icon name="send" />
        <span>{saving ? 'Submitting...' : 'Submit blanks'}</span>
      </button>
    </form>
  )
}
