import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AuthedRequest, RouteData } from '../../app/types'
import { Icon } from '../../components/Icon'
import { MainActivityEditor } from '../../components/admin/MainActivityEditor'
import { MarkdownEditor } from '../../components/MarkdownEditor'
import { EmptyState, Page, PageHeader, SectionHeading, SkeletonList, StatusBanner } from '../../components/ui'
import { usePaginatedResource } from '../../queries/useScopedWorkspace'
import { queryKeys } from '../../queries/queryKeys'
import type {
  MainActivityEditorWorkspace,
  Module,
  ModuleLesson,
  ModuleLessonAsset,
  ModuleLessonExample,
  ModuleTopic,
} from '../../types'
import { formatDateTime, toErrorMessage } from '../../utils/format'
import { cleanImportedName } from '../../utils/importCleaning'
import {
  lessonDraftKey,
  readLessonDraft,
  removeLessonDraft,
  writeLessonDraft,
} from '../../utils/lessonDrafts'
import { subjectName } from '../../utils/modules'

type LessonDraft = {
  before_you_start: string
  challenge_task: string
  is_published: boolean
  learning_targets: string
  lets_practice: string
  order: string
  pdf_file: File | null
  resources: string
  short_discussion: string
  title: string
  topic: string
}

type LessonExampleDraft = {
  id: string
  serverId?: number
  order: string
  title: string
  alt_text: string
  body: string
  common_mistake: string
  is_published: boolean
  existingImage: string
  image: File | null
  deleted?: boolean
}

type SerializableLessonDraft = Omit<LessonDraft, 'pdf_file'>
type SaveState = 'clean' | 'local' | 'saved' | 'saving' | 'unsaved'
type LessonImportMode = 'empty' | 'replace'
type LessonTemplateFieldKey =
  | 'learning_targets'
  | 'before_you_start'
  | 'short_discussion'
  | 'lets_practice'
  | 'challenge_task'

export function AdminLessonEditorPage({
  api,
  data,
}: {
  api: AuthedRequest
  data: RouteData
  refresh: () => Promise<void>
}) {
  const { lessonId, moduleId, topicId } = useParams()
  const queryClient = useQueryClient()
  const numericModuleId = Number(moduleId)
  const numericTopicId = Number(topicId)
  const numericLessonId = Number(lessonId)
  const moduleQuery = useQuery({
    queryKey: queryKeys.resource(`/modules/modules/${numericModuleId}/`),
    queryFn: ({ signal }) => api<Module>(`/modules/modules/${numericModuleId}/`, { signal }),
    enabled: Boolean(numericModuleId),
    staleTime: 60_000,
  })
  const topicQuery = useQuery({
    queryKey: queryKeys.resource(`/modules/topics/${numericTopicId}/`),
    queryFn: ({ signal }) => api<ModuleTopic>(`/modules/topics/${numericTopicId}/`, { signal }),
    enabled: Boolean(numericTopicId),
    staleTime: 60_000,
  })
  const lessonQuery = useQuery({
    queryKey: queryKeys.resource(`/modules/lessons/${numericLessonId}/`),
    queryFn: ({ signal }) => api<ModuleLesson>(`/modules/lessons/${numericLessonId}/`, { signal }),
    enabled: Boolean(numericLessonId),
    staleTime: 60_000,
  })
  const examplesQuery = usePaginatedResource<ModuleLessonExample>(
    api,
    numericLessonId
      ? `/modules/lesson-examples/?lesson=${numericLessonId}`
      : null,
  )
  const mainActivityWorkspacePath = numericLessonId
    ? `/modules/lessons/${numericLessonId}/main-activity-workspace/`
    : null
  const mainActivityWorkspaceQuery = useQuery({
    queryKey: queryKeys.resource(mainActivityWorkspacePath ?? 'main-activity-workspace-disabled'),
    queryFn: () => api<MainActivityEditorWorkspace>(mainActivityWorkspacePath!),
    enabled: Boolean(mainActivityWorkspacePath),
    staleTime: 60_000,
  })
  const isEditing = Boolean(lessonId)
  const isPending = moduleQuery.isPending || topicQuery.isPending ||
    (isEditing && (
      lessonQuery.isPending || examplesQuery.isPending || mainActivityWorkspaceQuery.isPending
    ))
  const queryError = moduleQuery.error || topicQuery.error ||
    (isEditing
      ? lessonQuery.error || examplesQuery.error || mainActivityWorkspaceQuery.error
      : null)

  if (isPending) {
    return <Page><section aria-label="Loading lesson editor"><SkeletonList count={5} /></section></Page>
  }

  if (queryError) {
    return (
      <Page>
        <StatusBanner
          message={toErrorMessage(queryError)}
          title="Lesson editor could not load"
          tone="warning"
        />
      </Page>
    )
  }

  const scopedData = {
    ...data,
    lessonExamples: examplesQuery.data ?? [],
    moduleLessons: lessonQuery.data ? [lessonQuery.data] : [],
    moduleTopics: topicQuery.data ? [topicQuery.data] : [],
    modules: moduleQuery.data ? [moduleQuery.data] : [],
    activities: mainActivityWorkspaceQuery.data?.activity
      ? [mainActivityWorkspaceQuery.data.activity]
      : [],
    activityQuestions: mainActivityWorkspaceQuery.data?.questions ?? [],
    activityChoices: mainActivityWorkspaceQuery.data?.choices ?? [],
    activityMatchingPairs: mainActivityWorkspaceQuery.data?.matching_pairs ?? [],
  }

  const refreshScopedData = async () => {
    await Promise.all([
      moduleQuery.refetch(),
      topicQuery.refetch(),
      ...(isEditing
        ? [lessonQuery.refetch(), examplesQuery.refetch(), mainActivityWorkspaceQuery.refetch()]
        : []),
    ])
  }

  return (
    <AdminLessonEditorForm
      api={api}
      data={scopedData}
      mainActivityLinkedClassCount={mainActivityWorkspaceQuery.data?.linked_class_count ?? 0}
      onMainActivityWorkspaceSaved={(workspace) => {
        if (mainActivityWorkspacePath) {
          queryClient.setQueryData(
            queryKeys.resource(mainActivityWorkspacePath),
            workspace,
          )
        }
      }}
      refresh={refreshScopedData}
    />
  )
}

