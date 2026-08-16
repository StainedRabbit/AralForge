import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading } from '../../components/ui'
import type { Module } from '../../types'
import { formatDateTime, toErrorMessage } from '../../utils/format'
import { subjectName } from '../../utils/modules'

type ModuleDraft = {
  description: string
  is_paid: boolean
  is_published: boolean
  learning_objectives: string
  lesson_overview: string
  pdf_file: File | null
  price: string
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
  const editingModule = data.modules.find((module) => module.id === Number(moduleId))
  const selectedSubjectId = searchParams.get('subject')
  const isEditing = Boolean(moduleId)
  const [draft, setDraft] = useState<ModuleDraft>(() =>
    createModuleDraft(editingModule, selectedSubjectId),
  )
  const [message, setMessage] = useState('')
  const [pdfMessage, setPdfMessage] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
    setDraft((current) => ({
      ...current,
      [field]: value,
      slug:
        field === 'title' && (!current.slug || current.slug === slugify(current.title))
          ? slugify(String(value))
          : current.slug,
    }))
  }

  async function regeneratePdf() {
    if (!editingModule) {
      return
    }

    setPdfBusy(true)
    setPdfMessage('')
    try {
      await api<Module>(`/modules/modules/${editingModule.id}/regenerate_pdf/`, {
        method: 'POST',
      })
      await refresh()
      setPdfMessage('Printable PDF generated.')
    } catch (caughtError) {
      setPdfMessage(toErrorMessage(caughtError))
    } finally {
      setPdfBusy(false)
    }
  }

  async function downloadPdf() {
    if (!editingModule) {
      return
    }

    setPdfBusy(true)
    setPdfMessage('')
    try {
      const blob = await api<Blob>(`/modules/modules/${editingModule.id}/download-pdf/`)
      downloadBlob(blob, `${editingModule.slug || 'module'}.pdf`)
    } catch (caughtError) {
      setPdfMessage(toErrorMessage(caughtError))
    } finally {
      setPdfBusy(false)
    }
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

          {editingModule ? (
            <div className="pdf-status-card">
              <span className={`pdf-status-card__pill pdf-status-card__pill--${pdfStatusKind(editingModule)}`}>
                {pdfStatusLabel(editingModule)}
              </span>
              {editingModule.pdf_generated_at ? (
                <small>Generated {formatDateTime(editingModule.pdf_generated_at)}</small>
              ) : (
                <small>No generated printable PDF yet.</small>
              )}
              <div className="pdf-status-card__actions">
                <button className="button button--secondary button--compact" disabled={pdfBusy} onClick={() => void regeneratePdf()} type="button">
                  <Icon name="save" />
                  <span>{editingModule.has_pdf ? 'Regenerate PDF' : 'Generate PDF'}</span>
                </button>
                {editingModule.has_pdf ? (
                  <button className="button button--secondary button--compact" disabled={pdfBusy} onClick={() => void downloadPdf()} type="button">
                    <Icon name="file" />
                    <span>Download PDF</span>
                  </button>
                ) : null}
              </div>
              {pdfMessage ? <small>{pdfMessage}</small> : null}
            </div>
          ) : null}
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function pdfStatusLabel(item: { has_pdf?: boolean; pdf_generated_at?: string | null; pdf_is_outdated?: boolean }) {
  if (!item.has_pdf && !item.pdf_generated_at) {
    return 'Not generated'
  }
  return item.pdf_is_outdated ? 'Outdated' : 'Updated'
}

function pdfStatusKind(item: { has_pdf?: boolean; pdf_generated_at?: string | null; pdf_is_outdated?: boolean }) {
  if (!item.has_pdf && !item.pdf_generated_at) {
    return 'missing'
  }
  return item.pdf_is_outdated ? 'outdated' : 'updated'
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
    is_paid: module?.is_paid ?? true,
    is_published: module?.is_published ?? false,
    learning_objectives: module?.learning_objectives ?? '',
    lesson_overview: module?.lesson_overview ?? '',
    pdf_file: null,
    price: module?.price ?? '0.00',
    resources: module?.resources ?? '',
    slug: module?.slug ?? '',
    subject: module?.subject ? String(module.subject) : selectedSubjectId ?? '',
    subjects: module?.subjects.map(String) ?? (selectedSubjectId ? [selectedSubjectId] : []),
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

      formData.append(key, key === 'is_paid' ? 'true' : String(value))
    })

    return formData
  }

  return {
    ...draft,
    is_paid: true,
    pdf_file: undefined,
    subject: draft.subject ? Number(draft.subject) : null,
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
