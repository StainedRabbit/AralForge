import { dehydrate, hydrate } from '@tanstack/react-query'
import type { DehydratedState, QueryClient, QueryKey } from '@tanstack/react-query'

export const HOUR_MS = 60 * 60 * 1000
export const LIVE_STALE_MS = 30_000

const DATABASE_NAME = 'aralforge-page-cache'
const STORE_NAME = 'query-cache'
const CACHE_KEY = 'current-account'
const CACHE_VERSION = '2026-10-22-v1'

type SavedCache = {
  ownerId: number
  version: string
  savedAt: number
  state: DehydratedState
}

let generation = 0
let stopCurrent: (() => void) | null = null
let pendingClear: Promise<void> = Promise.resolve()
let pendingSave: Promise<void> = Promise.resolve()

export function isPersistableQueryKey(key: QueryKey): boolean {
  const family = key[0]
  if (family === 'resource') return isPersistableResourcePath(key[1])
  return family === 'classes' || family === 'class-roster'
    || family === 'class-search-snapshot' || family === 'class-schedule'
    || (family === 'class-workspace' && key[2] === 'attendance' && key[3] === 'history')
    || family === 'student-directory' || family === 'student-schedule-options'
    || family === 'gradebook-schedules' || family === 'apply-template-subjects'
    || family === 'apply-template-options'
}

export function invalidateAfterWrite(queryClient: QueryClient, path: string) {
  const domain = path.split('?')[0]
  const stateOnlyModuleWrite = /^\/modules\/(activity-attempts|activity-answers|submissions|lesson-progress|progress|topic-progress)\//.test(domain)
  void queryClient.invalidateQueries({
    refetchType: 'none',
    predicate: (query) => {
      const key = query.queryKey
      const family = key[0]
      const resource = family === 'resource' && typeof key[1] === 'string' ? key[1] : ''
      if (domain.startsWith('/grades/')) {
        return isGradeQueryKey(key) || family === 'apply-template-options'
          || resource.includes('/main-activity-workspace/?view=links')
      }
      if (domain.startsWith('/modules/')) {
        return (stateOnlyModuleWrite && isGradeQueryKey(key)) || resource.startsWith('/modules/')
          && (!stateOnlyModuleWrite || !isPersistableQueryKey(key))
      }
      if (domain.startsWith('/subjects/')) {
        return resource.startsWith('/subjects/') || family === 'classes'
          || family === 'class-roster' || family === 'class-search-snapshot'
          || family === 'class-roster-grades'
          || family === 'class-schedule' || family === 'class-workspace'
          || family === 'gradebook-schedules' || family === 'student-schedule-options'
          || family === 'apply-template-subjects'
      }
      if (domain.startsWith('/attendance/')) {
        return resource.startsWith('/attendance/')
          || (family === 'class-workspace' && key[2] === 'attendance')
      }
      if (domain.startsWith('/accounts/')) {
        return resource.startsWith('/accounts/') || family === 'student-directory'
      }
      if (domain.startsWith('/gamification/')) {
        return resource.startsWith('/gamification/')
      }
      return false
    },
  })
}

function isGradeQueryKey(key: QueryKey) {
  const family = key[0]
  const resource = family === 'resource' && typeof key[1] === 'string' ? key[1] : ''
  return resource.startsWith('/grades/') || resource.includes('/grading-workspace/')
    || family === 'gradebook' || family === 'teacher-gradebook'
    || family === 'class-roster-grades'
    || family === 'teacher-grades-overview' || family === 'grade-setup'
    || family === 'grade-source-options' || family === 'remote-grade-option'
    || (family === 'class-workspace' && (key[2] === 'grades' || key[2] === 'scores'))
}

function isPersistableResourcePath(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.startsWith('/grades/') || value.startsWith('/overview/')) return false
  if (value.startsWith('/accounts/students/') || value.startsWith('/accounts/users/')) return true
  if (value.startsWith('/subjects/')) {
    if (value.includes('/workspace/')) return false
    if (value.includes('/roster/')) return new URLSearchParams(value.split('?')[1] ?? '').get('view') === 'directory'
    return true
  }
  if (value.startsWith('/attendance/')) return false
  if (value.startsWith('/gamification/badges/') || value.startsWith('/gamification/levels/')) return true
  if (!value.startsWith('/modules/')) return false
  if (/\/(activity-attempts|activity-answers|submissions|lesson-progress|progress|topic-progress|access)\//.test(value)) return false
  if (value.includes('/grading-workspace/') || value.includes('/teacher-summary/')) return false
  if (value.includes('/presentation-workspace/')) return true
  if (value.includes('/workspace/')) return new URLSearchParams(value.split('?')[1] ?? '').get('view') === 'content'
  if (value.includes('/main-activity-workspace/')) return new URLSearchParams(value.split('?')[1] ?? '').get('view') === 'content'
  return /^\/modules\/(modules|topics|lessons|lesson-assets|lesson-examples|activities|activity-questions|activity-choices|activity-matching-pairs)\//.test(value)
}