function AdminLessonEditorForm({
  api,
  data,
  mainActivityLinkedClassCount,
  onMainActivityWorkspaceSaved,
  refresh,
}: {
  api: AuthedRequest
  data: RouteData
  mainActivityLinkedClassCount: number
  onMainActivityWorkspaceSaved: (workspace: MainActivityEditorWorkspace) => void
  refresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { lessonId, moduleId, topicId } = useParams()
  const module = data.modules.find((item) => item.id === Number(moduleId))
  const topic = data.moduleTopics.find((item) => item.id === Number(topicId))
  const editingLesson = data.moduleLessons.find((lesson) => lesson.id === Number(lessonId))
  const isEditing = Boolean(lessonId)
  const initialDraft = useMemo(
    () => createLessonDraft(topicId ?? '', editingLesson),
    [editingLesson, topicId],
  )
  const initialExamples = useMemo(
    () => createExampleDrafts(data.lessonExamples, editingLesson?.id),
    [data.lessonExamples, editingLesson?.id],
  )
  const [baselineDraft] = useState(() => toSerializableLessonDraft(initialDraft))
  const [baselineExamples] = useState(() => serializeExampleDrafts(initialExamples))
  const storageKey = useMemo(
    () => lessonDraftKey({
      lessonId: editingLesson?.id,
      topicId: Number(topicId),
    }),
    [editingLesson?.id, topicId],
  )
  const storedDraft = useMemo(
    () => readLessonDraft<SerializableLessonDraft>(storageKey),
    [storageKey],
  )
  const [draft, setDraft] = useState<LessonDraft>(initialDraft)
  const [exampleDrafts, setExampleDrafts] = useState<LessonExampleDraft[]>(initialExamples)
  const [recoveryDraft, setRecoveryDraft] = useState(() =>
    storedDraft && !draftsMatch(storedDraft.value, baselineDraft)
      ? storedDraft
      : null,
  )
  const [hasInteracted, setHasInteracted] = useState(false)
  const [message, setMessage] = useState('')
  const [pdfMessage, setPdfMessage] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [modalField, setModalField] = useState<LessonTemplateFieldKey | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const serializableDraft = useMemo(
    () => toSerializableLessonDraft(draft),
    [draft],
  )
  const examplesDirty = serializeExampleDrafts(exampleDrafts) !== baselineExamples || exampleDrafts.some((example) => example.image)
  const isTextDirty = !draftsMatch(serializableDraft, baselineDraft)
  const hasUnsavedChanges = isTextDirty || examplesDirty || Boolean(draft.pdf_file)

  useEffect(() => {
    if (!hasInteracted) {
      return
    }

    if (!isTextDirty) {
      const timeout = window.setTimeout(() => {
        removeLessonDraft(storageKey)
        setSaveState(draft.pdf_file ? 'unsaved' : 'clean')
      })
      return () => window.clearTimeout(timeout)
    }

    const timeout = window.setTimeout(() => {
      const stored = writeLessonDraft(storageKey, serializableDraft)
      setSaveState(stored && !draft.pdf_file ? 'local' : 'unsaved')
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [draft.pdf_file, hasInteracted, isTextDirty, serializableDraft, storageKey])

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }
 
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    function closeFocusedModal(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setModalField(null)
      }
    }

    window.addEventListener('keydown', closeFocusedModal)
    return () => window.removeEventListener('keydown', closeFocusedModal)
  }, [])

  if (!module || !topic || (isEditing && !editingLesson)) {
    return (
      <Page>
        <EmptyState
          icon="warning"
          title={!module ? 'Module not found' : !topic ? 'Topic not found' : 'Lesson not found'}
          message="This lesson may have been deleted or is not available."
        />
      </Page>
    )
  }

  const backUrl = `/admin/modules?subject=${module.subject}&topic=${topic.id}`
  const modalLessonField = modalField
    ? studentLessonFields.find((field) => field.key === modalField) ?? null
    : null

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaveState('saving')
    setMessage('')

    try {
      const payload = buildLessonPayload(draft)
      const saved = await api<ModuleLesson>(
        isEditing ? `/modules/lessons/${editingLesson?.id}/` : '/modules/lessons/',
        {
          body: payload,
          method: isEditing ? 'PATCH' : 'POST',
        },
      )
      await syncLessonExamples(api, saved.id, exampleDrafts, initialExamples)
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.resource(`/modules/lessons/?topic=${saved.topic}`),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.resource(`/modules/lesson-examples/?lesson=${saved.id}`),
        }),
      ])
      removeLessonDraft(storageKey)
      setSaveState('saved')
      const params = new URLSearchParams()
      params.set('subject', String(module?.subject))
      params.set('topic', String(saved.topic || topic?.id))
      params.set('lesson', String(saved.id))
      navigate(`/admin/modules?${params.toString()}`)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
      setSaveState('unsaved')
    } finally {
      setSaving(false)
    }
  }

  function updateDraft<TField extends keyof LessonDraft>(
    field: TField,
    value: LessonDraft[TField],
  ) {
    if (recoveryDraft) {
      removeLessonDraft(storageKey)
      setRecoveryDraft(null)
    }
    setHasInteracted(true)
    setSaveState('unsaved')
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function addExample() {
    setHasInteracted(true)
    setSaveState('unsaved')
    setExampleDrafts((current) => [
      ...current,
      createEmptyExampleDraft(current.length + 1),
    ])
  }

  function updateExample<TField extends keyof LessonExampleDraft>(
    id: string,
    field: TField,
    value: LessonExampleDraft[TField],
  ) {
    setHasInteracted(true)
    setSaveState('unsaved')
    setExampleDrafts((current) =>
      current.map((example) =>
        example.id === id ? { ...example, [field]: value } : example,
      ),
    )
  }

  function removeExample(id: string) {
    setHasInteracted(true)
    setSaveState('unsaved')
    setExampleDrafts((current) =>
      current
        .map((example) =>
          example.id === id
            ? example.serverId
              ? { ...example, deleted: true }
              : null
            : example,
        )
        .filter((example): example is LessonExampleDraft => Boolean(example)),
    )
  }


  function restoreDraft() {
    if (!recoveryDraft) {
      return
    }

    setDraft({ ...recoveryDraft.value, pdf_file: null })
    setRecoveryDraft(null)
    setHasInteracted(true)
    setSaveState('local')
  }

  function discardRecoveryDraft() {
    removeLessonDraft(storageKey)
    setRecoveryDraft(null)
  }

  function confirmLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (hasUnsavedChanges && !window.confirm('Leave without saving this lesson?')) {
      event.preventDefault()
    }
  }

  function openLessonFieldModal(field: LessonTemplateFieldKey) {
    setModalField(field)
  }

  function closeLessonFieldModal() {
    setModalField(null)
  }

  async function applyLessonImport(
    parsed: ParsedLessonImport,
    files: File[],
    mode: LessonImportMode,
  ) {
    const imageResult = await resolveImportedLessonImages(api, editingLesson, parsed, files)
    const rewrittenSections = rewriteLessonImportImageUrls(parsed.sections, imageResult.assetUrls)
    const rewrittenResources = rewriteMarkdownImageUrls(parsed.resources, imageResult.assetUrls)
    const shouldApplyValue = (current: string, incoming?: string) =>
      Boolean(incoming?.trim()) && (mode === 'replace' || !current.trim())

    setDraft((current) => {
      const next = { ...current }
      if (shouldApplyValue(current.title, parsed.title)) {
        next.title = parsed.title
      }
      if (shouldApplyValue(current.order, parsed.order)) {
        next.order = parsed.order
      }
      if (parsed.is_published !== null && mode === 'replace') {
        next.is_published = parsed.is_published
      }
      studentLessonFields.forEach((field) => {
        const value = rewrittenSections[field.key]
        if (shouldApplyValue(current[field.key], value)) {
          next[field.key] = value ?? ''
        }
      })
      if (shouldApplyValue(current.resources, rewrittenResources)) {
        next.resources = rewrittenResources
      }
      return next
    })
    const exampleImport = mergeImportedLessonExamples(exampleDrafts, parsed.examples, files, mode)
    if (parsed.examples.length) {
      setExampleDrafts(exampleImport.examples)
    }
    if (recoveryDraft) {
      removeLessonDraft(storageKey)
      setRecoveryDraft(null)
    }
    setHasInteracted(true)
    setSaveState('unsaved')
    return [...imageResult.messages, ...exampleImport.messages]
  }

  async function regeneratePdf() {
    if (!editingLesson || hasUnsavedChanges) {
      return
    }

    setPdfBusy(true)
    setPdfMessage('')
    try {
      await api<ModuleLesson>(`/modules/lessons/${editingLesson.id}/regenerate_pdf/`, {
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
    if (!editingLesson) {
      return
    }

    setPdfBusy(true)
    setPdfMessage('')
    try {
      const blob = await api<Blob>(`/modules/lessons/${editingLesson.id}/download_pdf/`)
      downloadBlob(blob, `${slugify(editingLesson.title) || 'lesson'}.pdf`)
    } catch (caughtError) {
      setPdfMessage(toErrorMessage(caughtError))
    } finally {
      setPdfBusy(false)
    }
  }

  async function deleteLesson() {
    if (!editingLesson) {
      return
    }

    const confirmed = window.confirm(
      `Delete "${editingLesson.title}"? This will also delete its examples, assets, main activity, and progress records.`,
    )
    if (!confirmed) {
      return
    }

    setDeleting(true)
    setMessage('')
    try {
      await api(`/modules/lessons/${editingLesson.id}/`, { method: 'DELETE' })
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.resource(`/modules/lessons/?topic=${editingLesson.topic}`),
        }),
      ])
      removeLessonDraft(storageKey)
      navigate(backUrl)
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Lesson authoring"
        title={isEditing ? 'Edit Lesson' : 'Create Lesson'}
        description={`${subjectName(data, module.subject)} / ${topic.title}`}
        actions={
          <div className="lesson-editor__actions">
            <button className="button button--secondary" onClick={() => setShowImportModal(true)} type="button">
              <Icon name="upload" />
              <span>Import Lesson MD</span>
            </button>
            <Link className="button button--secondary" onClick={confirmLeave} to={backUrl}>
              <Icon name="module" />
              <span>Back to Modules</span>
            </Link>
          </div>
        }
      />

      <form className="lesson-editor section-block" onSubmit={submitForm}>
        {recoveryDraft ? (
          <div className="lesson-recovery-banner" role="status">
            <Icon name="warning" />
            <div>
              <strong>Recover an unfinished lesson draft?</strong>
              <span>
                A local copy from {formatDraftTime(recoveryDraft.savedAt)} is available.
                Uploaded PDF and example image files are not stored in recovery drafts.
              </span>
            </div>
            <div className="lesson-recovery-banner__actions">
              <button className="button button--primary button--compact" onClick={restoreDraft} type="button">
                Restore Draft
              </button>
              <button className="button button--secondary button--compact" onClick={discardRecoveryDraft} type="button">
                Discard
              </button>
            </div>
          </div>
        ) : null}
        <div className="lesson-editor-workspace">
          <div className="lesson-editor-workspace__main">
            <LessonEditorMobileOutline draft={draft} />

            <section className="lesson-editor-section" id="lesson-editor-details">
              <SectionHeading
                subtitle={topic.title}
                title="Lesson Details"
              />

              <div className="lesson-editor__meta lesson-editor__meta--compact">
                <label className="admin-field">
                  <span>Lesson Title</span>
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
                <label className="admin-check">
                  <input
                    checked={draft.is_published}
                    onChange={(event) => updateDraft('is_published', event.target.checked)}
                    type="checkbox"
                  />
                  <span>Published</span>
                </label>
              </div>
            </section>

            <section className="lesson-editor-section" id="lesson-editor-template">
              <SectionHeading
                subtitle="Student-facing classroom flow"
                title="Lesson Template"
              />
              <div className="lesson-editor__grid lesson-editor__grid--single">
                {studentLessonFields.map((field) => (
                  <section className="lesson-template-field" id={lessonEditorFieldId(field.key)} key={field.key}>
                    <TextArea
                      label={field.label}
                      onChange={(value) => updateDraft(field.key, value)}
                      onEnterFocus={() => openLessonFieldModal(field.key)}
                      rows={field.rows}
                      value={draft[field.key]}
                    />
                  </section>
                ))}
              </div>
            </section>

            <section className="lesson-editor-section" id="lesson-editor-examples">
              <SectionHeading
                subtitle="Upload image or SVG examples for the Let's Look at Examples section"
                title="Lesson Examples"
              />
              <div className="lesson-example-editor-list">
                {exampleDrafts.filter((example) => !example.deleted).map((example, index) => (
                  <div className="lesson-example-editor" key={example.id}>
                    <div className="lesson-example-editor__header">
                      <strong>Example {index + 1}</strong>
                      <button className="button button--secondary button--compact" onClick={() => removeExample(example.id)} type="button">
                        Remove
                      </button>
                    </div>
                    <div className="lesson-editor__grid">
                      <label className="admin-field">
                        <span>Order</span>
                        <input onChange={(event) => updateExample(example.id, 'order', event.target.value)} type="number" value={example.order} />
                      </label>
                      <label className="admin-field">
                        <span>Title</span>
                        <input onChange={(event) => updateExample(example.id, 'title', event.target.value)} type="text" value={example.title} />
                      </label>
                      <label className="admin-field">
                        <span>Alt text</span>
                        <input onChange={(event) => updateExample(example.id, 'alt_text', event.target.value)} type="text" value={example.alt_text} />
                      </label>
                      <label className="admin-check">
                        <input checked={example.is_published} onChange={(event) => updateExample(example.id, 'is_published', event.target.checked)} type="checkbox" />
                        <span>Published</span>
                      </label>
                      <label className="admin-field">
                        <span>Image or SVG</span>
                        <input accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(event) => updateExample(example.id, 'image', event.target.files?.[0] ?? null)} type="file" />
                        {example.existingImage ? <small>Current image is saved. Upload a new file to replace it.</small> : null}
                      </label>
                      <TextArea label="Example text" onChange={(value) => updateExample(example.id, 'body', value)} rows={5} value={example.body} />
                      <TextArea label="Common mistake" onChange={(value) => updateExample(example.id, 'common_mistake', value)} rows={4} value={example.common_mistake} />
                    </div>
                  </div>
                ))}
                {!exampleDrafts.filter((example) => !example.deleted).length ? (
                  <p className="admin-empty-line">No lesson examples yet.</p>
                ) : null}
                <button className="button button--secondary" onClick={addExample} type="button">
                  <Icon name="upload" />
                  <span>Add Example</span>
                </button>
              </div>
            </section>

            <section className="lesson-editor-section" id="lesson-editor-resources">
              <SectionHeading
                subtitle="References and files"
                title="Resources"
              />
              <div className="lesson-editor__grid">
                <TextArea
                  label="Resources"
                  onChange={(value) => updateDraft('resources', value)}
                  rows={5}
                  value={draft.resources}
                />
                <label className="admin-field">
                  <span>Printable PDF</span>
                  <input
                    accept="application/pdf"
                    onChange={(event) =>
                      updateDraft('pdf_file', event.target.files?.[0] ?? null)
                    }
                    type="file"
                  />
                </label>
                {editingLesson ? (
                  <div className="pdf-status-card">
                    <span className={`pdf-status-card__pill pdf-status-card__pill--${pdfStatusKind(editingLesson)}`}>
                      {pdfStatusLabel(editingLesson)}
                    </span>
                    {editingLesson.pdf_generated_at ? (
                      <small>Generated {formatDateTime(editingLesson.pdf_generated_at)}</small>
                    ) : (
                      <small>No generated printable PDF yet.</small>
                    )}
                    <div className="pdf-status-card__actions">
                      <button
                        className="button button--secondary button--compact"
                        disabled={pdfBusy || hasUnsavedChanges}
                        onClick={() => void regeneratePdf()}
                        type="button"
                      >
                        <Icon name="save" />
                        <span>{editingLesson.has_pdf ? 'Regenerate PDF' : 'Generate PDF'}</span>
                      </button>
                      {editingLesson.has_pdf ? (
                        <button className="button button--secondary button--compact" disabled={pdfBusy} onClick={() => void downloadPdf()} type="button">
                          <Icon name="file" />
                          <span>Download PDF</span>
                        </button>
                      ) : null}
                    </div>
                    {hasUnsavedChanges ? <small>Save the lesson before regenerating its PDF.</small> : null}
                    {pdfMessage ? <small>{pdfMessage}</small> : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="lesson-editor-section" id="lesson-editor-main-activity">
              {editingLesson ? (
                <MainActivityEditor
                  api={api}
                  data={data}
                  linkedClassCount={mainActivityLinkedClassCount}
                  lesson={editingLesson}
                  onWorkspaceSaved={onMainActivityWorkspaceSaved}
                />
              ) : (
                <section className="main-activity-editor">
                  <SectionHeading
                    subtitle="Save this lesson before adding website-based activity questions"
                    title="Main Activity"
                  />
                  <p className="admin-empty-line">
                    Main Activity setup becomes available after the lesson is saved.
                  </p>
                </section>
              )}
            </section>

            {message ? <p className="admin-message">{message}</p> : null}

            <div className="lesson-save-bar">
              <div className={`lesson-save-status lesson-save-status--${saveState}`}>
                <Icon name={saveState === 'saved' || saveState === 'clean' || saveState === 'local' ? 'check' : saveState === 'saving' ? 'save' : 'warning'} />
                <span>
                  <strong>{saveStateLabel(saveState, Boolean(draft.pdf_file))}</strong>
                  {draft.pdf_file ? <small>Text can recover locally; the selected PDF saves only with the lesson.</small> : null}
                </span>
              </div>
              <div className="lesson-editor__actions">
                {editingLesson ? (
                  <button className="button button--secondary button--danger" disabled={deleting || saving} onClick={() => void deleteLesson()} type="button">
                    <Icon name="trash" />
                    <span>{deleting ? 'Deleting...' : 'Delete lesson'}</span>
                  </button>
                ) : null}
                <Link className="button button--secondary" onClick={confirmLeave} to={backUrl}>
                  Cancel
                </Link>
                <button className="button button--primary" disabled={saving} type="submit">
                  <Icon name="save" />
                  <span>{saving ? 'Saving...' : 'Save lesson'}</span>
                </button>
              </div>
            </div>
          </div>
          <LessonEditorOutline draft={draft} />
        </div>
      </form>

      {modalLessonField ? (
        <div className="lesson-focus-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-focus-modal-title">
          <div className="lesson-focus-modal__backdrop" />
          <div className="lesson-focus-modal__panel">
            <div className="lesson-focus-modal__header">
              <div>
                <span>Focused lesson section</span>
                <strong id="lesson-focus-modal-title">{modalLessonField.label}</strong>
              </div>
              <button className="button button--secondary button--compact" onClick={closeLessonFieldModal} type="button">
                Close
              </button>
            </div>
            <div className="lesson-focus-modal__body">
              <TextArea
                autoFocus
                isLarge
                label={modalLessonField.label}
                onChange={(value) => updateDraft(modalLessonField.key, value)}
                rows={modalLessonField.rows}
                value={draft[modalLessonField.key]}
              />
            </div>
            <div className="lesson-focus-modal__footer">
              <button className="button button--primary" onClick={closeLessonFieldModal} type="button">
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showImportModal ? (
        <LessonImportModal
          canUploadAssets={Boolean(editingLesson)}
          onApply={applyLessonImport}
          onClose={() => setShowImportModal(false)}
        />
      ) : null}
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function toSerializableLessonDraft(draft: LessonDraft): SerializableLessonDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([key]) => key !== 'pdf_file'),
  ) as SerializableLessonDraft
}

function draftsMatch(
  first: SerializableLessonDraft,
  second: SerializableLessonDraft,
) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function formatDraftTime(savedAt: string) {
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime())
    ? 'an earlier session'
    : date.toLocaleString()
}

