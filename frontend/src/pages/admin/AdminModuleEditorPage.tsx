import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading, SkeletonList } from '../../components/ui'
import { queryKeys } from '../../queries/queryKeys'
import type { Module } from '../../types'
import { toErrorMessage } from '../../utils/format'
import { subjectName } from '../../utils/modules'

type ModuleDraft = {
  description: string
  is_published: boolean
  learning_objectives: string
  lesson_overview: string
  resources: string
  slug: string
  subject: string
  subjects: string[]
  title: string
}

export function AdminModuleEditorPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { moduleId } = useParams()
  const [searchParams] = useSearchParams()
  const numericModuleId = Number(moduleId)
  const moduleQuery = useQuery({
    queryKey: queryKeys.resource(`/modules/modules/${numericModuleId}/`),
    queryFn: ({ signal }) => api<Module>(`/modules/modules/${numericModuleId}/`, { signal }),
    enabled: Boolean(moduleId && numericModuleId),
    staleTime: 60_000,
  })
  const editingModule = moduleQuery.data
    ?? data.modules.find((module) => module.id === numericModuleId)
  const selectedSubjectId = searchParams.get('subject')
  const isEditing = Boolean(moduleId)
  const [draftOverride, setDraftOverride] = useState<ModuleDraft | null>(null)
  const draft = draftOverride ?? createModuleDraft(editingModule, selectedSubjectId)
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const subjectOptions = useMemo(
    () => data.subjects.map((subject) => ({
      label: `${subject.code} - ${subject.name}`,
      value: String(subject.id),
    })),
    [data.subjects],
  )

  if (isEditing && moduleQuery.isPending) {
    return <Page><SkeletonList count={4} /></Page>
  }

  if (isEditing && !editingModule) {
    return (
      <Page>
        <EmptyState
          icon="warning"
          title="Module not found"
          message="This lesson may have been deleted or is not available."
        />
      </Page>
    )
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const payload = buildModulePayload(draft)
      const saved = await api<Module>(
        isEditing ? `/modules/modules/${editingModule?.id}/` : '/modules/modules/',
        {
          body: JSON.stringify(payload),
          method: isEditing ? 'PATCH' : 'POST',
        },
      )
      await refresh()
      const subject = draft.subject || selectedSubjectId || ''
      const params = new URLSearchParams()
      if (subject) {
        params.set('subject', subject)
      }
      params.set('module', String(saved.id))
      navigate(`/admin/modules?${params.toString()}`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  function updateDraft<TField extends keyof ModuleDraft>(
    field: TField,
    value: ModuleDraft[TField],
  ) {
    setDraftOverride((current) => {
      const base = current ?? createModuleDraft(editingModule, selectedSubjectId)
      return ({
      ...base,
      [field]: value,
      slug:
        field === 'title' && (!base.slug || base.slug === slugify(base.title))
          ? slugify(String(value))
          : base.slug,
      })
    })
  }

  async function deleteModule() {
    if (!editingModule) {
      return
    }

    const confirmed = window.confirm(
      `Delete "${editingModule.title}"? This will also delete its topics, lessons, activities, access, and progress records.`,
    )
    if (!confirmed) {
      return
    }

    setDeleting(true)
    setMessage('')
    try {
      await api(`/modules/modules/${editingModule.id}/`, { method: 'DELETE' })
      await refresh()
      const subject = draft.subject || selectedSubjectId || ''
      navigate(`/admin/modules${subject ? `?subject=${subject}` : ''}`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setDeleting(false)
    }
  }

  const primarySubject = draft.subject ? Number(draft.subject) : null

  return (
    <Page>
      <PageHeader
        eyebrow="Lesson authoring"
        title={isEditing ? 'Edit Module' : 'Create Module'}
        description={subjectName(data, primarySubject)}
        actions={
          <Link className="button button--secondary" to={`/admin/modules${primarySubject ? `?subject=${primarySubject}` : ''}`}>
            <Icon name="module" />
            <span>Back to Modules</span>
          </Link>
        }
      />

      <form className="lesson-editor section-block" onSubmit={submitForm}>
        <SectionHeading
          subtitle="Define the complete subject-level learning package."
          title="Module Details"
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
            <span>Slug</span>
            <input
              onChange={(event) => updateDraft('slug', event.target.value)}
              required
              type="text"
              value={draft.slug}
            />
          </label>

          <label className="admin-field admin-field--wide">
            <span>Subject</span>
            <select
              onChange={(event) => {
                updateDraft('subject', event.target.value)
                updateDraft('subjects', event.target.value ? [event.target.value] : [])
              }}
              required
              value={draft.subject}
            >
              <option value="">Select subject</option>
              {subjectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <TextArea
            label="Description"
            onChange={(value) => updateDraft('description', value)}
            rows={3}
            value={draft.description}
          />
          <TextArea
            label="Learning objectives"
            onChange={(value) => updateDraft('learning_objectives', value)}
            rows={5}
            value={draft.learning_objectives}
          />
          <TextArea
            label="Lesson overview"
            onChange={(value) => updateDraft('lesson_overview', value)}
            rows={5}
            value={draft.lesson_overview}
          />
          <TextArea
            label="Resources / references"
            onChange={(value) => updateDraft('resources', value)}
            rows={5}
            value={draft.resources}
          />
        </div>

        <section className="lesson-editor__meta">
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
          {editingModule ? (
            <button className="button button--secondary button--danger" disabled={deleting || saving} onClick={() => void deleteModule()} type="button">
              <Icon name="trash" />
              <span>{deleting ? 'Deleting...' : 'Delete module'}</span>
            </button>
          ) : null}
          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : 'Save module'}</span>
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

function createModuleDraft(module?: Module, selectedSubjectId?: string | null): ModuleDraft {
  return {
    description: module?.description ?? '',
    is_published: module?.is_published ?? false,
    learning_objectives: module?.learning_objectives ?? '',
    lesson_overview: module?.lesson_overview ?? '',
    resources: module?.resources ?? '',
    slug: module?.slug ?? '',
    subject: module?.subject ? String(module.subject) : selectedSubjectId ?? '',
    subjects: module?.subjects.map(String) ?? (selectedSubjectId ? [selectedSubjectId] : []),
    title: module?.title ?? '',
  }
}

function buildModulePayload(draft: ModuleDraft) {
  return {
    ...draft,
    subject: draft.subject ? Number(draft.subject) : null,
    subjects: draft.subjects.map(Number),
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
