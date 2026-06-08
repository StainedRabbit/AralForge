import type { ApiList, TokenPair } from './types'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type Session = TokenPair

export type RequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
}

export function getApiBaseUrl() {
  return API_BASE_URL
}

export function asArray<T>(payload: ApiList<T>): T[] {
  return Array.isArray(payload) ? payload : payload.results
}

export async function login(username: string, password: string) {
  return request<TokenPair>('/auth/token/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function refreshToken(refresh: string) {
  return request<{ access: string }>('/auth/token/refresh/', {
    method: 'POST',
    body: JSON.stringify({ refresh }),
  })
}

export async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: createHeaders(options),
  })

  return parseResponse<T>(response)
}

export async function requestWithToken<T>(
  path: string,
  accessToken: string,
  options: RequestOptions = {},
) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: createHeaders(options, accessToken),
  })

  return parseResponse<T>(response)
}

function buildUrl(path: string) {
  if (path.startsWith('http')) {
    return path
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function createHeaders(options: RequestOptions, accessToken?: string) {
  const headers = new Headers(options.headers)
  const isFormData = options.body instanceof FormData

  if (!headers.has('Content-Type') && options.body && !isFormData) {
    headers.set('Content-Type', 'application/json')
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return headers
}

async function parseResponse<T>(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const hasJson = contentType.includes('application/json')
  const payload = hasJson ? await response.json() : await response.text()

  if (!response.ok) {
    throw new ApiError(readErrorMessage(payload), response.status)
  }

  return payload as T
}

function readErrorMessage(payload: unknown) {
  if (typeof payload === 'string') {
    return payload || 'The server returned an error.'
  }

  if (payload && typeof payload === 'object') {
    const detail = 'detail' in payload ? payload.detail : undefined

    if (typeof detail === 'string') {
      return detail
    }

    return JSON.stringify(payload)
  }

  return 'The server returned an error.'
}