function saveStateLabel(saveState: SaveState, hasPdf: boolean) {
  if (saveState === 'saving') {
    return 'Saving'
  }
  if (saveState === 'saved') {
    return 'Saved'
  }
  if (saveState === 'local' && !hasPdf) {
    return 'Draft saved locally'
  }
  if (saveState === 'clean') {
    return 'No unsaved changes'
  }
  return 'Unsaved changes'
}

type ParsedLessonImport = {
  examples: ParsedLessonExampleImport[]
  is_published: boolean | null
  order: string
  resources: string
  sections: Partial<Record<LessonTemplateFieldKey, string>>
  title: string
  unknownSections: string[]
}

type ParsedLessonExampleImport = {
  alt_text: string
  body: string
  common_mistake: string
  imageUrl: string
  is_published: boolean
  order: string
  title: string
  unsupportedFields: string[]
}

type LessonImageReference = {
  alt: string
  filename: string
  originalUrl: string
}

type LessonImageResolution = {
  assetUrls: Map<string, string>
  messages: string[]
}

const lessonImportExample = `# Lesson: Flowchart Symbols And Program Logic
Order: 1
Published: false

## What We'll Learn
By the end of this lesson, students can identify common flowchart symbols.

![Flowchart symbols](images/flowchart-symbols.svg)

## Before We Start
What symbols have you seen in maps, apps, or signs?

## Let's Understand
A flowchart shows the steps of a process using standard symbols.

## Let's Practice
Label each flowchart symbol and describe its purpose.

## Challenge Task
Improve your flowchart by adding at least one decision symbol.

## Lesson Examples

### Example: Flowchart Symbols
Order: 1
Published: true
Image: images/flowchart-symbols.svg
Alt: Flowchart symbols chart

This example shows the most common flowchart symbols.

Common mistake:
Students may confuse input/output with process symbols.

## Resources
- Java toolchain guide
- images/flowchart-symbols.svg

`

