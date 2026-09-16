import { expect, test, type Page } from '@playwright/test'

const refreshPath = '**/api/auth/token/refresh/'

async function signIn(page: Page, username = 'e2e-teacher') {
  await page.goto('/admin')
  await page.getByLabel('Student number or username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
}

test('student session restores after reload without storing tokens in the browser', async ({ page }) => {
  await signIn(page, 'E2E-001')
  const stored = await page.evaluate(() => ({
    current: localStorage.getItem('aralforge.session'),
    legacy: localStorage.getItem('ezoryx.session'),
  }))
  expect(stored).toEqual({ current: null, legacy: null })

  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aralforge.session'))).toBeNull()
})

test('a rejected refresh returns to sign in without exposing a refresh token', async ({ page }) => {
  await signIn(page)
  await page.route(refreshPath, route => route.fulfill({ status: 401, json: { detail: 'Expired session' } }))

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aralforge.session'))).toBeNull()
})

test('a stale CSRF token is renewed and does not end an active session', async ({ page }) => {
  await signIn(page)

  let rejectFirstRefresh = true
  await page.route(refreshPath, route => {
    if (!rejectFirstRefresh) return route.continue()
    rejectFirstRefresh = false
    return route.fulfill({
      status: 403,
      json: { code: 'csrf_failed', detail: 'CSRF validation failed: CSRF token missing or incorrect.' },
    })
  })

  await page.reload()

  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  expect(rejectFirstRefresh).toBe(false)
})

test('a persistent CSRF failure offers session reconnection instead of signing out', async ({ page }) => {
  await signIn(page)
  await page.route(refreshPath, route => route.fulfill({
    status: 403,
    json: { code: 'csrf_failed', detail: 'CSRF validation failed: CSRF token missing or incorrect.' },
  }))

  await page.reload()

  await expect(page.getByText('Unable to restore your session', { exact: true })).toBeVisible()
  await expect(page.getByText('Reconnect your session', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await page.unroute(refreshPath)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
})

test('manual sign out revokes the cookie session and reload stays signed out', async ({ page }) => {
  await signIn(page)
  const logoutResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/logout/'))

  await page.locator('button[title="Sign out"]:visible').click()

  expect((await logoutResponse).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
})
