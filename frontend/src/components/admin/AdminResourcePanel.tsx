import { useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AuthedRequest } from '../../app/types'
import { toErrorMessage } from '../../utils/format'
import { Icon } from '../Icon'
import { SectionHeading } from '../ui'

export type AdminOption = {
  label: string
  value: number | string
}

type DraftValue = boolean | File | null | string | string[]

export type AdminField<TItem> = {
  defaultValue?: boolean | number | string | string[]
  label: string
  name: string
  nullable?: boolean
  options?: AdminOption[]
  parse?: (value: DraftValue) => unknown
  placeholder?: string
  readOnlyOnEdit?: boolean
  required?: boolean
  rows?: number
  type:
    | 'checkbox'
    | 'date'
    | 'datetime-local'
    | 'file'
    | 'multiselect'
    | 'number'
    | 'password'
    | 'select'
    | 'textarea'
    | 'text'
    | 'time'
  value?: (item: TItem) => unknown
}

export type AdminColumn<TItem> = {
  header: string
  render: (item: TItem) => ReactNode
}

type AdminResourcePanelProps<TItem extends { id: number }> = {
  api: AuthedRequest
  columns: AdminColumn<TItem>[]
  endpoint: string
  fields: AdminField<TItem>[]
  getSearchText?: (item: TItem) => string
  items: TItem[]
  noun: string
  onRefresh: () => Promise<void>
  title: string
}

