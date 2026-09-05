import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, asArray } from '../../api'
import type { AuthedRequest, RouteData } from '../../app/types'
import type { ApiList, CursorPage, ScheduleStudent, StudentProfile, SubjectSchedule, User } from '../../types'
import { Page, PageHeader } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { ManageStudentModulesDialog } from '../../components/admin/ManageStudentModulesDialog'
import { usePaginatedResource, useScopedWorkspace } from '../../queries/useScopedWorkspace'
import { queryKeys } from '../../queries/queryKeys'
import { fullRecordName } from '../../utils/student'
import { countReplacementCharacters, replacementCharacterWarning } from '../../utils/textFile'
import { toErrorMessage } from '../../utils/format'
import { StudentAdvancedTools } from './StudentAdvancedTools'
import './students.css'

type Props = { api: AuthedRequest; data: RouteData; refresh: () => Promise<void> }
type FormState = { dirty: boolean; busy: boolean }
const GuardContext = createContext<(id: string, state: FormState | null) => void>(() => {})

function useFormGuard(dirty: boolean, busy: boolean) {
  const report = useContext(GuardContext)
  const id = useId()
  useEffect(() => { report(id, { dirty, busy }); return () => report(id, null) }, [report, id, dirty, busy])
}

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [value])
  return debounced
}

export function StudentTabs({ label, tabs, value, onChange }: {
  label: string; tabs: string[]; value: string; onChange: (value: string) => void | boolean
}) {
  const id = useId()
  return <div className="students-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab} id={`${id}-${index}`} type="button" role="tab"
      aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
      onClick={() => onChange(tab)} onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
        if (next === null) return
        event.preventDefault()
        if (onChange(tabs[next]) === false) return
        document.getElementById(`${id}-${next}`)?.focus()
      }}>{tab}</button>)}
  </div>
}

export function AdminStudentsPage({ api, data }: Props) {
  const [tab, setTab] = useState('Students')
  const [query, setQuery] = useState('')
  const search = useDebounced(query)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<StudentProfile | null>(null)
  const [creating, setCreating] = useState(false)
  const advancedForms = useRef(new Map<string, FormState>())
  const reportAdvanced = useCallback((id: string, state: FormState | null) => {
    if (state) advancedForms.current.set(id, state)
    else advancedForms.current.delete(id)
  }, [])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ([...advancedForms.current.values()].some((state) => state.dirty || state.busy)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [])
  const queryClient = useQueryClient()
  const directory = useInfiniteQuery({
    queryKey: ['student-directory', search, status],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ pagination: 'cursor', limit: '30', search, status })
      if (pageParam) params.set('cursor', pageParam)
      return api<CursorPage<StudentProfile>>(`/accounts/students/?${params}`, { signal })
    },
    getNextPageParam: (page) => page.next ? new URL(page.next, window.location.origin).searchParams.get('cursor') ?? undefined : undefined,
    enabled: tab === 'Students',
  })
  const profiles = directory.data?.pages.flatMap((page) => page.results) ?? []
  const refreshStudents = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['student-directory'] }),
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'resource' &&
        ['/accounts/', '/subjects/schedule-students/', '/modules/access/'].some((prefix) => String(q.queryKey[1]).startsWith(prefix)) }),
    ])
  }, [queryClient])

  return <div className="students-page"><Page>
    <PageHeader eyebrow="People and access" title="Students"
      description="Find a student. Keep their details, classes, and learning access in one place."
      actions={<button className="button button--primary" onClick={() => setCreating(true)} type="button"><Icon name="plus" />Add student</button>} />
    <StudentTabs label="Student workspace" tabs={['Students', 'Advanced tools']} value={tab} onChange={(next) => {
      if (next !== tab) {
        const forms = [...advancedForms.current.values()]
        if (forms.some((form) => form.busy) || (forms.some((form) => form.dirty) && !window.confirm('Discard unsaved changes?'))) return false
      }
      setTab(next)
    }} />
    {tab === 'Advanced tools' ? <StudentResources api={api} data={data}>{(resources) =>
      <StudentAdvancedTools api={api} data={resources} refresh={refreshStudents} onFormStateChange={reportAdvanced} />
    }</StudentResources> : <section className="students-directory" aria-label="Student directory">
      <div className="students-directory__toolbar">
        <label className="admin-search"><Icon name="search" /><input type="search" aria-label="Search students"
          placeholder="Search name or student number" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label className="students-filter">Profile status<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All profiles</option><option value="active">Active profiles</option><option value="inactive">Inactive profiles</option>
        </select></label>
      </div>
      <div className="students-directory__caption"><strong>Student directory</strong><span aria-live="polite">{profiles.length} students shown{directory.isFetching ? ' · Updating...' : ''}</span></div>
      {directory.isPending ? <p className="students-feedback" role="status">Loading students...</p> : null}
      {directory.isError ? <Feedback error={directory.error} retry={() => { void (directory.isFetchNextPageError ? directory.fetchNextPage() : directory.refetch()) }} /> : null}
      {profiles.length ? <table className="students-table"><thead><tr><th>Student</th><th>Student number</th><th>Email</th><th>Profile</th><th>Account</th><th><span className="students-sr-only">Actions</span></th></tr></thead>
        <tbody>{profiles.map((profile) => <tr key={profile.id}>
          <td data-label="Student"><StudentName profile={profile} /></td>
          <td data-label="Student number">{profile.student_number}</td>
          <td data-label="Email">{profile.user_detail?.email || 'Not provided'}</td>
          <td data-label="Profile"><ActivityBadge active={profile.is_active} /></td>
          <td data-label="Account">{profile.user_detail ? <ActivityBadge active={profile.user_detail.is_active} /> : 'Unavailable'}</td>
          <td data-label="Actions"><button className="button button--secondary button--compact" type="button" data-student-trigger={profile.id} aria-label={`View ${profile.student_number}`} onClick={() => setSelected(profile)}>View student</button></td>
        </tr>)}</tbody></table> : !directory.isPending && !directory.isError ? <div className="students-feedback">
          <Icon name="users" /><h2>{search || status !== 'all' ? 'No matching students' : 'Your student directory starts here'}</h2>
          <p>{search || status !== 'all' ? 'Try another name, student number, or profile filter.' : 'Add your first student to manage their details and access.'}</p>
          {search || status !== 'all' ? <button type="button" className="button button--secondary" onClick={() => { setQuery(''); setStatus('all') }}>Clear filters</button>
            : <button type="button" className="button button--primary" onClick={() => setCreating(true)}>Add student</button>}
        </div> : null}
      {directory.hasNextPage ? <div className="students-load-more"><button className="button button--secondary" type="button" disabled={directory.isFetching} onClick={() => void directory.fetchNextPage()}>{directory.isFetchingNextPage ? 'Loading...' : 'Load more'}</button></div> : null}
    </section>}
    {creating ? <StudentDialog title="Add student" onClose={() => setCreating(false)}><CreateStudent api={api} onSaved={refreshStudents} /></StudentDialog> : null}
    {selected ? <StudentDialog title="Student details" onClose={() => setSelected(null)}>
      <StudentDetail api={api} data={data} initial={selected} onSaved={refreshStudents} />
    </StudentDialog> : null}
  </Page></div>
}

