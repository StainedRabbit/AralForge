type StoredDraft<TDraft> = {
  savedAt: string
  value: TDraft
}

const DRAFT_PREFIX = 'ezoryx:lesson-draft'

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
    const value = window.localStorage.getItem(key)
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