const lessonImportAliases: Record<string, LessonTemplateFieldKey | 'resources'> = {
  'before we start': 'before_you_start',
  'challenge': 'challenge_task',
  'challenge task': 'challenge_task',
  'lets practice': 'lets_practice',
  'lets understand': 'short_discussion',
  'resources': 'resources',
  'short discussion': 'short_discussion',
  'what well learn': 'learning_targets',
}

function parseLessonImportMarkdown(value: string): ParsedLessonImport {
  const parsed: ParsedLessonImport = {
    examples: [],
    is_published: null,
    order: '',
    resources: '',
    sections: {},
    title: '',
    unknownSections: [],
  }
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  let currentKey: LessonTemplateFieldKey | 'resources' | null = null
  let currentUnknown = ''
  let buffer: string[] = []
  let inExamples = false
  let currentExampleTitle = ''
  let exampleBuffer: string[] = []

  function flush() {
    const content = buffer.join('\n').trim()
    if (currentKey && content) {
      if (currentKey === 'resources') {
        parsed.resources = mergeImportedBlock(parsed.resources, content)
      } else {
        parsed.sections[currentKey] = mergeImportedBlock(parsed.sections[currentKey] ?? '', content)
      }
    } else if (currentUnknown && content) {
      parsed.unknownSections.push(currentUnknown)
    }
    buffer = []
  }

  function flushExample() {
    if (!currentExampleTitle && !exampleBuffer.some((line) => line.trim())) {
      exampleBuffer = []
      return
    }

    const example = parseLessonExampleImport(currentExampleTitle, exampleBuffer)
    parsed.unknownSections.push(
      ...example.unsupportedFields.map((field) => `Lesson example field: ${field}`),
    )
    if (example.title || example.body || example.imageUrl) {
      parsed.examples.push(example)
    }
    currentExampleTitle = ''
    exampleBuffer = []
  }

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      const level = heading[1].length
      const title = heading[2].replace(/:$/, '').trim()
      if (inExamples) {
        if (level >= 3) {
          flushExample()
          currentExampleTitle = stripExampleHeading(title)
          return
        }

        flushExample()
        inExamples = false
      }

      if (level >= 3 && (currentKey || currentUnknown)) {
        buffer.push(line)
        return
      }

      flush()
      const titleMatch = title.match(/^Lesson\s*:\s*(.+)$/i)
      if (level === 1 && titleMatch) {
        parsed.title = cleanImportedName(titleMatch[1])
        currentKey = null
        currentUnknown = ''
        return
      }
      if (level === 1 && !parsed.title) {
        parsed.title = cleanImportedName(title)
        currentKey = null
        currentUnknown = ''
        return
      }
      if (isLessonExamplesHeading(title)) {
        inExamples = true
        currentKey = null
        currentUnknown = ''
        return
      }
      currentKey = lessonImportSectionKey(title)
      currentUnknown = currentKey ? '' : title
      return
    }

    if (inExamples) {
      exampleBuffer.push(line)
      return
    }

    const meta = line.match(/^([A-Za-z][A-Za-z ]+)\s*:\s*(.*)$/)
    if (!currentKey && meta) {
      const key = normalizeImportHeading(meta[1])
      const rawValue = meta[2].trim()
      if (key === 'order') {
        parsed.order = rawValue
        return
      }
      if (key === 'published') {
        parsed.is_published = /^(true|yes|published|1)$/i.test(rawValue)
        return
      }
      if (key === 'title' && !parsed.title) {
        parsed.title = cleanImportedName(rawValue)
        return
      }
    }

    buffer.push(line)
  })
  flushExample()
  flush()

  return parsed
}