function StudentResources({ api, data, children }: { api: AuthedRequest; data: RouteData; children: (data: RouteData) => ReactNode }) {
  const resources = useScopedWorkspace(api, ['subjects', 'modules'], data.currentUser!, data.profile)
  if (resources.loading) return <p role="status" className="students-feedback">Loading tools...</p>
  if (resources.error) return <Feedback error={resources.error} retry={() => void resources.refresh()} />
  return children(resources)
}

function StudentName({ profile }: { profile: StudentProfile }) {
  const user = profile.user_detail
  const count = countReplacementCharacters(`${user?.first_name ?? ''}${user?.middle_name ?? ''}${user?.last_name ?? ''}`)
  return <div className="students-name"><strong>{user ? fullRecordName(user) : profile.student_number}</strong>
    {count ? <small className="name-correction-warning">Name needs correction.</small> : null}</div>
}

function ActivityBadge({ active }: { active: boolean }) {
  return <span className={`students-badge${active ? ' students-badge--active' : ''}`}>{active ? 'Active' : 'Inactive'}</span>
}

function Feedback({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="students-feedback" role="alert"><p>{typeof error === 'string' ? error : toErrorMessage(error)}</p><button className="button button--secondary" type="button" onClick={retry}>Retry</button></div>
}

function StudentDialog({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const states = useRef(new Map<string, FormState>())
  const report = useCallback((id: string, state: FormState | null) => { if (state) states.current.set(id, state); else states.current.delete(id) }, [])
  const titleId = useId()
  const canLeave = useCallback(() => {
    const values = [...states.current.values()]
    if (values.some((state) => state.busy)) return false
    return !values.some((state) => state.dirty) || window.confirm('Discard unsaved changes?')
  }, [])
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement as HTMLElement | null
    const studentTrigger = previousFocus?.getAttribute('data-student-trigger')
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    const unload = (event: BeforeUnloadEvent) => {
      if ([...states.current.values()].some((state) => state.dirty || state.busy)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      dialog.close(); document.body.style.overflow = previousOverflow; window.removeEventListener('beforeunload', unload)
      window.requestAnimationFrame(() => {
        const target = studentTrigger ? document.querySelector<HTMLElement>(`[data-student-trigger="${studentTrigger}"]`) : previousFocus
        if (target?.isConnected) target.focus()
        else document.querySelector<HTMLElement>('[aria-label="Search students"]')?.focus()
      })
    }
  }, [])
  return <GuardContext.Provider value={report}><LeaveContext.Provider value={canLeave}>
    <dialog ref={ref} className="students-drawer" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (canLeave()) onClose() }}>
      <header className="students-drawer__header"><div><h2 id={titleId}>{title}</h2>{subtitle ? <span>{subtitle}</span> : null}</div>
        <button type="button" className="icon-button" aria-label="Close student panel" onClick={() => { if (canLeave()) onClose() }}><Icon name="close" /></button></header>
      <div className="students-drawer__body">{children}</div>
    </dialog>
  </LeaveContext.Provider></GuardContext.Provider>
}

