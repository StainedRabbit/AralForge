import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import type { AuthedRequest } from '../../app/types'
import { asArray } from '../../api'
import { gradeCategoryOptions, gradingPeriodOptions } from '../../admin/adminHelpers'
import { ProgressiveAdminResourcePanel } from '../../components/admin/ProgressiveAdminResourcePanel'
import type { AdminField } from '../../components/admin/AdminResourcePanel'
import { Icon } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading, StatCard } from '../../components/ui'
import type {
  ApiList,
  GradeCategory,
  GradingTemplate,
  GradingTemplateItem,
  Subject,
  SubjectGradingPolicy,
  TeacherClassGradeSummary,
  TeacherGradesOverviewPage,
} from '../../types'
import { numeric, toErrorMessage } from '../../utils/format'

const topViews = ['OVERVIEW', 'SETUP'] as const
const setupDatasets = ['TEMPLATES', 'POLICIES', 'TEMPLATE_ITEMS', 'CATEGORIES'] as const
const staleTeacherGradeParams = ['dataset', 'schedule', 'period', 'status', 'student'] as const

type TopView = (typeof topViews)[number]
type SetupDataset = (typeof setupDatasets)[number]

export function AdminGradesScalablePage({ api }: { api: AuthedRequest }) {
  const [params, setParams] = useSearchParams()
  const requestedView = params.get('view')?.toUpperCase()
  const view = topViews.includes(requestedView as TopView) ? requestedView as TopView : 'OVERVIEW'
  const query = params.get('q') ?? ''
  const term = params.get('term') ?? ''
  const dataset = params.get('dataset')?.toUpperCase() ?? 'TEMPLATES'

  useEffect(() => {
    const staleView = Boolean(requestedView && !topViews.includes(requestedView as TopView))
    const unsupportedDataset = view === 'SETUP'
      && params.has('dataset')
      && !setupDatasets.includes(dataset as SetupDataset)
    const unsupportedParams = view === 'OVERVIEW'
      ? staleTeacherGradeParams.some((key) => params.has(key))
      : ['term', 'schedule', 'period', 'status', 'student'].some((key) => params.has(key))
    if (!staleView && !unsupportedDataset && !unsupportedParams) return

    setParams((current) => {
      const next = new URLSearchParams(current)
      if (staleView) next.delete('view')
      if (view === 'OVERVIEW') staleTeacherGradeParams.forEach((key) => next.delete(key))
      else ['term', 'schedule', 'period', 'status', 'student'].forEach((key) => next.delete(key))
      if (unsupportedDataset) next.delete('dataset')
      return next
    }, { replace: true })
  }, [dataset, params, requestedView, setParams, view])

  function updateParams(updates: Record<string, string | null>, replace = true) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) next.delete(key)
        else next.set(key, value)
      })
      return next
    }, { replace })
  }

  function changeView(next: TopView) {
    updateParams({
      view: next === 'OVERVIEW' ? null : next.toLowerCase(),
      dataset: null,
      q: null,
      term: next === 'OVERVIEW' ? term : null,
    })
  }

  return (
    <Page>
      <PageHeader
        actions={view !== 'OVERVIEW' ? (
          <button className="button button--secondary" onClick={() => changeView('OVERVIEW')} type="button">
            <Icon name="arrow-left" />
            <span>Back to classes</span>
          </button>
        ) : null}
        description="Monitor class progress and manage grading rules without loading the entire school history."
        eyebrow="Teacher workspace"
        title="Grades"
      />
      <nav aria-label="Grade workspace" className="grade-hub-tabs">
        <HubTab active={view === 'OVERVIEW'} icon="dashboard" label="Class overview" onClick={() => changeView('OVERVIEW')} />
        <HubTab active={view === 'SETUP'} icon="edit" label="Grading setup" onClick={() => changeView('SETUP')} />
      </nav>

      {view === 'OVERVIEW' ? (
        <GradeOverview
          api={api}
          query={query}
          setQuery={(value) => updateParams({ q: value || null })}
          setTerm={(value) => updateParams({ term: value || null })}
          term={term}
        />
      ) : null}
      {view === 'SETUP' ? (
        <SetupView
          api={api}
          dataset={normalizeDataset(dataset, setupDatasets, 'TEMPLATES')}
          query={query}
          setDataset={(value) => updateParams({ dataset: value.toLowerCase(), q: null })}
          setQuery={(value) => updateParams({ q: value || null })}
        />
      ) : null}
    </Page>
  )
}