function parseLessonExampleImport(
  headingTitle: string,
  lines: string[],
): ParsedLessonExampleImport {
  const example: ParsedLessonExampleImport = {
    alt_text: '',
    body: '',
    common_mistake: '',
    imageUrl: '',
    is_published: true,
    order: '',
    title: stripExampleHeading(headingTitle),
    unsupportedFields: [],
  }
  let currentBlock: 'body' | 'common_mistake' | null = 'body'
  const blocks: Record<'body' | 'common_mistake', string[]> = {
    body: [],
    common_mistake: [],
  }

  lines.forEach((line) => {
    const meta = line.match(/^([A-Za-z][A-Za-z -]+)\s*:\s*(.*)$/)
    if (meta) {
      const key = normalizeImportHeading(meta[1])
      const rawValue = meta[2].trim()

      if (key === 'order') {
        example.order = rawValue
        return
      }
      if (key === 'published') {
        example.is_published = /^(true|yes|published|1)$/i.test(rawValue)
        return
      }
      if (key === 'image') {
        example.imageUrl = rawValue
        return
      }
      if (key === 'alt' || key === 'alt text') {
        example.alt_text = rawValue
        return
      }
      if (key === 'title' && rawValue) {
        example.title = cleanImportedName(rawValue)
        return
      }
      if (key === 'common mistake' || key === 'common mistakes') {
        currentBlock = 'common_mistake'
        if (rawValue) {
          blocks.common_mistake.push(rawValue)
        }
        return
      }
      if (key === 'body' || key === 'example text') {
        currentBlock = 'body'
        if (rawValue) {
          blocks.body.push(rawValue)
        }
        return
      }
      example.unsupportedFields.push(meta[1].trim())
      currentBlock = null
      return
    }

    const image = line.match(/!\[([^\]]*)\]\(([^)]+)\)/)
    if (image && !example.imageUrl) {
      example.alt_text ||= image[1].trim()
      example.imageUrl = image[2].trim()
      return
    }

    if (currentBlock) {
      blocks[currentBlock].push(line)
    }
  })

  example.body = blocks.body.join('\n').trim()
  example.common_mistake = blocks.common_mistake.join('\n').trim()
  if (!example.alt_text && example.imageUrl) {
    example.alt_text = imageAltTextFromFilename(importedImageFilename(example.imageUrl))
  }
  return example
}

function stripExampleHeading(value: string) {
  return cleanImportedName(value.replace(/^Example\s*:\s*/i, ''))
}

function isLessonExamplesHeading(value: string) {
  const normalized = normalizeImportHeading(value)
  return ['lesson examples', 'examples', 'lets look at examples'].includes(normalized)
}

function lessonImportSectionKey(title: string) {
  const normalized = normalizeImportHeading(title)
  const direct = studentLessonFields.find((field) => normalizeImportHeading(field.label) === normalized)
  return direct?.key ?? lessonImportAliases[normalized] ?? null
}

