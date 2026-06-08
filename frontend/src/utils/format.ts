import { getApiBaseUrl } from '../api'

export function numeric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 0
  }

  return Number(value)
}

export function percent(value: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.min(100, Math.round((value / total) * 100))
}

export function displayScore(value: string | null) {
  return value ? Number(value).toFixed(2) : 'Pending'
}

export function dueLabel(value: string | null) {
  return value ? formatDateTime(value) : 'No due date'
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`))
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(`1970-01-01T${value}`))
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function resolveMediaUrl(value: string) {
  if (value.startsWith('http')) {
    return value
  }

  const base = getApiBaseUrl().replace('/api', '')
  return `${base}${value.startsWith('/') ? value : `/${value}`}`
}

export function toErrorMessage(caughtError: unknown) {
  if (caughtError instanceof Error) {
    return caughtError.message
  }

  return 'Something went wrong. Please try again.'
}