function GradeOverview({ api, query, setQuery, setTerm, term }: {
  api: AuthedRequest
  query: string
  setQuery: (value: string) => void
  setTerm: (value: string) => void
  term: string
}) {
  const debounced = useDebouncedValue(query, 300)
  const loadRef = useRef<HTMLDivElement>(null)
  const overview = useInfiniteQuery({
    initialPageParam: 0,
    queryKey: ['teacher-grades-overview', term, debounced],
    queryFn: ({ pageParam, signal }) => {
      const search = new URLSearchParams({ limit: '12', offset: String(pageParam) })
      if (term) search.set('term', term)
      if (debounced.trim()) search.set('search', debounced.trim())
      return api<TeacherGradesOverviewPage>(`/grades/teacher-overview/?${search.toString()}`, { signal })
    },
    getNextPageParam: (lastPage) => pageOffset(lastPage.next),
    staleTime: 60_000,
  })
  const cards = overview.data?.pages.flatMap((page) => page.results) ?? []
  const first = overview.data?.pages[0]
  const fetchNextPage = overview.fetchNextPage
  const hasNextPage = overview.hasNextPage
  const isFetchNextPageError = overview.isFetchNextPageError
  const isFetchingNextPage = overview.isFetchingNextPage

  useEffect(() => {
    const target = loadRef.current
    if (!target || !hasNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '0px 0px 200px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  return (
    <>
      <section aria-label="Grade overview" className="stat-grid grade-hub-stats">
        <StatCard icon="calendar" label="Active classes" value={first?.summary.active_classes ?? '—'} detail={`${first?.summary.active_enrollments ?? 0} active enrollments`} />
        <StatCard icon="activity" label="Grade items" value={first?.summary.grade_items ?? '—'} detail="Across active classes" />
        <StatCard icon="warning" label="Pending records" value={first?.summary.pending_records ?? '—'} detail="Category, period, and final records" />
        <StatCard icon="check" label="Completed finals" value={first?.summary.completed_finals ?? '—'} detail="Ready final-grade records" />
      </section>
      <section className="section-block grade-class-overview">
        <SectionHeading
          action={<Link className="button button--secondary button--compact" to="/admin/classes"><Icon name="users" /><span>Manage classes</span></Link>}
          subtitle="Twelve classes load at a time; search covers every active class."
          title="Classes"
        />
        <div className="grade-class-toolbar">
          <label className="admin-search">
            <Icon name="search" />
            <input aria-label="Search classes" onChange={(event) => setQuery(event.target.value)} placeholder="Search subject, section, room, or term" type="search" value={query} />
          </label>
          <label className="admin-field grade-class-term-filter">
            <span>Term</span>
            <select onChange={(event) => setTerm(event.target.value)} value={term}>
              <option value="">All active terms</option>
              {(first?.terms ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        {overview.isPending ? <div className="grade-class-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index}><span /><strong /><p /><p /></div>)}</div> : null}
        {overview.error && !cards.length ? <div className="progressive-feedback" role="alert"><span>{toErrorMessage(overview.error)}</span><button className="button button--secondary button--compact" onClick={() => void overview.refetch()} type="button">Retry</button></div> : null}
        {cards.length ? <div className="grade-class-grid">{cards.map((card) => <GradeClassCard card={card} key={card.schedule.id} />)}</div> : null}
        {!overview.isPending && !overview.error && !cards.length ? <EmptyState icon="grade" title="No classes match" message="Try another search or term, or create an active class." /> : null}
        {cards.length ? (
          <div className="grade-overview-pagination" ref={loadRef}>
            <span aria-live="polite">Showing {cards.length} of {first?.count ?? cards.length} classes</span>
            {overview.hasNextPage && !overview.isFetchNextPageError ? <button className="button button--secondary button--compact" disabled={overview.isFetchingNextPage} onClick={() => void overview.fetchNextPage()} type="button">{overview.isFetchingNextPage ? 'Loading more...' : 'Load more'}</button> : null}
            {overview.isFetchNextPageError ? <button className="button button--secondary button--compact" onClick={() => void overview.fetchNextPage()} type="button">Retry loading more</button> : null}
          </div>
        ) : null}
      </section>
    </>
  )
}

function SetupView({ api, dataset, query, setDataset, setQuery }: DatasetProps<SetupDataset>) {
  return (
    <>
      <SubTabs items={[['TEMPLATES', 'Templates'], ['POLICIES', 'Subject policies'], ['TEMPLATE_ITEMS', 'Template items'], ['CATEGORIES', 'Grade categories']]} selected={dataset} setSelected={setDataset} />
      {dataset === 'TEMPLATES' ? <ProgressiveAdminResourcePanel<GradingTemplate> api={api} columns={[{ header: 'Name', render: (item) => item.name }, { header: 'Default', render: (item) => item.is_default ? 'Yes' : 'No' }, { header: 'Items', render: (item) => item.items.length }]} endpoint="/grades/templates/" fields={templateFields} noun="Template" query={query} queryKey={['grade-setup', 'templates']} setQuery={setQuery} title="Grading Templates" /> : null}
      {dataset === 'POLICIES' ? <ProgressiveAdminResourcePanel<SubjectGradingPolicy> api={api} columns={[{ header: 'Subject', render: (item) => item.subject_label ?? `Subject #${item.subject}` }, { header: 'Formula', render: (item) => `${item.transmutation_base} + raw × ${item.transmutation_scale}` }, { header: 'Period weights', render: (item) => `${item.prelim_weight}/${item.midterm_weight}/${item.prefinal_weight}/${item.final_weight}` }]} endpoint="/grades/subject-policies/" fields={subjectPolicyFields()} noun="Subject grading policy" query={query} queryKey={['grade-setup', 'policies']} setQuery={setQuery} title="Subject Grading Policies" /> : null}
      {dataset === 'TEMPLATE_ITEMS' ? <ProgressiveAdminResourcePanel<GradingTemplateItem> api={api} columns={[{ header: 'Template', render: (item) => item.template_label ?? `Template #${item.template}` }, { header: 'Period', render: (item) => item.grading_period }, { header: 'Category', render: (item) => item.category }, { header: 'Weight', render: (item) => `${numeric(item.weight)}%` }]} endpoint="/grades/template-items/" fields={templateItemFields()} noun="Template item" query={query} queryKey={['grade-setup', 'template-items']} setQuery={setQuery} title="Template Items" /> : null}
      {dataset === 'CATEGORIES' ? <ProgressiveAdminResourcePanel<GradeCategory> api={api} columns={[{ header: 'Subject', render: (item) => item.subject_label ?? `Subject #${item.subject}` }, { header: 'Period', render: (item) => item.grading_period }, { header: 'Name', render: (item) => item.name }, { header: 'Weight', render: (item) => `${numeric(item.weight)}%` }]} endpoint="/grades/categories/" fields={gradeCategoryFields()} noun="Grade category" query={query} queryKey={['grade-setup', 'categories']} setQuery={setQuery} title="Grade Categories" /> : null}
      {dataset === 'TEMPLATES' ? <ApplyTemplatePanel api={api} /> : null}
    </>
  )
}

function ApplyTemplatePanel({ api }: { api: AuthedRequest }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const subjects = useQuery({ queryKey: ['apply-template-subjects'], queryFn: ({ signal }) => api<ApiList<Subject>>('/subjects/subjects/?limit=20', { signal }), enabled: open, staleTime: 300_000 })
  const templates = useQuery({ queryKey: ['apply-template-options'], queryFn: ({ signal }) => api<ApiList<GradingTemplate>>('/grades/templates/?limit=20', { signal }), enabled: open, staleTime: 300_000 })
  const [subject, setSubject] = useState('')
  const [template, setTemplate] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await api(`/grades/templates/${template}/apply-to-subject/`, { method: 'POST', body: JSON.stringify({ subject: Number(subject) }) })
      setMessage('Template applied.')
      await queryClient.invalidateQueries({ queryKey: ['grade-setup'] })
      await queryClient.invalidateQueries({ queryKey: ['teacher-grades-overview'] })
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="section-block">
      <SectionHeading title="Apply template" subtitle="Copy a configured grading structure to one subject." action={<button className="button button--secondary button--compact" onClick={() => setOpen((current) => !current)} type="button">{open ? 'Close' : 'Choose template'}</button>} />
      {open ? <form className="admin-inline-form" onSubmit={submit}><label className="admin-field"><span>Template</span><select disabled={templates.isPending} onChange={(event) => setTemplate(event.target.value)} required value={template}><option value="">Select</option>{asArray(templates.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="admin-field"><span>Subject</span><select disabled={subjects.isPending} onChange={(event) => setSubject(event.target.value)} required value={subject}><option value="">Select</option>{asArray(subjects.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} {item.name}</option>)}</select></label><button className="button button--primary" disabled={saving} type="submit"><Icon name="save" /><span>{saving ? 'Applying...' : 'Apply'}</span></button>{message ? <p className="admin-message" role="status">{message}</p> : null}</form> : null}
    </section>
  )
}

function GradeClassCard({ card }: { card: TeacherClassGradeSummary }) {
  const schedule = card.schedule
  return <article className="grade-class-card"><div className="grade-class-card__header"><span className="grade-class-card__icon"><Icon name="grade" /></span><div><strong>{schedule.subject_code} {schedule.section || 'No section'}</strong><span>{schedule.subject_name}</span></div><span className={card.weights_ready ? 'grade-setup-badge grade-setup-badge--ready' : 'grade-setup-badge'}>{card.weights_ready ? 'Setup ready' : `${card.configured_period_count}/4 periods set`}</span></div><dl className="grade-class-card__meta"><div><dt>Students</dt><dd>{card.active_student_count}</dd></div><div><dt>Grade items</dt><dd>{card.grade_item_count}</dd></div><div><dt>Pending</dt><dd>{card.pending_item_count}</dd></div></dl><div className="grade-class-card__progress"><div><span>Period completion</span><strong>{card.completion_percent}%</strong></div><div className="progress-line"><span style={{ width: `${card.completion_percent}%` }} /></div><small>{card.completed_period_count} of {card.expected_period_count} student-period records complete</small></div><div className="grade-class-card__footer"><span><Icon name="calendar" /> {schedule.term_name}</span><Link className="button button--primary button--compact" to={`/admin/classes?schedule=${schedule.id}`}><span>Open class</span><Icon name="arrow-right" /></Link></div></article>
}

function HubTab({ active, icon, label, onClick }: { active: boolean; icon: 'dashboard' | 'edit'; label: string; onClick: () => void }) {
  return <button aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} onClick={onClick} type="button"><Icon name={icon} /><span>{label}</span></button>
}

function SubTabs<T extends string>({ items, selected, setSelected }: { items: Array<[T, string]>; selected: T; setSelected: (value: T) => void }) {
  return <nav aria-label="Grade dataset" className="grade-dataset-tabs">{items.map(([value, label]) => <button aria-current={selected === value ? 'page' : undefined} className={selected === value ? 'active' : ''} key={value} onClick={() => setSelected(value)} type="button">{label}</button>)}</nav>
}

type DatasetProps<T extends string> = { api: AuthedRequest; dataset: T; query: string; setDataset: (value: T) => void; setQuery: (value: string) => void }

function normalizeDataset<T extends string>(value: string, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? value as T : fallback
}

function pageOffset(next: number | string | null) {
  if (typeof next === 'number') return next
  if (!next) return undefined
  try {
    const offset = new URL(next).searchParams.get('offset')
    return offset === null ? undefined : Number(offset)
  } catch {
    return undefined
  }
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debounced
}

const templateFields: AdminField<GradingTemplate>[] = [
  { label: 'Name', name: 'name', required: true, type: 'text' },
  { label: 'Description', name: 'description', rows: 3, type: 'textarea' },
  { defaultValue: false, label: 'Default', name: 'is_default', type: 'checkbox' },
  ...['transmutation_base', 'transmutation_scale', 'prelim_weight', 'midterm_weight', 'prefinal_weight', 'final_weight'].map((name) => ({ defaultValue: name.includes('weight') ? '25.00' : name === 'transmutation_base' ? '60.00' : '40.00', label: name.replaceAll('_', ' '), name, required: true, type: 'number' as const })),
]

function subjectPolicyFields() {
  return [{ label: 'Subject', name: 'subject', parse: Number, required: true, type: 'select' }, { label: 'Source template', name: 'source_template', nullable: true, parse: (value: unknown) => value ? Number(value) : null, type: 'select' }, { defaultValue: '60.00', label: 'Transmutation base', name: 'transmutation_base', required: true, type: 'number' }, { defaultValue: '40.00', label: 'Transmutation scale', name: 'transmutation_scale', required: true, type: 'number' }, ...['prelim_weight', 'midterm_weight', 'prefinal_weight', 'final_weight'].map((name) => ({ defaultValue: '25.00', label: name.replaceAll('_', ' '), name, required: true, type: 'number' as const }))] satisfies AdminField<SubjectGradingPolicy>[]
}

function templateItemFields() {
  return [{ label: 'Template', name: 'template', parse: Number, required: true, type: 'select' }, { defaultValue: 'PRELIM', label: 'Period', name: 'grading_period', options: gradingPeriodOptions, required: true, type: 'select' }, { defaultValue: 'QUIZ', label: 'Category', name: 'category', options: gradeCategoryOptions, required: true, type: 'select' }, { label: 'Name', name: 'name', required: true, type: 'text' }, { defaultValue: '0.00', label: 'Weight', name: 'weight', required: true, type: 'number' }] satisfies AdminField<GradingTemplateItem>[]
}

function gradeCategoryFields() {
  return [{ label: 'Subject', name: 'subject', parse: Number, required: true, type: 'select' }, { label: 'Template item', name: 'template_item', nullable: true, parse: (value: unknown) => value ? Number(value) : null, type: 'select' }, { defaultValue: 'PRELIM', label: 'Period', name: 'grading_period', options: gradingPeriodOptions, required: true, type: 'select' }, { defaultValue: 'QUIZ', label: 'Category', name: 'category', options: gradeCategoryOptions, required: true, type: 'select' }, { label: 'Name', name: 'name', required: true, type: 'text' }, { defaultValue: '0.00', label: 'Weight', name: 'weight', required: true, type: 'number' }] satisfies AdminField<GradeCategory>[]
}