function normalizeImportHeading(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function mergeImportedBlock(current: string, incoming: string) {
  return [current.trim(), incoming.trim()].filter(Boolean).join('\n\n')
}

function collectLessonImageReferences(parsed: ParsedLessonImport) {
  const references = new Map<string, LessonImageReference>()
  function addReference(originalUrl: string, alt: string) {
    if (!originalUrl || isRemoteOrMediaUrl(originalUrl)) {
      return
    }
    const filename = importedImageFilename(originalUrl)
    if (!filename) {
      return
    }
    references.set(originalUrl, {
      alt,
      filename,
      originalUrl,
    })
  }

  const blocks = [
    parsed.resources,
    ...studentLessonFields.map((field) => parsed.sections[field.key] ?? ''),
    ...parsed.examples.map((example) => [
      example.body,
      example.common_mistake,
    ].join('\n\n')),
  ]
  blocks.forEach((block) => {
    for (const match of block.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      addReference(match[2].trim(), match[1].trim())
    }
  })
  parsed.examples.forEach((example) => addReference(example.imageUrl, example.alt_text))
  return Array.from(references.values())
}

function collectLessonContentImageReferences(parsed: ParsedLessonImport) {
  const references = new Map<string, LessonImageReference>()
  const blocks = [
    parsed.resources,
    ...studentLessonFields.map((field) => parsed.sections[field.key] ?? ''),
  ]
  blocks.forEach((block) => {
    for (const match of block.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      const originalUrl = match[2].trim()
      if (!originalUrl || isRemoteOrMediaUrl(originalUrl)) {
        continue
      }
      const filename = importedImageFilename(originalUrl)
      if (!filename) {
        continue
      }
      references.set(originalUrl, {
        alt: match[1].trim(),
        filename,
        originalUrl,
      })
    }
  })
  return Array.from(references.values())
}

function isRemoteOrMediaUrl(value: string) {
  return /^(https?:|data:|\/media\/|\/static\/)/i.test(value)
}

function importedImageFilename(value: string) {
  const clean = value
    .replace(/^file:\/\/\/?/i, '')
    .split(/[?#]/)[0]
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

function imageAltTextFromFilename(filename: string) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Image'
}

function fileExtension(file: File) {
  return file.name.toLowerCase().split('.').pop() ?? ''
}

function isLessonMarkdownFile(file: File) {
  const extension = fileExtension(file)
  const hasValidExtension = ['markdown', 'md', 'txt'].includes(extension)
  return (
    hasValidExtension &&
    (!file.type || ['text/markdown', 'text/plain'].includes(file.type))
  )
}

function isLessonImageFile(file: File) {
  const extension = fileExtension(file)
  const hasValidExtension = ['jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)
  return (
    hasValidExtension &&
    (
      !file.type ||
      ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'].includes(file.type)
    )
  )
}

function insertAtSelection(value: string, insert: string, start: number, end: number) {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))
  const before = value.slice(0, safeStart)
  const after = value.slice(safeEnd)
  const prefix = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : ''
  const suffix = after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : ''
  const replacement = `${prefix}${insert}${suffix}`
  return {
    cursor: before.length + replacement.length,
    value: `${before}${replacement}${after}`,
  }
}

async function resolveImportedLessonImages(
  api: AuthedRequest,
  lesson: ModuleLesson | undefined,
  parsed: ParsedLessonImport,
  files: File[],
): Promise<LessonImageResolution> {
  const references = collectLessonContentImageReferences(parsed)
  const messages: string[] = []
  const assetUrls = new Map<string, string>()
  if (!references.length) {
    return { assetUrls, messages }
  }
  if (!lesson) {
    messages.push('Save this lesson before uploading linked image files. Text was imported, but local image links were not rewritten.')
    return { assetUrls, messages }
  }

  const filesByName = new Map<string, File[]>()
  files.forEach((file) => {
    const key = file.name.toLowerCase()
    filesByName.set(key, [...(filesByName.get(key) ?? []), file])
  })

  for (const reference of references) {
    const matches = filesByName.get(reference.filename.toLowerCase()) ?? []
    if (!matches.length) {
      messages.push(`Missing image file: ${reference.filename}`)
      continue
    }
    if (matches.length > 1) {
      messages.push(`Duplicate uploaded filename: ${reference.filename}. Rename one copy and upload again.`)
      continue
    }

    const formData = new FormData()
    formData.append('lesson', String(lesson.id))
    formData.append('file', matches[0])
    formData.append('original_name', matches[0].name)
    formData.append('alt_text', reference.alt)
    const asset = await api<ModuleLessonAsset>('/modules/lesson-assets/', {
      body: formData,
      method: 'POST',
    })
    assetUrls.set(reference.originalUrl, asset.file)
  }

  return { assetUrls, messages }
}

function rewriteLessonImportImageUrls(
  sections: ParsedLessonImport['sections'],
  assetUrls: Map<string, string>,
) {
  if (!assetUrls.size) {
    return sections
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [
      key,
      rewriteMarkdownImageUrls(value ?? '', assetUrls),
    ]),
  ) as ParsedLessonImport['sections']
}

function rewriteMarkdownImageUrls(value: string, assetUrls: Map<string, string>) {
  return value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt: string, url: string) => {
    const replacement = assetUrls.get(url.trim())
    return replacement ? `![${alt}](${replacement})` : match
  })
}

function downloadLessonImportExample() {
  downloadBlob(
    new Blob([lessonImportExample], { type: 'text/markdown' }),
    'lesson-import-example.md',
  )
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function LessonImportModal({
  canUploadAssets,
  onApply,
  onClose,
}: {
  canUploadAssets: boolean
  onApply: (parsed: ParsedLessonImport, files: File[], mode: LessonImportMode) => Promise<string[]>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef({ end: 0, start: 0 })
  const parsed = useMemo(() => parseLessonImportMarkdown(text), [text])
  const imageReferences = useMemo(() => collectLessonImageReferences(parsed), [parsed])
  const fileCounts = useMemo(() => {
    const counts = new Map<string, number>()
    files.forEach((file) => counts.set(file.name.toLowerCase(), (counts.get(file.name.toLowerCase()) ?? 0) + 1))
    return counts
  }, [files])

  async function uploadMarkdownFile(file: File | null) {
    if (!file) return
    if (!isLessonMarkdownFile(file)) {
      setMessage('Upload a Markdown or text file for the lesson content.')
      return
    }
    setText(await file.text())
    setMessage(`${file.name} loaded.`)
  }

  async function copyLessonImportExample() {
    const copied = await copyTextToClipboard(lessonImportExample)
    setMessage(copied ? 'Example Markdown copied.' : 'Copy failed. You can still download the example MD.')
  }

  function rememberSelection() {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    selectionRef.current = {
      end: textarea.selectionEnd,
      start: textarea.selectionStart,
    }
  }

  function uploadImageFiles(nextFiles: File[]) {
    const validFiles = nextFiles.filter(isLessonImageFile)
    const rejectedFiles = nextFiles.filter((file) => !isLessonImageFile(file))
    if (!validFiles.length) {
      if (rejectedFiles.length) {
        setMessage('Upload PNG, JPG, WebP, or SVG files for lesson images.')
      }
      return
    }
    setFiles(validFiles)
    const existingReferences = new Set(
      collectLessonImageReferences(parseLessonImportMarkdown(text))
        .map((reference) => reference.filename.toLowerCase()),
    )
    const duplicateNames = validFiles
      .filter((file) => existingReferences.has(file.name.toLowerCase()))
      .map((file) => file.name)
    const insertableFiles = validFiles
      .filter((file) => !existingReferences.has(file.name.toLowerCase()))

    if (!insertableFiles.length) {
      setMessage(
        duplicateNames.length === 1
          ? `${duplicateNames[0]} already exists in the Markdown.`
          : 'All uploaded images already have Markdown references.',
      )
      return
    }

    const selection = selectionRef.current
    const selectedText = text.slice(selection.start, selection.end).trim()
    const lines = insertableFiles.map((file, index) => {
      const altText = index === 0 && selectedText ? selectedText : imageAltTextFromFilename(file.name)
      return `![${altText}](${file.name})`
    })
    const nextText = insertAtSelection(text, lines.join('\n\n'), selection.start, selection.end)
    const cursor = nextText.cursor
    setText(nextText.value)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursor, cursor)
      selectionRef.current = { end: cursor, start: cursor }
    })
    setMessage(
      [
        `${lines.length} image reference${lines.length === 1 ? '' : 's'} inserted.`,
        duplicateNames.length ? `${duplicateNames.join(', ')} already existed.` : '',
        rejectedFiles.length ? `Skipped invalid file${rejectedFiles.length === 1 ? '' : 's'}: ${rejectedFiles.map((file) => file.name).join(', ')}.` : '',
      ].filter(Boolean).join(' '),
    )
  }

  async function apply(mode: LessonImportMode) {
    setBusy(true)
    setMessage('')
    try {
      const messages = await onApply(parsed, files, mode)
      setMessage(messages.length ? messages.join(' ') : 'Lesson import applied to the draft.')
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lesson-focus-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-import-title">
      <div className="lesson-focus-modal__backdrop" />
      <div className="lesson-focus-modal__panel lesson-import-modal">
        <div className="lesson-focus-modal__header">
          <div>
            <span>Structured import</span>
            <strong id="lesson-import-title">Import Lesson Markdown</strong>
          </div>
          <button className="button button--secondary button--compact" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="lesson-import-modal__body">
          <section className="lesson-import-modal__inputs">
            <div className="lesson-editor__actions">
              <button className="button button--secondary button--compact" onClick={downloadLessonImportExample} type="button">
                <Icon name="file" />
                <span>Download Example MD</span>
              </button>
              <button className="button button--secondary button--compact" onClick={() => void copyLessonImportExample()} type="button">
                <Icon name="file" />
                <span>Copy Example MD</span>
              </button>
              <label className="button button--secondary button--compact import-file-button">
                <Icon name="upload" />
                <span>Upload MD</span>
                <input onChange={(event) => void uploadMarkdownFile(event.target.files?.[0] ?? null)} type="file" />
              </label>
              <label className="button button--secondary button--compact import-file-button">
                <Icon name="upload" />
                <span>Upload Images</span>
                <input
                  multiple
                  onChange={(event) => uploadImageFiles(Array.from(event.target.files ?? []))}
                  type="file"
                />
              </label>
            </div>
            <label className="admin-field">
              <span>Lesson Markdown</span>
              <textarea
                onBlur={rememberSelection}
                onChange={(event) => {
                  setText(event.target.value)
                  selectionRef.current = {
                    end: event.target.selectionEnd,
                    start: event.target.selectionStart,
                  }
                }}
                onClick={rememberSelection}
                onKeyUp={rememberSelection}
                onSelect={rememberSelection}
                ref={textareaRef}
                rows={18}
                value={text}
              />
              <small>
                Local paths in Markdown are okay. AralForge matches them by filename, but you still need to upload the image files.
              </small>
            </label>
            {!canUploadAssets && imageReferences.length ? (
              <p className="admin-message">Save this lesson first to upload and rewrite linked image files.</p>
            ) : null}
            {message ? <p className="admin-message">{message}</p> : null}
          </section>
          <section className="lesson-import-preview">
            <p className="eyebrow">Preview</p>
            <div className="lesson-import-preview__grid">
              <span>Title</span>
              <strong>{parsed.title || 'Not found'}</strong>
              <span>Order</span>
              <strong>{parsed.order || 'Not found'}</strong>
              <span>Published</span>
              <strong>{parsed.is_published === null ? 'Not found' : parsed.is_published ? 'True' : 'False'}</strong>
            </div>
            <div className="lesson-import-preview__sections">
              {studentLessonFields.map((field) => (
                <span className={parsed.sections[field.key]?.trim() ? 'is-filled' : ''} key={field.key}>
                  {field.label}
                </span>
              ))}
            </div>
            <div className="lesson-import-preview__assets">
              <strong>Examples detected: {parsed.examples.length}</strong>
              {parsed.examples.length ? parsed.examples.map((example, index) => (
                <small key={`${example.title}-${index}`}>
                  {example.title || `Example ${index + 1}`}
                  {example.imageUrl ? ` - ${importedImageFilename(example.imageUrl) || example.imageUrl}` : ''}
                </small>
              )) : <small>No lesson examples detected.</small>}
            </div>
            <div className="lesson-import-preview__assets">
              <strong>Image matches</strong>
              {imageReferences.length ? imageReferences.map((reference) => {
                const count = fileCounts.get(reference.filename.toLowerCase()) ?? 0
                return (
                  <small key={reference.originalUrl}>
                    {reference.filename}: {count === 1 ? 'matched' : count > 1 ? 'duplicate upload' : 'missing upload'}
                  </small>
                )
              }) : <small>No local Markdown image links detected.</small>}
              {parsed.unknownSections.length ? (
                <small>Unsupported sections: {parsed.unknownSections.join(', ')}</small>
              ) : null}
            </div>
          </section>
        </div>
        <div className="lesson-focus-modal__footer">
          <button className="button button--secondary" disabled={busy || !text.trim()} onClick={() => void apply('empty')} type="button">
            Apply to Empty Fields
          </button>
          <button className="button button--primary" disabled={busy || !text.trim()} onClick={() => void apply('replace')} type="button">
            {busy ? 'Applying...' : 'Replace Lesson Fields'}
          </button>
        </div>
      </div>
    </div>
  )
}