function stopPersistence() {
  generation += 1
  stopCurrent?.()
  stopCurrent = null
}

export function clearPersistentCache() {
  stopPersistence()
  pendingClear = Promise.allSettled([pendingClear, pendingSave])
    .then(() => removeSavedCache()).catch(() => undefined)
  return pendingClear
}

export async function startPersistentCache(queryClient: QueryClient, ownerId: number) {
  stopPersistence()
  const currentGeneration = generation
  await pendingClear
  try {
    const saved = await readSavedCache()
    if (currentGeneration !== generation) return () => undefined
    if (saved && (saved.ownerId !== ownerId || saved.version !== CACHE_VERSION
      || Date.now() - saved.savedAt > HOUR_MS)) {
      await removeSavedCache()
    } else if (saved) {
      const cutoff = Date.now() - HOUR_MS
      hydrate(queryClient, {
        mutations: [],
        queries: saved.state.queries.filter((query) =>
          query.state.dataUpdatedAt > cutoff && isPersistableQueryKey(query.queryKey)),
      })
    }
  } catch {
    // IndexedDB may be disabled or unavailable; in-memory queries still work.
  }
  if (currentGeneration !== generation) return () => undefined

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    pendingSave = pendingSave.then(async () => {
      if (currentGeneration !== generation) return
      const cutoff = Date.now() - HOUR_MS
      const state = stripRosterGrades(dehydrate(queryClient, {
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: (query) => query.state.status === 'success'
          && query.state.dataUpdatedAt > cutoff
          && isPersistableQueryKey(query.queryKey),
      }))
      try {
        await writeSavedCache({ ownerId, version: CACHE_VERSION, savedAt: Date.now(), state })
      } catch {
        // Storage quota or browser policy must never prevent API-backed pages.
      }
    })
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void save() }, 800)
  })
  const stop = () => {
    unsubscribe()
    if (saveTimer) clearTimeout(saveTimer)
  }
  stopCurrent = stop
  return () => {
    if (stopCurrent === stop) stopPersistence()
  }
}

function stripRosterGrades(state: DehydratedState): DehydratedState {
  return {
    ...state,
    queries: state.queries.map((query) => {
      if (query.queryKey[0] !== 'class-roster') return query
      const data = query.state.data
      if (!data || typeof data !== 'object' || !('pages' in data) || !Array.isArray(data.pages)) return query
      return {
        ...query,
        state: {
          ...query.state,
          data: {
            ...data,
            pages: data.pages.map((page) => {
              if (!page || typeof page !== 'object' || !('results' in page) || !Array.isArray(page.results)) return page
              return {
                ...page,
                results: page.results.map((row: unknown) => {
                  if (!row || typeof row !== 'object') return row
                  const safe = { ...row } as Record<string, unknown>
                  delete safe.grade_summary
                  return safe
                }),
              }
            }),
          },
        },
      }
    }),
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('IndexedDB timed out')), 3000)
    const finish = (error?: Error, database?: IDBDatabase) => {
      if (settled) { database?.close(); return }
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(database!)
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => finish(undefined, request.result)
    request.onerror = () => finish(request.error ?? new Error('IndexedDB failed'))
    request.onblocked = () => finish(new Error('IndexedDB is blocked'))
  })
}

async function readSavedCache(): Promise<SavedCache | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('IndexedDB read timed out')), 3000)
    const finish = (error?: Error, value?: SavedCache) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      database.close()
      if (error) reject(error)
      else resolve(value)
    }
    request.onsuccess = () => finish(undefined, request.result as SavedCache | undefined)
    request.onerror = () => finish(request.error ?? new Error('IndexedDB read failed'))
    transaction.onerror = () => finish(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

async function writeSavedCache(value: SavedCache): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(value, CACHE_KEY)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('IndexedDB write timed out')), 3000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      database.close()
      if (error) reject(error)
      else resolve()
    }
    transaction.oncomplete = () => finish()
    transaction.onerror = () => finish(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

async function removeSavedCache(): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(CACHE_KEY)
    let settled = false
    const timeout = setTimeout(() => finish(new Error('IndexedDB delete timed out')), 3000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      database.close()
      if (error) reject(error)
      else resolve()
    }
    transaction.oncomplete = () => finish()
    transaction.onerror = () => finish(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}