export function AdminResourcePanel<TItem extends { id: number }>({
  api,
  columns,
  endpoint,
  fields,
  getSearchText,
  items,
  noun,
  onRefresh,
  title,
}: AdminResourcePanelProps<TItem>) {
  const [editing, setEditing] = useState<TItem | null>(null)
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() =>
    createDraft(fields),
  )
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return items
    }

    return items.filter((item) =>
      (getSearchText?.(item) ?? JSON.stringify(item))
        .toLowerCase()
        .includes(normalizedQuery),
    )
  }, [getSearchText, items, query])

  function resetForm() {
    setEditing(null)
    setDraft(createDraft(fields))
    setMessage('')
  }

  function editItem(item: TItem) {
    setEditing(item)
    setDraft(createDraft(fields, item))
    setMessage('')
    window.requestAnimationFrame(() => {
      const form = formRef.current
      form?.scrollIntoView({ block: 'start' })
      form?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
        ?.focus({ preventScroll: true })
    })
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const payload = buildPayload(fields, draft, Boolean(editing))
      await api(editing ? `${endpoint}${editing.id}/` : endpoint, {
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
        method: editing ? 'PATCH' : 'POST',
      })
      setEditing(null)
      setDraft(createDraft(fields))
      setMessage(`${noun} saved.`)
      await onRefresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item: TItem) {
    if (!window.confirm(`Delete this ${noun.toLowerCase()}?`)) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      await api(`${endpoint}${item.id}/`, { method: 'DELETE' })
      setMessage(`${noun} deleted.`)
      resetForm()
      await onRefresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block">
      <SectionHeading
        subtitle={`${visibleItems.length}/${items.length} records`}
        title={title}
      />

      <div className="admin-resource__grid">
        <form className="admin-form" onSubmit={submitForm} ref={formRef}>
          <div className="admin-form__header">
            <strong>{editing ? `Edit ${noun}` : `New ${noun}`}</strong>
            {editing ? (
              <button
                className="button button--secondary"
                onClick={resetForm}
                type="button"
              >
                <Icon name="plus" />
                <span>New</span>
              </button>
            ) : null}
          </div>

          <div className="admin-form__fields">
            {fields.map((field) => (
              <AdminFieldControl
                disabled={saving || Boolean(editing && field.readOnlyOnEdit)}
                field={field}
                key={field.name}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, [field.name]: value }))
                }
                value={draft[field.name]}
              />
            ))}
          </div>

          {message ? <p className="admin-message">{message}</p> : null}

          <button className="button button--primary" disabled={saving} type="submit">
            <Icon name="save" />
            <span>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}</span>
          </button>
        </form>

        <div className="admin-table-panel">
          <label className="admin-search">
            <Icon name="search" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${noun.toLowerCase()}s`}
              type="search"
              value={query}
            />
          </label>

          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.header}>{column.header}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    {columns.map((column) => (
                      <td key={column.header}>{column.render(item)}</td>
                    ))}
                    <td>
                      <div className="admin-table__actions">
                        <button
                          aria-label={`Edit ${noun}`}
                          className="icon-button"
                          onClick={() => editItem(item)}
                          title="Edit"
                          type="button"
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          className="icon-button"
                          disabled={saving}
                          onClick={() => void deleteItem(item)}
                          title="Delete"
                          type="button"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!visibleItems.length ? (
                  <tr>
                    <td colSpan={columns.length + 1}>No records found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}

function AdminFieldControl<TItem>({
  disabled,
  field,
  onChange,
  value,
}: {
  disabled: boolean
  field: AdminField<TItem>
  onChange: (value: DraftValue) => void
  value: DraftValue | undefined
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="admin-check">
        <input
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label className="admin-field admin-field--wide">
        <span>{field.label}</span>
        <textarea
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          rows={field.rows ?? 4}
          value={String(value ?? '')}
        />
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <label className="admin-field">
        <span>{field.label}</span>
        <select
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          required={field.required}
          value={String(value ?? '')}
        >
          <option value="">Select</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'multiselect') {
    const values = Array.isArray(value) ? value : []

    return (
      <label className="admin-field admin-field--wide">
        <span>{field.label}</span>
        <select
          disabled={disabled}
          multiple
          onChange={(event) =>
            onChange(
              Array.from(event.target.selectedOptions).map(
                (option) => option.value,
              ),
            )
          }
          value={values}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'file') {
    return (
      <label className="admin-field">
        <span>{field.label}</span>
        <input
          disabled={disabled}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          type="file"
        />
      </label>
    )
  }

  return (
    <label className="admin-field">
      <span>{field.label}</span>
      <input
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        type={field.type}
        value={String(value ?? '')}
      />
    </label>
  )
}

function buildPayload<TItem>(
  fields: AdminField<TItem>[],
  draft: Record<string, DraftValue>,
  isEditing: boolean,
) {
  const hasFile = fields.some((field) => draft[field.name] instanceof File)

  if (hasFile) {
    const formData = new FormData()

    fields.forEach((field) => {
      if (field.readOnlyOnEdit && isEditing) {
        return
      }

      appendFormValue(formData, field, draft[field.name], isEditing)
    })

    return formData
  }

  return fields.reduce<Record<string, unknown>>((payload, field) => {
    if (field.readOnlyOnEdit && isEditing) {
      return payload
    }

    const value = draft[field.name]

    if (field.type === 'file' || (field.type === 'password' && isEditing && !value)) {
      return payload
    }

    payload[field.name] = parseValue(field, value)
    return payload
  }, {})
}

function appendFormValue<TItem>(
  formData: FormData,
  field: AdminField<TItem>,
  value: DraftValue | undefined,
  isEditing: boolean,
) {
  if (field.type === 'password' && isEditing && !value) {
    return
  }

  if (field.type === 'file') {
    if (value instanceof File) {
      formData.append(field.name, value)
    }
    return
  }

  const parsedValue = parseValue(field, value)

  if (Array.isArray(parsedValue)) {
    parsedValue.forEach((item) => formData.append(field.name, String(item)))
    return
  }

  if (parsedValue === null || parsedValue === undefined) {
    formData.append(field.name, '')
    return
  }

  formData.append(field.name, String(parsedValue))
}

function createDraft<TItem>(
  fields: AdminField<TItem>[],
  item?: TItem,
): Record<string, DraftValue> {
  return fields.reduce<Record<string, DraftValue>>((draft, field) => {
    if (!item) {
      draft[field.name] = normalizeFieldValue(field, field.defaultValue)
      return draft
    }

    const rawValue =
      field.value?.(item) ?? (item as Record<string, unknown>)[field.name]
    draft[field.name] = normalizeFieldValue(field, rawValue)
    return draft
  }, {})
}

function normalizeFieldValue<TItem>(
  field: AdminField<TItem>,
  value: unknown,
): DraftValue {
  if (field.type === 'checkbox') {
    return Boolean(value)
  }

  if (field.type === 'multiselect') {
    return Array.isArray(value) ? value.map(String) : []
  }

  if (field.type === 'datetime-local') {
    return toDateTimeLocal(value)
  }

  if (field.type === 'file') {
    return null
  }

  return value === null || value === undefined ? '' : String(value)
}

function parseValue<TItem>(
  field: AdminField<TItem>,
  value: DraftValue | undefined,
) {
  if (field.parse) {
    return field.parse(value ?? '')
  }

  if ((value === '' || value === undefined) && field.nullable) {
    return null
  }

  if (field.type === 'multiselect') {
    return Array.isArray(value) ? value.map((item) => Number(item)) : []
  }

  if (field.type === 'checkbox') {
    return Boolean(value)
  }

  return value ?? ''
}

function toDateTimeLocal(value: unknown) {
  if (!value || typeof value !== 'string') {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16)
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
}
