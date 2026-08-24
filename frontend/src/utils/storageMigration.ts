export function migrateStorageValue(
  key: string,
  legacyKey: string,
  isValid: (value: string) => boolean = () => true,
) {
  try {
    const currentValue = window.localStorage.getItem(key)
    if (currentValue !== null) return currentValue

    const legacyValue = window.localStorage.getItem(legacyKey)
    if (legacyValue === null || !isValid(legacyValue)) return null

    window.localStorage.setItem(key, legacyValue)
    if (window.localStorage.getItem(key) === legacyValue) {
      window.localStorage.removeItem(legacyKey)
    }
    return legacyValue
  } catch {
    return null
  }
}

export function isJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

export function migrateAralForgeStorage() {
  migrateStorageValue('aralforge.session', 'ezoryx.session', isStoredTokenPair)
  migrateStorageValue(
    'aralforge:presentation-text-size',
    'ezoryx:presentation-text-size',
    (value) => value === 'large' || value === 'small' || value === 'default',
  )

  try {
    const legacyKeys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).filter((key): key is string => Boolean(key))

    legacyKeys.forEach((legacyKey) => {
      if (legacyKey.startsWith('ezoryx:lesson-draft:v2:')) {
        migrateStorageValue(
          legacyKey.replace('ezoryx:lesson-draft:v2:', 'aralforge:lesson-draft:v2:'),
          legacyKey,
          isJsonObject,
        )
      } else if (legacyKey.startsWith('ezoryx.main-activity-draft.')) {
        migrateStorageValue(
          legacyKey.replace('ezoryx.main-activity-draft.', 'aralforge.main-activity-draft.'),
          legacyKey,
          isJsonObject,
        )
      }
    })
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function isStoredTokenPair(value: string) {
  try {
    const parsed = JSON.parse(value) as { access?: unknown; refresh?: unknown } | null
    return Boolean(
      parsed
      && typeof parsed === 'object'
      && typeof parsed.access === 'string'
      && typeof parsed.refresh === 'string',
    )
  } catch {
    return false
  }
}
