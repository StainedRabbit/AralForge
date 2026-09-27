import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api'
import type { AuthedRequest } from '../../app/types'
import type { CursorPage, StudentProfile } from '../../types'
import { Page, PageHeader } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { fullRecordName } from '../../utils/student'
import { countReplacementCharacters, replacementCharacterWarning } from '../../utils/textFile'
import { toErrorMessage } from '../../utils/format'
import './students.css'

type Props = { api: AuthedRequest }
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

export function AdminStudentsPage({ api }: Props) {
  const [query, setQuery] = useState('')
  const search = useDebounced(query)
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
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
  })
  const profiles = directory.data?.pages.flatMap((page) => page.results) ?? []
  const refreshStudents = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['student-directory'] })
  }, [queryClient])

  return <div className="students-page"><Page>
    <PageHeader eyebrow="People and access" title="Students"
      description="Find students by name or student number, and add new accounts."
      actions={<button className="button button--primary" onClick={() => setCreating(true)} type="button"><Icon name="plus" />Add student</button>} />
    <section className="students-directory" aria-label="Student list">
      <div className="students-directory__toolbar">
        <label className="admin-search"><Icon name="search" /><input type="search" aria-label="Search students"
          placeholder="Search name or student number" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label className="students-filter">Profile status<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All profiles</option><option value="active">Active profiles</option><option value="inactive">Inactive profiles</option>
        </select></label>
      </div>
      <div className="students-directory__caption"><strong>Student list</strong><span aria-live="polite">{profiles.length} students shown{directory.isFetching ? ' · Updating...' : ''}</span></div>
      {directory.isPending ? <p className="students-feedback" role="status">Loading students...</p> : null}
      {directory.isError ? <Feedback error={directory.error} retry={() => { void (directory.isFetchNextPageError ? directory.fetchNextPage() : directory.refetch()) }} /> : null}
      {profiles.length ? <table className="students-table"><thead><tr><th>Student</th><th>Student number</th><th>Email</th><th>Profile</th><th>Account</th></tr></thead>
        <tbody>{profiles.map((profile) => <tr key={profile.id}>
          <td data-label="Student"><StudentName profile={profile} /></td>
          <td data-label="Student number">{profile.student_number}</td>
          <td data-label="Email">{profile.user_detail?.email || 'Not provided'}</td>
          <td data-label="Profile"><ActivityBadge active={profile.is_active} /></td>
          <td data-label="Account">{profile.user_detail ? <ActivityBadge active={profile.user_detail.is_active} /> : 'Unavailable'}</td>
        </tr>)}</tbody></table> : !directory.isPending && !directory.isError ? <div className="students-feedback">
          <Icon name="users" /><h2>{search || status !== 'all' ? 'No matching students' : 'No students yet'}</h2>
          <p>{search || status !== 'all' ? 'Try another name, student number, or profile filter.' : 'Add your first student to start the list.'}</p>
          {search || status !== 'all' ? <button type="button" className="button button--secondary" onClick={() => { setQuery(''); setStatus('all') }}>Clear filters</button>
            : <button type="button" className="button button--primary" onClick={() => setCreating(true)}>Add student</button>}
        </div> : null}
      {directory.hasNextPage ? <div className="students-load-more"><button className="button button--secondary" type="button" disabled={directory.isFetching} onClick={() => void directory.fetchNextPage()}>{directory.isFetchingNextPage ? 'Loading...' : 'Load more'}</button></div> : null}
    </section>
    {creating ? <StudentDialog onClose={() => setCreating(false)}><CreateStudent api={api} onSaved={refreshStudents} /></StudentDialog> : null}
  </Page></div>
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

function StudentDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const states = useRef(new Map<string, FormState>())
  const [busy, setBusy] = useState(false)
  const report = useCallback((id: string, state: FormState | null) => {
    if (state) states.current.set(id, state)
    else states.current.delete(id)
    setBusy([...states.current.values()].some((form) => form.busy))
  }, [])
  const titleId = useId()
  const canLeave = useCallback(() => {
    const values = [...states.current.values()]
    if (values.some((state) => state.busy)) return false
    return !values.some((state) => state.dirty) || window.confirm('Discard unsaved changes?')
  }, [])
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement as HTMLElement | null
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
        if (previousFocus?.isConnected) previousFocus.focus()
        else document.querySelector<HTMLElement>('[aria-label="Search students"]')?.focus()
      })
    }
  }, [])
  return <GuardContext.Provider value={report}>
    <dialog ref={ref} className="students-drawer" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (canLeave()) onClose() }}>
      <header className="students-drawer__header"><h2 id={titleId}>Add student</h2>
        <button type="button" className="icon-button" aria-label="Close student panel" disabled={busy} onClick={() => { if (canLeave()) onClose() }}><Icon name="close" /></button></header>
      <div className="students-drawer__body">{children}</div>
    </dialog>
  </GuardContext.Provider>
}

type Draft = Record<string, string | boolean>
type Field = { name: string; label: string; type?: 'email'; maxLength?: number; required?: boolean; personName?: boolean }
const nameFields: Field[] = [
  { name: 'first_name', label: 'First name', maxLength: 150, personName: true },
  { name: 'middle_name', label: 'Middle name (optional)', maxLength: 150, personName: true },
  { name: 'last_name', label: 'Last name', maxLength: 150, personName: true },
  { name: 'email', label: 'Email', type: 'email' },
]
const studentNumberField: Field = { name: 'student_number', label: 'Student number', maxLength: 30, required: true }

function StudentForm({ title, description, fields, initial, api, onSaved }: {
  title: string; description: string; fields: Field[]; initial: Draft; api: AuthedRequest;
  onSaved: (value: unknown) => Promise<void>
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
      const value = await api<Record<string, unknown>>('/accounts/students/', { method: 'POST', body: JSON.stringify(draft) })
      const saved = Object.fromEntries(Object.entries(draft).map(([key, old]) => [key,
        typeof value[key] === 'string' || typeof value[key] === 'boolean' ? value[key] as string | boolean : old]))
      setDraft(saved); setBaseline(saved)
      await onSaved(value)
      setMessage('Student account created.')
    } catch (error) {
      const nextErrors = fieldErrors(error)
      setErrors(nextErrors)
      setMessage(fields.some((field) => nextErrors[field.name]) ? 'Please correct the highlighted fields.' : toErrorMessage(error))
    }
    finally { setBusy(false) }
  }
  return <form className="students-form" onSubmit={submit} aria-label={title}>
    <div><h3>{title}</h3><p>{description}</p></div>
    <div className="students-form__fields">{fields.map((field) => {
      const error = nameErrors[field.name] || errors[field.name]
      return <label className="admin-field" key={field.name}>
        <span>{field.label}</span>
        <input type={field.type ?? 'text'} aria-label={field.label} disabled={busy} required={field.required} maxLength={field.maxLength}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-${field.name}` : undefined}
          value={String(draft[field.name] ?? '')}
          onChange={(e) => { setDraft((current) => ({ ...current, [field.name]: e.target.value })); setErrors((current) => ({ ...current, [field.name]: '' })); setMessage('') }} />
        {error ? <small id={`${id}-${field.name}`} className="student-create-field-error">{error}</small> : null}
      </label>
    })}</div>
    {message ? <p role="status" className="admin-message">{message}</p> : null}
    <div className="students-form__footer"><button className="button button--primary" type="submit" disabled={busy || Object.values(nameErrors).some(Boolean)}>{busy ? 'Saving...' : 'Create student'}</button>
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
  return <StudentForm title="New student" description="Create a student account. The student can set a secure password after their first sign-in."
    fields={[studentNumberField, ...nameFields]} initial={{ first_name: '', middle_name: '', last_name: '', email: '', student_number: '', is_active: true }}
    api={api}
    onSaved={async (value) => { setCreated(value as StudentProfile); await onSaved() }} />
}
