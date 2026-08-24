import { isJsonObject, migrateStorageValue } from './storageMigration'

type StoredDraft<TDraft> = {
  savedAt: string
  value: TDraft
}

const DRAFT_PREFIX = 'aralforge:lesson-draft:v2'
const LEGACY_DRAFT_PREFIX = 'ezoryx:lesson-draft:v2'

export function lessonDraftKey({
  lessonId,
  topicId,
}: {
  lessonId?: number
  topicId: number
}) {
  return lessonId
    ? `${DRAFT_PREFIX}:lesson:${lessonId}`
    : `${DRAFT_PREFIX}:topic:${topicId}:new`
}

export function readLessonDraft<TDraft>(key: string): StoredDraft<TDraft> | null {
  try {
    const value = migrateStorageValue(
      key,
      key.replace(DRAFT_PREFIX, LEGACY_DRAFT_PREFIX),
      isJsonObject,
    )
    return value ? JSON.parse(value) as StoredDraft<TDraft> : null
  } catch {
    return null
  }
}

export function writeLessonDraft<TDraft>(key: string, value: TDraft) {
  try {
    window.localStorage.setItem(key, JSON.stringify({
      savedAt: new Date().toISOString(),
      value,
    }))
    return true
  } catch {
    return false
  }
}

export function removeLessonDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