function lessonEditorFieldId(field: LessonTemplateFieldKey) {
  return `lesson-editor-field-${field}`
}

function scrollToLessonEditorSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  })
}

function lessonFieldStatus(draft: LessonDraft, field: LessonTemplateFieldKey) {
  return draft[field].trim() ? 'Filled' : 'Needs content'
}

function LessonEditorOutline({
  draft,
}: {
  draft: LessonDraft
}) {
  const filledCount = studentLessonFields.filter((field) => draft[field.key].trim()).length

  return (
    <aside className="lesson-editor-outline" aria-label="Lesson checklist">
      <div className="lesson-editor-outline__header">
        <span>Lesson Checklist</span>
        <strong>{filledCount} of {studentLessonFields.length} sections filled</strong>
      </div>

      <div className="lesson-editor-outline__group">
        <span className="lesson-editor-outline__label">Lesson Sections</span>
        <div className="lesson-editor-outline__template">
          {studentLessonFields.map((field) => {
            const status = lessonFieldStatus(draft, field.key)
            return (
              <button key={field.key} onClick={() => scrollToLessonEditorSection(lessonEditorFieldId(field.key))} type="button">
                <span>{field.label}</span>
                <small className={`lesson-editor-outline__status lesson-editor-outline__status--${status === 'Filled' ? 'filled' : 'empty'}`}>
                  {status}
                </small>
              </button>
            )
          })}
        </div>
      </div>

      <div className="lesson-editor-outline__utility" aria-label="Lesson editor shortcuts">
        <button onClick={() => scrollToLessonEditorSection('lesson-editor-main-activity')} type="button">
          Main Activity
        </button>
        <button onClick={() => scrollToLessonEditorSection('lesson-editor-details')} type="button">
          Back to Top
        </button>
      </div>
    </aside>
  )
}

function LessonEditorMobileOutline({
  draft,
}: {
  draft: LessonDraft
}) {
  return (
    <nav className="lesson-editor-mobile-outline" aria-label="Lesson editor sections">
      {studentLessonFields.map((field) => {
        const isFilled = lessonFieldStatus(draft, field.key) === 'Filled'
        return (
          <button
            className={isFilled ? 'is-filled' : ''}
            key={field.key}
            onClick={() => scrollToLessonEditorSection(lessonEditorFieldId(field.key))}
            type="button"
          >
            {field.label}
          </button>
        )
      })}
      <button
        className="lesson-editor-mobile-outline__utility"
        onClick={() => scrollToLessonEditorSection('lesson-editor-main-activity')}
        type="button"
      >
        Main Activity
      </button>
      <button
        className="lesson-editor-mobile-outline__utility"
        onClick={() => scrollToLessonEditorSection('lesson-editor-details')}
        type="button"
      >
        Top
      </button>
    </nav>
  )
}

function TextArea({
  autoFocus,
  isLarge,
  label,
  onChange,
  onEnterFocus,
  rows,
  value,
}: {
  autoFocus?: boolean
  isLarge?: boolean
  label: string
  onChange: (value: string) => void
  onEnterFocus?: () => void
  rows: number
  value: string
}) {
  return (
    <MarkdownEditor
      autoFocus={autoFocus}
      isLarge={isLarge}
      label={label}
      onChange={onChange}
      onEnterFocus={onEnterFocus}
      rows={rows}
      value={value}
    />
  )
}

