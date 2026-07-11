import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading } from '../../components/ui'
import type { ModuleTopic } from '../../types'
import { toErrorMessage } from '../../utils/format'
import { subjectName } from '../../utils/modules'

type TopicDraft = {
  competency_code: string
  competency_text: string
  is_published: boolean
  module: string
  order: string
  overview: string
  title: string
  unit: string
  essential_question: string
  enduring_understanding: string
  performance_task: string
  success_criteria: string
  values_focus: string
}

export function AdminTopicEditorPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { moduleId, topicId } = useParams()
  const module = data.modules.find((item) => item.id === Number(moduleId))
  const editingTopic = data.moduleTopics.find((topic) => topic.id === Number(topicId))
  const isEditing = Boolean(topicId)
  const [draft, setDraft] = useState<TopicDraft>(() =>
    createTopicDraft(moduleId ?? '', editingTopic),
  )
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!module || (isEditing && !editingTopic)) {
    return (
      <Page>
        <EmptyState
          icon="warning"
          title={module ? 'Topic not found' : 'Module not found'}
          message="This topic may have been deleted or is not available."
        />
      </Page>
    )
  }

  const backUrl = `/admin/modules${module.subject ? `?subject=${module.subject}` : ''}${editingTopic ? `${module.subject ? '&' : '?'}topic=${editingTopic.id}` : ''}`

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const saved = await api<ModuleTopic>(
        isEditing ? `/modules/topics/${editingTopic?.id}/` : '/modules/topics/',
        {
          body: JSON.stringify(buildTopicPayload(draft)),
          method: isEditing ? 'PATCH' : 'POST',
        },
      )
      await refresh()
      const params = new URLSearchParams()
      if (module?.subject) {
        params.set('subject', String(module.subject))
      }
      params.set('topic', String(saved.id))
      navigate(`/admin/modules?${params.toString()}`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function updateDraft<TField extends keyof TopicDraft>(
    field: TField,
    value: TopicDraft[TField],
  ) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function deleteTopic() {
    if (!editingTopic || !module) {
      return
    }

    const confirmed = window.confirm(
      `Delete "${editingTopic.title}"? This will also delete its lessons, activities, assets, and progress records.`,
    )
    if (!confirmed) {
      return
    }

    setDeleting(true)
    setMessage('')
    try {
      await api(`/modules/topics/${editingTopic.id}/`, { method: 'DELETE' })
      await refresh()
      const subject = module.subject
      navigate(`/admin/modules${subject ? `?subject=${subject}` : ''}`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Topic authoring"
        title={isEditing ? 'Edit Topic' : 'Create Topic'}
        description={subjectName(data, module.subject)}
        actions={
          <Link className="button button--secondary" to={backUrl}>
            <Icon name="module" />
            <span>Back to Modules</span>
          </Link>
        }
      />

      <form className="lesson-editor section-block" onSubmit={submitForm}>
        <SectionHeading
          subtitle={module.title}
          title="Topic Details"
        />

        <div className="lesson-editor__grid">
          <label className="admin-field">
            <span>Title</span>
            <input
              onChange={(event) => updateDraft('title', event.target.value)}
              required
              type="text"
              value={draft.title}
            />
          </label>

          <label className="admin-field">
            <span>Order</span>
            <input
              onChange={(event) => updateDraft('order', event.target.value)}
              type="number"
              value={draft.order}
            />
          </label>

          <label className="admin-field">
            <span>Competency code</span>
            <input
              onChange={(event) => updateDraft('competency_code', event.target.value)}
              type="text"
              value={draft.competency_code}
            />
          </label>

          <label className="admin-field">
            <span>Unit / content area</span>
            <input
              onChange={(event) => updateDraft('unit', event.target.value)}
              type="text"
              value={draft.unit}
            />
          </label>

          <TextArea
            label="Competency text"
            onChange={(value) => updateDraft('competency_text', value)}
            rows={5}
            value={draft.competency_text}
          />
          <TextArea
            label="Overview"
            onChange={(value) => updateDraft('overview', value)}
            rows={5}
            value={draft.overview}
          />
          <TextArea
            label="Essential Question"
            onChange={(value) => updateDraft('essential_question', value)}
            rows={4}
            value={draft.essential_question}
          />
          <TextArea
            label="Enduring Understanding"
            onChange={(value) => updateDraft('enduring_understanding', value)}
            rows={5}
            value={draft.enduring_understanding}
          />
          <TextArea
            label="Topic Performance Task"
            onChange={(value) => updateDraft('performance_task', value)}
            rows={6}
            value={draft.performance_task}
          />
          <TextArea
            label="Success Criteria"
            onChange={(value) => updateDraft('success_criteria', value)}
            rows={6}
            value={draft.success_criteria}
          />
          <TextArea
            label="Values Focus"
            onChange={(value) => updateDraft('values_focus', value)}
            rows={4}
            value={draft.values_focus}
          />
        </div>

        <section className="lesson-editor__meta lesson-editor__meta--compact">
          <label className="admin-check">
            <input
              checked={draft.is_published}
              onChange={(event) => updateDraft('is_published', event.target.checked)}
              type="checkbox"
            />
            <span>Published</span>
          </label>
        </section>

        {message ? <p className="admin-message">{message}</p> : null}

        <div className="lesson-editor__actions">
          {editingTopic ? (
            <button className="button button--secondary button--danger" disabled={deleting || saving} onClick={() => void deleteTopic()} type="button">
              <Icon name="trash" />
              <span>{deleting ? 'Deleting...' : 'Delete topic'}</span>
            </button>
          ) : null}
          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : 'Save topic'}</span>
          </button>
        </div>
      </form>
    </Page>
  )
}

function TextArea({
  label,
  onChange,
  rows,
  value,
}: {
  label: string
  onChange: (value: string) => void
  rows: number
  value: string
}) {
  return (
    <label className="admin-field admin-field--wide">
      <span>{label}</span>
      <textarea
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  )
}

function createTopicDraft(moduleId: string, topic?: ModuleTopic): TopicDraft {
  return {
    competency_code: topic?.competency_code ?? '',
    competency_text: topic?.competency_text ?? '',
    is_published: topic?.is_published ?? false,
    module: topic?.module ? String(topic.module) : moduleId,
    order: topic?.order ? String(topic.order) : '0',
    overview: topic?.overview ?? '',
    title: topic?.title ?? '',
    unit: topic?.unit ?? '',
    essential_question: topic?.essential_question ?? '',
    enduring_understanding: topic?.enduring_understanding ?? '',
    performance_task: topic?.performance_task ?? '',
    success_criteria: topic?.success_criteria ?? '',
    values_focus: topic?.values_focus ?? '',
  }
}

function buildTopicPayload(draft: TopicDraft) {
  return {
    ...draft,
    module: Number(draft.module),
    order: Number(draft.order || 0),
  }
}
