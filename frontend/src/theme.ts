import type { ThemePreference } from './types'

export const THEME_PREFERENCE_STORAGE_KEY = 'aralforge.theme-preference'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function readRememberedThemePreference(): ThemePreference | null {
  try {
    const preference = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
    return preference === 'light' || preference === 'dark' || preference === 'system'
      ? preference
      : null
  } catch {
    return null
  }
}

export function rememberThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference)
  } catch {
    // Theme application still works when browser storage is unavailable.
  }
}

export function applyTheme(preference: ThemePreference) {
  if (preference === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.dataset.theme = preference
  updateBrowserThemeColor()
}

export function updateBrowserThemeColor() {
  const preference = document.documentElement.dataset.theme
  const dark = preference === 'dark' || (!preference && systemDark())
  document.documentElement.dataset.effectiveTheme = dark ? 'dark' : 'light'
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1726' : '#f8fafc')
}