const LeaveContext = createContext<() => boolean>(() => true)

function StudentDetail({ api, data, initial, onSaved }: { api: AuthedRequest; data: RouteData; initial: StudentProfile; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState('Details')
  const canLeave = useContext(LeaveContext)
  const path = `/accounts/students/${initial.id}/`
  const detail = useQuery({ queryKey: queryKeys.resource(path), queryFn: ({ signal }) => api<StudentProfile>(path, { signal }) })
  const profile = detail.data ?? initial
  const user = profile.user_detail
  const queryClient = useQueryClient()
  async function saved(savedUser?: User, savedProfile?: StudentProfile) {
    queryClient.setQueryData(queryKeys.resource(path), savedProfile ?? { ...profile, user_detail: savedUser ?? user })
    await onSaved()
  }
  return <>
    <div className="students-identity"><div className="students-avatar"><Icon name="users" /></div><div><StudentName profile={profile} /><p>{profile.student_number}</p></div></div>
    <StudentTabs label="Student detail sections" tabs={['Details', 'Enrollments', 'Modules']} value={tab} onChange={(next) => { if (next !== tab && !canLeave()) return false; setTab(next) }} />
    {detail.isPending ? <p role="status">Loading student details...</p> : detail.isError ? <Feedback error={detail.error} retry={() => void detail.refetch()} /> : !user ? <p role="alert">Account details are unavailable.</p> : tab === 'Details' ? <div className="students-details">
      <StudentForm key={`account-${user.id}`} title="Account details" fields={accountFields} initial={accountDraft(user)} api={api} endpoint={`/accounts/users/${user.id}/`} method="PATCH"
        onSaved={(value) => saved(value as User)} success="Account details saved." />
      <StudentForm key={`profile-${profile.id}`} title="Student profile" fields={profileFields} initial={{ student_number: profile.student_number, is_active: profile.is_active }} api={api} endpoint={path} method="PATCH"
        description={`Changing the student number also changes the login username.${user.must_change_password ? ' This student still needs to change their password, so their temporary password will also become the new student number.' : ' Their existing password stays the same.'}`}
        onSaved={(value) => saved(undefined, value as StudentProfile)} success="Student profile saved." />
    </div> : tab === 'Enrollments' ? <StudentEnrollments api={api} studentId={profile.user} onSaved={onSaved} />
      : <StudentResources api={api} data={data}>{(resources) => <StudentModules api={api} data={resources} profile={profile} onSaved={onSaved} />}</StudentResources>}
  </>
}

function StudentModules({ api, data, profile, onSaved }: { api: AuthedRequest; data: RouteData; profile: StudentProfile; onSaved: () => Promise<void> }) {
  const report = useContext(GuardContext)
  const id = useId()
  const stateChanged = useCallback((state: FormState) => report(id, state), [id, report])
  useEffect(() => () => report(id, null), [id, report])
  return <ManageStudentModulesDialog api={api} data={data} embedded onClose={() => {}} studentId={profile.user}
    studentName={fullRecordName(profile.user_detail ?? null)} onFormStateChange={stateChanged} onSaved={onSaved} />
}

type Draft = Record<string, string | boolean>
type Field = { name: string; label: string; type?: 'email' | 'checkbox'; maxLength?: number; required?: boolean; personName?: boolean }
const nameFields: Field[] = [
  { name: 'first_name', label: 'First name', maxLength: 150, personName: true },
  { name: 'middle_name', label: 'Middle name (optional)', maxLength: 150, personName: true },
  { name: 'last_name', label: 'Last name', maxLength: 150, personName: true },
  { name: 'email', label: 'Email', type: 'email' },
]
const accountFields: Field[] = [...nameFields, { name: 'is_active', label: 'Account active (can sign in)', type: 'checkbox' }]
const profileFields: Field[] = [{ name: 'student_number', label: 'Student number', maxLength: 30, required: true }, { name: 'is_active', label: 'Profile active', type: 'checkbox' }]
function accountDraft(user: User): Draft { return { first_name: user.first_name, middle_name: user.middle_name ?? '', last_name: user.last_name, email: user.email, is_active: user.is_active } }

function StudentForm({ title, description, fields, initial, api, endpoint, method, onSaved, success, submitLabel }: {
  title: string; description?: string; fields: Field[]; initial: Draft; api: AuthedRequest; endpoint: string; method: 'PATCH' | 'POST';
  onSaved: (value: unknown) => Promise<void>; success: string; submitLabel?: string
}) {
  const [draft, setDraft] = useState(initial)
  const [baseline, setBaseline] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const id = useId()
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  useFormGuard(dirty, busy)
  const nameErrors = Object.fromEntries(fields.filter((field) => field.personName).map((field) => {
    const count = countReplacementCharacters(String(draft[field.name] ?? ''))
    return [field.name, count ? replacementCharacterWarning(count) : '']
  }))
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || Object.values(nameErrors).some(Boolean)) return
    setBusy(true); setErrors({}); setMessage('')
    try {
      const value = await api<Record<string, unknown>>(endpoint, { method, body: JSON.stringify(draft) })
      const saved = Object.fromEntries(Object.entries(draft).map(([key, old]) => [key,
        typeof value[key] === 'string' || typeof value[key] === 'boolean' ? value[key] as string | boolean : old]))
      setDraft(saved); setBaseline(saved); setMessage(success)
      await onSaved(value)
    } catch (error) {
      const nextErrors = fieldErrors(error)
      setErrors(nextErrors)
      setMessage(fields.some((field) => nextErrors[field.name]) ? 'Please correct the highlighted fields.' : toErrorMessage(error))
    }
    finally { setBusy(false) }
  }
  return <form className="students-form" onSubmit={submit} aria-label={title}>
    <div><h3>{title}</h3>{description ? <p>{description}</p> : null}</div>
    <div className="students-form__fields">{fields.map((field) => {
      const error = nameErrors[field.name] || errors[field.name]
      return <label className={field.type === 'checkbox' ? 'admin-check' : 'admin-field'} key={field.name}>
        {field.type !== 'checkbox' ? <span>{field.label}</span> : null}
        <input type={field.type ?? 'text'} aria-label={field.label} disabled={busy} required={field.required} maxLength={field.maxLength}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-${field.name}` : undefined}
          checked={field.type === 'checkbox' ? Boolean(draft[field.name]) : undefined}
          value={field.type === 'checkbox' ? undefined : String(draft[field.name] ?? '')}
          onChange={(e) => { setDraft((current) => ({ ...current, [field.name]: field.type === 'checkbox' ? e.target.checked : e.target.value })); setErrors((current) => ({ ...current, [field.name]: '' })); setMessage('') }} />
        {field.type === 'checkbox' ? <span>{field.label}</span> : null}
        {error ? <small id={`${id}-${field.name}`} className="student-create-field-error">{error}</small> : null}
      </label>
    })}</div>
    {message ? <p role="status" className="admin-message">{message}</p> : null}
    <div className="students-form__footer"><button className="button button--primary" type="submit" disabled={busy || Object.values(nameErrors).some(Boolean) || (method === 'PATCH' && !dirty)}>{busy ? 'Saving...' : submitLabel ?? 'Save changes'}</button>
      {dirty ? <small>Unsaved changes</small> : null}</div>
  </form>
}

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return {}
  return Object.fromEntries(Object.entries(error.data).map(([key, value]) => [key, Array.isArray(value) ? value.join(' ') : String(value)]))
}

function CreateStudent({ api, onSaved }: { api: AuthedRequest; onSaved: () => Promise<void> }) {
  const [created, setCreated] = useState<StudentProfile | null>(null)
  if (created) return <div className="students-created" role="status"><div className="students-avatar"><Icon name="check" /></div><h3>Student account created</h3><StudentName profile={created} />
    <p>The initial username and password are the student number.</p><dl><dt>Username and temporary password</dt><dd>{created.student_number}</dd></dl><p>The student must create a secure password after their first sign-in.</p>
    <button className="button button--secondary" type="button" onClick={() => setCreated(null)}>Add another student</button></div>
  return <StudentForm title="New student" description="Create an account, then add classes and module access from the student directory."
    fields={[profileFields[0], ...nameFields]} initial={{ first_name: '', middle_name: '', last_name: '', email: '', student_number: '', is_active: true }}
    api={api} endpoint="/accounts/students/" method="POST" success="Student account created." submitLabel="Create student"
    onSaved={async (value) => { setCreated(value as StudentProfile); await onSaved() }} />
}

function StudentEnrollments({ api, studentId, onSaved }: { api: AuthedRequest; studentId: number; onSaved: () => Promise<void> }) {
  const query = usePaginatedResource<ScheduleStudent>(api, `/subjects/schedule-students/?student=${studentId}`)
  const [editing, setEditing] = useState<ScheduleStudent | null>(null)
  const [schedule, setSchedule] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  const schedules = useQuery({ queryKey: ['student-schedule-options', debounced], queryFn: ({ signal }) => api<ApiList<SubjectSchedule>>(`/subjects/subject-schedules/?status=active&limit=20&search=${encodeURIComponent(debounced)}`, { signal }) })
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dirty = schedule !== (editing ? String(editing.schedule) : '') || active !== (editing?.is_active ?? true)
  useFormGuard(dirty, busy)
  function reset() { setEditing(null); setSchedule(''); setActive(true); setSearch('') }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage('')
    try {
      await api(`/subjects/schedule-students/${editing ? `${editing.id}/` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ student: studentId, schedule: Number(schedule), is_active: active }) })
      reset(); setMessage('Enrollment saved.'); await query.refetch(); await onSaved()
    } catch (error) { setMessage(Object.values(fieldErrors(error)).join(' ') || toErrorMessage(error)) } finally { setBusy(false) }
  }
  const options = asArray(schedules.data ?? []).filter((option) =>
    !query.data?.some((enrollment) => enrollment.schedule === option.id && enrollment.id !== editing?.id))
  const formRef = useRef<HTMLFormElement>(null)
  return <div className="students-details">
    {query.isPending ? <p role="status">Loading enrollments...</p> : query.isError ? <Feedback error={query.error} retry={() => void query.refetch()} /> : <section className="students-enrollments" aria-label="Student enrollments">
      <h3>Class enrollments</h3>{query.data?.length ? query.data.map((enrollment) => <article key={enrollment.id}><div><strong>{enrollment.subject_code}</strong><p>{enrollment.schedule_display} · {enrollment.term_name}</p><ActivityBadge active={enrollment.is_active} /></div>
        <button type="button" className="button button--secondary" disabled={busy} onClick={() => {
          if (dirty && !window.confirm('Discard unsaved enrollment changes?')) return
          setEditing(enrollment); setSchedule(String(enrollment.schedule)); setActive(enrollment.is_active); setMessage('')
          formRef.current?.scrollIntoView({ block: 'start' }); formRef.current?.querySelector('input')?.focus()
        }}>Edit enrollment</button></article>) : <p>No class enrollments yet.</p>}
    </section>}
    <form className="students-form" ref={formRef} onSubmit={save} aria-label="Enrollment details"><h3>{editing ? 'Edit enrollment' : 'Add enrollment'}</h3>
      <label className="admin-field"><span>Search class schedules</span><input type="search" disabled={busy} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Subject, section, or room" /></label>
      {schedules.isError ? <Feedback error={schedules.error} retry={() => void schedules.refetch()} /> : null}
      <label className="admin-field"><span>Class schedule</span><select aria-label="Class schedule" required disabled={busy} value={schedule} onChange={(e) => setSchedule(e.target.value)}><option value="">{schedules.isFetching ? 'Loading schedules...' : 'Select a class schedule'}</option>
        {schedule && !options.some((option) => String(option.id) === schedule) ? <option value={schedule}>{editing?.schedule_display ?? `Selected schedule #${schedule}`}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.subject_code} {option.section} · {option.term_name} · {option.days}</option>)}</select></label>
      <label className="admin-check"><input type="checkbox" disabled={busy} checked={active} onChange={(e) => setActive(e.target.checked)} />Enrollment active</label>
      {message ? <p role="status" className="admin-message">{message}</p> : null}
      <div className="students-form__footer"><button className="button button--primary" type="submit" disabled={busy || !schedule || (Boolean(editing) && !dirty)}>{busy ? 'Saving...' : 'Save enrollment'}</button>
        {editing ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved enrollment changes?')) reset() }}>Cancel edit</button> : null}</div>
    </form>
  </div>
}
