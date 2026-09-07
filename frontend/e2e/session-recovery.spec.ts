import { expect, test, type Page, type Route } from '@playwright/test'

const sessionKey = 'aralforge.session'
const refreshPath = '**/api/auth/token/refresh/'
const identityPath = '**/api/accounts/users/me/'

async function signIn(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
}

async function storedSession(page: Page) {
  return page.evaluate(key => localStorage.getItem(key), sessionKey)
}

async function expireAccess(page: Page) {
  await page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key)!)
    localStorage.setItem(key, JSON.stringify({ ...session, access: 'expired-access' }))
  }, sessionKey)
}

async function failRequest(route: Route, failure: number | 'network' | 'cancelled') {
  if (typeof failure === 'number') {
    await route.fulfill({ status: failure, json: { detail: 'Simulated failure' } })
  } else {
    await route.abort(failure === 'cancelled' ? 'aborted' : 'failed')
  }
}

test('rejected refresh clears the session and returns to sign in', async ({ page }) => {
  await signIn(page)
  await expireAccess(page)
  await page.route(refreshPath, route => failRequest(route, 401))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  expect(await storedSession(page)).toBeNull()
})

for (const failure of [500, 429, 'network', 'cancelled'] as const) {
  test(`refresh ${failure} preserves the session and Retry recovers`, async ({ page }) => {
    await signIn(page)
    await expireAccess(page)
    const before = await storedSession(page)
    await page.route(refreshPath, route => failRequest(route, failure))
    await page.reload()
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    expect(await storedSession(page)).toBe(before)
    await page.unroute(refreshPath)
    await retry.click()
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    expect(JSON.parse((await storedSession(page))!).access).not.toBe('expired-access')
  })
}

for (const failure of [400, 401, 403, 500, 'network', 'cancelled'] as const) {
  test(`retried request ${failure} preserves the renewed session`, async ({ page }) => {
    await signIn(page)
    await expireAccess(page)
    let refreshes = 0
    page.on('request', request => {
      if (request.url().endsWith('/api/auth/token/refresh/')) refreshes += 1
    })
    await page.route(identityPath, async route => {
      if (route.request().headers().authorization === 'Bearer expired-access') {
        await route.continue()
      } else {
        await failRequest(route, failure)
      }
    })
    await page.reload()
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    const renewed = await storedSession(page)
    expect(renewed).not.toBeNull()
    expect(JSON.parse(renewed!).access).not.toBe('expired-access')
    expect(refreshes).toBe(1)
    await page.unroute(identityPath)
    await retry.click()
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  })
}

test('concurrent unauthorized requests share renewal and manual sign out clears it', async ({ page }) => {
  await signIn(page)
  const rejected = new Set<string>()
  let releaseRefresh!: () => void
  const bothRejected = new Promise<void>(resolve => { releaseRefresh = resolve })
  let refreshes = 0
  await page.route('**/api/overview/*/', async route => {
    const path = new URL(route.request().url()).pathname
    if (!rejected.has(path)) {
      rejected.add(path)
      await route.fulfill({ status: 401, json: { detail: 'Expired access' } })
      if (rejected.size === 2) releaseRefresh()
    } else {
      await route.continue()
    }
  })
  await page.route(refreshPath, async route => {
    refreshes += 1
    await bothRejected
    // Keep renewal pending until both unauthorized responses reach the hook.
    await page.waitForTimeout(200)
    await route.continue()
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await expect.poll(() => rejected.size).toBe(2)
  expect(refreshes).toBe(1)
  expect(JSON.parse((await storedSession(page))!).access).toBeTruthy()
  await page.locator('button[title="Sign out"]:visible').click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  expect(await storedSession(page)).toBeNull()
})
