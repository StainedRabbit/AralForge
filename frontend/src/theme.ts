import type { ThemePreference } from './types'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

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
