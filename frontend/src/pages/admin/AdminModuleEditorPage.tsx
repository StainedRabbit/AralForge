import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading } from '../../components/ui'
import type { Module } from '../../types'
import { resolveMediaUrl, toErrorMessage } from '../../utils/format'
import { subjectName } from '../../utils/modules'

type ModuleDraft = {
  content: string
  description: string
  detailed_discussion: string
  examples: string
  is_paid: boolean
  is_published: boolean
  learning_objectives: string
  lesson_overview: string
  pdf_file: File | null
  price: string
  resources: string
  slug: string
  student_activities: string
  subjects: string[]
  teacher_notes: string
  title: string
}

export function AdminModuleEditorPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { moduleId } = useParams()
  const [searchParams] = useSearchParams()
  const editingModule = data.modules.find((module) => module.id === Number(moduleId))
  const selectedSubjectId = searchParams.get('subject')
  const isEditing = Boolean(moduleId)
  const [draft, setDraft] = useState<ModuleDraft>(() =>
    createModuleDraft(editingModule, selectedSubjectId),
  )
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const subjectOptions = useMemo(
    () => data.subjects.map((subject) => ({
      label: `${subject.code} - ${subject.name}`,
      value: String(subject.id),
    })),
    [data.subjects],
  )

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
          body: payload instanceof FormData ? payload : JSON.stringify(payload),
          method: isEditing ? 'PATCH' : 'POST',
        },
      )
      await refresh()
      const subject = draft.subjects[0] ?? selectedSubjectId ?? ''
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
    setDraft((current) => ({
      ...current,
      [field]: value,
      slug:
        field === 'title' && (!current.slug || current.slug === slugify(current.title))
          ? slugify(String(value))
          : current.slug,
    }))
  }

  const primarySubject = draft.subjects[0] ? Number(draft.subjects[0]) : null

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
          subtitle="Structure the topic like teaching material."
          title="Lesson Details"
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
            <span>Subjects</span>
            <select
              multiple
              onChange={(event) =>
                updateDraft(
                  'subjects',
                  Array.from(event.target.selectedOptions).map((option) => option.value),
                )
              }
              value={draft.subjects}
            >
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
            label="Detailed discussion"
            onChange={(value) => updateDraft('detailed_discussion', value)}
            rows={9}
            value={draft.detailed_discussion}
          />
          <TextArea
            label="Examples"
            onChange={(value) => updateDraft('examples', value)}
            rows={7}
            value={draft.examples}
          />
          <TextArea
            label="Teacher notes / guide"
            onChange={(value) => updateDraft('teacher_notes', value)}
            rows={5}
            value={draft.teacher_notes}
          />
          <TextArea
            label="Student activities"
            onChange={(value) => updateDraft('student_activities', value)}
            rows={5}
            value={draft.student_activities}
          />
          <TextArea
            label="Resources / references"
            onChange={(value) => updateDraft('resources', value)}
            rows={5}
            value={draft.resources}
          />
          <TextArea
            label="Legacy content"
            onChange={(value) => updateDraft('content', value)}
            rows={4}
            value={draft.content}
          />
        </div>

        <section className="lesson-editor__meta">
          <label className="admin-check">
            <input
              checked={draft.is_paid}
              onChange={(event) => updateDraft('is_paid', event.target.checked)}
              type="checkbox"
            />
            <span>Paid module</span>
          </label>

          <label className="admin-field">
            <span>Price</span>
            <input
              onChange={(event) => updateDraft('price', event.target.value)}
              type="number"
              value={draft.price}
            />
          </label>

          <label className="admin-check">
            <input
              checked={draft.is_published}
              onChange={(event) => updateDraft('is_published', event.target.checked)}
              type="checkbox"
            />
            <span>Published</span>
          </label>

          <label className="admin-field">
            <span>Printable PDF</span>
            <input
              onChange={(event) => updateDraft('pdf_file', event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          {editingModule?.pdf_file ? (
            <a
              className="button button--secondary"
              href={resolveMediaUrl(editingModule.pdf_file)}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="file" />
              <span>Open current PDF</span>
            </a>
          ) : null}
        </section>

        {message ? <p className="admin-message">{message}</p> : null}

        <div className="lesson-editor__actions">
          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : 'Save lesson'}</span>
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
    content: module?.content ?? '',
    description: module?.description ?? '',
    detailed_discussion: module?.detailed_discussion ?? '',
    examples: module?.examples ?? '',
    is_paid: module?.is_paid ?? true,
    is_published: module?.is_published ?? false,
    learning_objectives: module?.learning_objectives ?? '',
    lesson_overview: module?.lesson_overview ?? '',
    pdf_file: null,
    price: module?.price ?? '0.00',
    resources: module?.resources ?? '',
    slug: module?.slug ?? '',
    student_activities: module?.student_activities ?? '',
    subjects: module?.subjects.map(String) ?? (selectedSubjectId ? [selectedSubjectId] : []),
    teacher_notes: module?.teacher_notes ?? '',
    title: module?.title ?? '',
  }
}

function buildModulePayload(draft: ModuleDraft) {
  if (draft.pdf_file) {
    const formData = new FormData()

    Object.entries(draft).forEach(([key, value]) => {
      if (key === 'pdf_file') {
        if (value instanceof File) {
          formData.append(key, value)
        }
        return
      }

      if (key === 'subjects' && Array.isArray(value)) {
        value.forEach((subject) => formData.append('subjects', subject))
        return
      }

      formData.append(key, String(value))
    })

    return formData
  }

  return {
    ...draft,
    pdf_file: undefined,
    subjects: draft.subjects.map(Number),
    price: draft.price || '0.00',
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
