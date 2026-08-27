import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest } from '../app/types'
import type { ModuleActivity, ModuleActivitySubmission, User } from '../types'
import { toErrorMessage } from '../utils/format'
import { Icon } from './Icon'
import { SectionHeading } from './ui'

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
