import { expect, test, type Page } from '@playwright/test'

const refreshPath = '**/api/auth/token/refresh/'

async function signIn(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Student number or username').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
}

test('tokens stay out of browser storage and the HttpOnly session restores after reload', async ({ page }) => {
  await signIn(page)
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

test('manual sign out revokes the cookie session and reload stays signed out', async ({ page }) => {
  await signIn(page)
  const logoutResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/logout/'))

  await page.locator('button[title="Sign out"]:visible').click()

  expect((await logoutResponse).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
})
