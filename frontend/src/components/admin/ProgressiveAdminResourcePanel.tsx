import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthedRequest } from '../../app/types'
import type { ApiList } from '../../types'
import { asArray } from '../../api'
import { toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'
import type { AdminColumn, AdminField } from './AdminResourcePanel'
import { SectionHeading } from '../ui'

type DraftValue = boolean | File | null | string | string[]
type ProgressivePage<T> = {
  count: number
  next: number | string | null
  previous: number | string | null
  results: T[]
}

export function ProgressiveAdminResourcePanel<TItem extends { id: number }>({
  allowCreate = true,
  allowDelete = true,
  api,
  columns,
  endpoint,
  fields = [],
  filters,
  noun,
  onMutated,
  query,
  queryKey,
  setQuery,
  title,
}: {
  allowCreate?: boolean
  allowDelete?: boolean
  api: AuthedRequest
  columns: AdminColumn<TItem>[]
  endpoint: string
  fields?: AdminField<TItem>[]
  filters?: Record<string, string>
  noun: string
  onMutated?: () => Promise<void> | void
  query: string
  queryKey: readonly unknown[]
  setQuery: (value: string) => void
  title: string
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => createDraft(fields))
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerPanelRef = useRef<HTMLFormElement>(null)
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const debouncedQuery = useDebouncedValue(query, 300)
  const pageQuery = useInfiniteQuery({
    initialPageParam: 0,
    queryKey: [...queryKey, debouncedQuery, filters],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50', offset: String(pageParam) })
      if (debouncedQuery.trim()) params.set('search', debouncedQuery.trim())
      Object.entries(filters ?? {}).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })
      return api<ProgressivePage<TItem>>(`${endpoint}?${params.toString()}`, { signal })
    },
    getNextPageParam: (lastPage) => nextOffset(lastPage.next),
    retry: false,
    staleTime: 60_000,
  })
  const rows = pageQuery.data?.pages.flatMap((page) => page.results) ?? []
  const count = pageQuery.data?.pages[0]?.count ?? 0
  const fetchNextPage = pageQuery.fetchNextPage
  const hasNextPage = pageQuery.hasNextPage
  const isFetchNextPageError = pageQuery.isFetchNextPageError
  const isFetchingNextPage = pageQuery.isFetchingNextPage

  useEffect(() => {
    const root = scrollRef.current
    const target = loadMoreRef.current
    if (!root || !target || !hasNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        void fetchNextPage()
      }
    }, { root, rootMargin: '0px 0px 180px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  function openCreate() {
    drawerTriggerRef.current = document.activeElement as HTMLElement | null
    setEditing(null)
    setDraft(createDraft(fields))
    setMessage('')
    setDrawerOpen(true)
    window.requestAnimationFrame(() => closeButtonRef.current?.focus())
  }

  function openEdit(item: TItem) {
    drawerTriggerRef.current = document.activeElement as HTMLElement | null
    setEditing(item)
    setDraft(createDraft(fields, item))
    setMessage('')
    setDrawerOpen(true)
    window.requestAnimationFrame(() => closeButtonRef.current?.focus())
  }

  function closeDrawer() {
    if (saving) return
    setDrawerOpen(false)
    setEditing(null)
    setMessage('')
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus())
  }

  function finishDrawer() {
    setDrawerOpen(false)
    setEditing(null)
    setMessage('')
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus())
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      closeDrawer()
      return
    }
    if (event.key !== 'Tab') return
    const controls = drawerPanelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }

  async function refreshAfterMutation() {
    await queryClient.invalidateQueries({ queryKey })
    await queryClient.invalidateQueries({ queryKey: ['teacher-grades-overview'] })
    await queryClient.invalidateQueries({ queryKey: ['teacher-gradebook'] })
    await onMutated?.()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const payload = buildPayload(fields, draft, Boolean(editing))
      await api(editing ? `${endpoint}${editing.id}/` : endpoint, {
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
        method: editing ? 'PATCH' : 'POST',
      })
      await refreshAfterMutation()
      finishDrawer()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing || !window.confirm(`Delete this ${noun.toLowerCase()}?`)) return
    setSaving(true)
    setMessage('')
    try {
      await api(`${endpoint}${editing.id}/`, { method: 'DELETE' })
      await refreshAfterMutation()
      finishDrawer()
    } catch (error) {
      setMessage(toErrorMessage(error))
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block progressive-resource">
      <SectionHeading
        subtitle={`${rows.length} of ${count} record${count === 1 ? '' : 's'} loaded`}
        title={title}
        action={allowCreate && fields.length ? (
          <button className="button button--primary button--compact" onClick={openCreate} type="button">
            <Icon name="plus" /><span>New {noun.toLowerCase()}</span>
          </button>
        ) : null}
      />
      <label className="admin-search progressive-resource__search">
        <Icon name="search" />
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search all ${noun.toLowerCase()}s`}
          type="search"
          value={query}
        />
      </label>
      <div className="progressive-resource__table" ref={scrollRef}>
        <table className="admin-table">
          <thead><tr>{columns.map((column) => <th key={column.header}>{column.header}</th>)}{fields.length ? <th>Actions</th> : null}</tr></thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                {columns.map((column) => <td key={column.header}>{column.render(item)}</td>)}
                {fields.length ? <td><button aria-label={`Edit ${noun}`} className="icon-button" onClick={() => openEdit(item)} title="Edit" type="button"><Icon name="edit" /></button></td> : null}
              </tr>
            ))}
            {pageQuery.isPending ? <SkeletonRows columns={columns.length + (fields.length ? 1 : 0)} /> : null}
            {!pageQuery.isPending && !pageQuery.error && !rows.length ? <tr><td colSpan={columns.length + (fields.length ? 1 : 0)}>No records found.</td></tr> : null}
          </tbody>
        </table>
        <div className="progressive-resource__footer" ref={loadMoreRef}>
          <span aria-live="polite">Showing {rows.length} of {count}</span>
          {pageQuery.isFetching && !pageQuery.isPending && !pageQuery.isFetchingNextPage ? <span className="progressive-resource__refreshing">Updating…</span> : null}
          {pageQuery.error && rows.length ? <span role="alert">Refresh failed.</span> : null}
          {pageQuery.error && !rows.length ? <button className="button button--secondary button--compact" onClick={() => void pageQuery.refetch()} type="button">Retry</button> : null}
          {pageQuery.hasNextPage && !pageQuery.isFetchNextPageError ? (
            <button className="button button--secondary button--compact" disabled={pageQuery.isFetchingNextPage} onClick={() => void pageQuery.fetchNextPage()} type="button">
              {pageQuery.isFetchingNextPage ? 'Loading more...' : 'Load more'}
            </button>
          ) : null}
          {pageQuery.isFetchNextPageError ? <button className="button button--secondary button--compact" onClick={() => void pageQuery.fetchNextPage()} type="button">Retry loading more</button> : null}
        </div>
      </div>
      {drawerOpen ? (
        <div aria-labelledby="resource-drawer-title" aria-modal="true" className="resource-drawer" role="dialog" onKeyDown={handleDrawerKeyDown}>
          <button aria-label="Close editor" className="resource-drawer__backdrop" onClick={closeDrawer} type="button" />
          <form className="resource-drawer__panel" onSubmit={submit} ref={drawerPanelRef}>
            <div className="resource-drawer__header">
              <div><span>{editing ? 'Edit record' : 'Create record'}</span><strong id="resource-drawer-title">{noun}</strong></div>
              <button aria-label="Close editor" className="icon-button" disabled={saving} onClick={closeDrawer} ref={closeButtonRef} type="button"><Icon name="close" /></button>
            </div>
            <div className="resource-drawer__body">
              {fields.map((field) => (
                <ProgressiveFieldControl
                  api={api}
                  disabled={saving || Boolean(editing && field.readOnlyOnEdit)}
                  field={field}
                  key={field.name}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
                  value={draft[field.name]}
                />
              ))}
              {message ? <p className="admin-message" role="alert">{message}</p> : null}
            </div>
            <div className="resource-drawer__actions">
              {editing && allowDelete ? <button className="button button--danger" disabled={saving} onClick={() => void remove()} type="button"><Icon name="trash" /><span>Delete</span></button> : <span />}
              <button className="button button--secondary" disabled={saving} onClick={closeDrawer} type="button">Cancel</button>
              <button className="button button--primary" disabled={saving} type="submit"><Icon name="save" /><span>{saving ? 'Saving...' : 'Save'}</span></button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}

function ProgressiveFieldControl<TItem>({ api, disabled, field, onChange, value }: {
  api: AuthedRequest
  disabled: boolean
  field: AdminField<TItem>
  onChange: (value: DraftValue) => void
  value: DraftValue | undefined
}) {
  if (field.type === 'select' && !field.options?.length && relatedFieldConfig[field.name]) {
    return <RemoteRelatedSelect api={api} disabled={disabled} fieldName={field.name} label={field.label} nullable={field.nullable} onChange={onChange} value={String(value ?? '')} />
  }
  if (field.type === 'checkbox') return <label className="admin-check"><input checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span>{field.label}</span></label>
  if (field.type === 'textarea') return <label className="admin-field admin-field--wide"><span>{field.label}</span><textarea disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} required={field.required} rows={field.rows ?? 4} value={String(value ?? '')} /></label>
  if (field.type === 'select') return <label className="admin-field"><span>{field.label}</span><select disabled={disabled} onChange={(event) => onChange(event.target.value)} required={field.required} value={String(value ?? '')}><option value="">Select</option>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  if (field.type === 'multiselect') return <label className="admin-field admin-field--wide"><span>{field.label}</span><select disabled={disabled} multiple onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))} value={Array.isArray(value) ? value : []}>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  if (field.type === 'file') return <label className="admin-field"><span>{field.label}</span><input disabled={disabled} onChange={(event) => onChange(event.target.files?.[0] ?? null)} type="file" /></label>
  return <label className="admin-field"><span>{field.label}</span><input disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} required={field.required} type={field.type} value={String(value ?? '')} /></label>
}

const relatedFieldConfig: Record<string, { endpoint: string; label: (item: Record<string, unknown>) => string }> = {
  source_template: { endpoint: '/grades/templates/', label: (item) => String(item.name ?? `Template #${item.id}`) },
  subject: { endpoint: '/subjects/subjects/', label: (item) => `${item.code ?? ''} ${item.name ?? `Subject #${item.id}`}`.trim() },
  template: { endpoint: '/grades/templates/', label: (item) => String(item.name ?? `Template #${item.id}`) },
  template_item: { endpoint: '/grades/template-items/', label: (item) => String(item.name ?? `Template item #${item.id}`) },
}

function RemoteRelatedSelect({ api, disabled, fieldName, label, nullable, onChange, value }: {
  api: AuthedRequest
  disabled: boolean
  fieldName: string
  label: string
  nullable?: boolean
  onChange: (value: DraftValue) => void
  value: string
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const config = relatedFieldConfig[fieldName]
  const optionsQuery = useQuery({
    queryKey: ['remote-grade-option', fieldName, debounced],
    queryFn: ({ signal }) => {
      const separator = config.endpoint.includes('?') ? '&' : '?'
      return api<ApiList<Record<string, unknown>>>(`${config.endpoint}${separator}limit=20&search=${encodeURIComponent(debounced)}`, { signal })
    },
    staleTime: 60_000,
  })
  const options = asArray(optionsQuery.data ?? [])
  return <div className="remote-select"><label className="admin-field"><span>Find {label.toLowerCase()}</span><input disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} type="search" value={search} /></label><label className="admin-field"><span>{label}</span><select disabled={disabled || optionsQuery.isPending} onChange={(event) => onChange(event.target.value)} required={!nullable} value={value}><option value="">{nullable ? 'None' : optionsQuery.isPending ? 'Loading options...' : 'Select'}</option>{options.map((item) => <option key={String(item.id)} value={String(item.id)}>{config.label(item)}</option>)}{value && !options.some((item) => String(item.id) === value) ? <option value={value}>Selected #{value}</option> : null}</select></label></div>
}

function SkeletonRows({ columns }: { columns: number }) {
  return <>{Array.from({ length: 5 }, (_, row) => <tr className="progressive-resource__skeleton" key={row}>{Array.from({ length: columns }, (_, column) => <td key={column}><span /></td>)}</tr>)}</>
}

function nextOffset(next: number | string | null) {
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

function createDraft<TItem>(fields: AdminField<TItem>[], item?: TItem) {
  return fields.reduce<Record<string, DraftValue>>((draft, field) => {
    const raw = item ? field.value?.(item) ?? (item as Record<string, unknown>)[field.name] : field.defaultValue
    draft[field.name] = field.type === 'checkbox' ? Boolean(raw) : field.type === 'multiselect' ? (Array.isArray(raw) ? raw.map(String) : []) : raw === null || raw === undefined ? '' : String(raw)
    return draft
  }, {})
}

function buildPayload<TItem>(fields: AdminField<TItem>[], draft: Record<string, DraftValue>, editing: boolean) {
  const hasFile = fields.some((field) => draft[field.name] instanceof File)
  if (hasFile) {
    const data = new FormData()
    fields.forEach((field) => {
      if (editing && field.readOnlyOnEdit) return
      const value = parsedFieldValue(field, draft[field.name])
      if (value instanceof File) data.append(field.name, value)
      else if (Array.isArray(value)) value.forEach((item) => data.append(field.name, String(item)))
      else data.append(field.name, value === null || value === undefined ? '' : String(value))
    })
    return data
  }
  return fields.reduce<Record<string, unknown>>((payload, field) => {
    if (editing && field.readOnlyOnEdit) return payload
    const value = draft[field.name]
    if (field.type === 'password' && editing && !value) return payload
    payload[field.name] = parsedFieldValue(field, value)
    return payload
  }, {})
}

function parsedFieldValue<TItem>(field: AdminField<TItem>, value: DraftValue | undefined) {
  if (field.parse) return field.parse(value ?? '')
  if (field.type === 'checkbox') return Boolean(value)
  if (field.type === 'number') return value === '' || value === undefined ? null : Number(value)
  if (field.nullable && value === '') return null
  return value ?? ''
}