const studentLessonFields: Array<{
  key: LessonTemplateFieldKey
  label: string
  rows: number
}> = [
  { key: 'learning_targets', label: "What We'll Learn", rows: 5 },
  { key: 'before_you_start', label: 'Before We Start', rows: 5 },
  { key: 'short_discussion', label: "Let's Understand", rows: 12 },
  { key: 'lets_practice', label: "Let's Practice", rows: 10 },
  { key: 'challenge_task', label: 'Challenge Task', rows: 6 },
]

function mergeImportedLessonExamples(
  currentExamples: LessonExampleDraft[],
  importedExamples: ParsedLessonExampleImport[],
  files: File[],
  mode: LessonImportMode,
) {
  const messages: string[] = []
  if (!importedExamples.length) {
    return { examples: currentExamples, messages }
  }

  const filesByName = new Map<string, File[]>()
  files.forEach((file) => {
    const key = file.name.toLowerCase()
    filesByName.set(key, [...(filesByName.get(key) ?? []), file])
  })

  const nextExamples = [...currentExamples]
  const activeExamples = () => nextExamples.filter((example) => !example.deleted)
  importedExamples.forEach((example) => {
    const title = example.title || `Example ${activeExamples().length + 1}`
    const existingIndex = nextExamples.findIndex(
      (current) =>
        !current.deleted &&
        normalizeImportHeading(current.title) === normalizeImportHeading(title),
    )

    if (mode === 'empty' && existingIndex >= 0) {
      return
    }

    const order = example.order || String(activeExamples().length + 1)
    const image = importedExampleImageFile(example, filesByName, messages)
    const draft: LessonExampleDraft = {
      alt_text: example.alt_text,
      body: example.body,
      common_mistake: example.common_mistake,
      deleted: false,
      existingImage: existingIndex >= 0 ? nextExamples[existingIndex].existingImage : '',
      id: existingIndex >= 0
        ? nextExamples[existingIndex].id
        : `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      image,
      is_published: example.is_published,
      order,
      serverId: existingIndex >= 0 ? nextExamples[existingIndex].serverId : undefined,
      title,
    }

    if (existingIndex >= 0) {
      nextExamples[existingIndex] = {
        ...nextExamples[existingIndex],
        ...draft,
        image: image ?? nextExamples[existingIndex].image,
      }
      return
    }

    nextExamples.push(draft)
  })

  return { examples: nextExamples, messages }
}

function importedExampleImageFile(
  example: ParsedLessonExampleImport,
  filesByName: Map<string, File[]>,
  messages: string[],
) {
  if (!example.imageUrl || isRemoteOrMediaUrl(example.imageUrl)) {
    return null
  }

  const filename = importedImageFilename(example.imageUrl)
  if (!filename) {
    return null
  }

  const matches = filesByName.get(filename.toLowerCase()) ?? []
  if (!matches.length) {
    messages.push(`Missing example image file: ${filename}`)
    return null
  }
  if (matches.length > 1) {
    messages.push(`Duplicate uploaded example filename: ${filename}. Rename one copy and upload again.`)
    return null
  }

  return matches[0]
}

function createExampleDrafts(
  examples: ModuleLessonExample[],
  lessonId?: number,
): LessonExampleDraft[] {
  if (!lessonId) {
    return []
  }

  return examples
    .filter((example) => example.lesson === lessonId)
    .sort((first, second) => first.order - second.order || first.id - second.id)
    .map((example) => ({
      alt_text: example.alt_text,
      body: example.body,
      common_mistake: example.common_mistake,
      deleted: false,
      existingImage: example.image,
      id: `server-${example.id}`,
      image: null,
      is_published: example.is_published,
      order: String(example.order),
      serverId: example.id,
      title: example.title,
    }))
}

function createEmptyExampleDraft(order: number): LessonExampleDraft {
  return {
    alt_text: '',
    body: '',
    common_mistake: '',
    deleted: false,
    existingImage: '',
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    image: null,
    is_published: true,
    order: String(order),
    title: '',
  }
}

function serializeExampleDrafts(examples: LessonExampleDraft[]) {
  return JSON.stringify(
    examples.map((example) =>
      Object.fromEntries(
        Object.entries(example).filter(([key]) => key !== 'image'),
      ),
    ),
  )
}

async function syncLessonExamples(
  api: AuthedRequest,
  lessonId: number,
  examples: LessonExampleDraft[],
  initialExamples: LessonExampleDraft[],
) {
  const activeServerIds = new Set(
    examples
      .filter((example) => example.serverId && !example.deleted)
      .map((example) => example.serverId),
  )
  const deletedIds = initialExamples
    .map((example) => example.serverId)
    .filter((id): id is number => Boolean(id) && !activeServerIds.has(id))

  await Promise.all(
    deletedIds.map((id) =>
      api(`/modules/lesson-examples/${id}/`, { method: 'DELETE' }),
    ),
  )

  for (const example of examples.filter((item) => !item.deleted)) {
    const hasContent = Boolean(
      example.title.trim() ||
        example.body.trim() ||
        example.common_mistake.trim() ||
        example.image ||
        example.existingImage,
    )
    if (!hasContent) {
      continue
    }

    const formData = new FormData()
    formData.append('lesson', String(lessonId))
    formData.append('order', String(Number(example.order || 0)))
    formData.append('title', example.title || `Example ${example.order || ''}`.trim())
    formData.append('alt_text', example.alt_text)
    formData.append('body', example.body)
    formData.append('common_mistake', example.common_mistake)
    formData.append('is_published', example.is_published ? 'true' : 'false')
    if (example.image) {
      formData.append('image', example.image)
    }

    await api(
      example.serverId
        ? `/modules/lesson-examples/${example.serverId}/`
        : '/modules/lesson-examples/',
      {
        body: formData,
        method: example.serverId ? 'PATCH' : 'POST',
      },
    )
  }
}

function createLessonDraft(topicId: string, lesson?: ModuleLesson): LessonDraft {
  return {
    before_you_start: lesson?.before_you_start ?? '',
    challenge_task: lesson?.challenge_task ?? '',
    is_published: lesson?.is_published ?? false,
    learning_targets: lesson?.learning_targets ?? '',
    lets_practice: lesson?.lets_practice ?? '',
    order: lesson?.order ? String(lesson.order) : '0',
    pdf_file: null,
    resources: lesson?.resources ?? '',
    short_discussion: lesson?.short_discussion ?? '',
    title: lesson?.title ?? '',
    topic: lesson?.topic ? String(lesson.topic) : topicId,
  }
}

function buildLessonPayload(draft: LessonDraft) {
  const payload = {
    acquisition: '',
    answer_key: '',
    before_you_start: draft.before_you_start,
    challenge_task: draft.challenge_task,
    common_misconceptions: '',
    expected_outputs: '',
    guided_examples: '',
    is_published: draft.is_published,
    learning_targets: draft.learning_targets,
    lets_practice: draft.lets_practice,
    making_meaning: '',
    order: Number(draft.order || 0),
    resources: draft.resources,
    short_discussion: draft.short_discussion,
    subtopics: '',
    teacher_notes: '',
    teaching_tips: '',
    remediation: '',
    enrichment: '',
    title: draft.title,
    topic: Number(draft.topic),
    transfer: '',
  }

  if (!draft.pdf_file) {
    return JSON.stringify(payload)
  }

  const formData = new FormData()
  Object.entries(payload).forEach(([key, value]) => {
    formData.append(key, String(value))
  })
  formData.append('pdf_file', draft.pdf_file)
  return formData
}
