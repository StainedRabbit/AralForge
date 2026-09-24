import { expect, test, type Page } from '@playwright/test'

const refreshPath = '**/api/auth/token/refresh/'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function expireAccess(page: Page) {
  await page.evaluate(async () => {
    const api = await import('/src/api.ts')
    api.activateSession({ access: 'expired-access-token' })
  })
}

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

test('a fresh private browser reaches sign in using only same-origin API requests', async ({ page, context }) => {
  await context.clearCookies()
  const origins = new Set<string>()
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) origins.add(new URL(request.url()).origin)
  })
  await page.goto('/modules')
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await expect(page.getByText('Unable to restore your session', { exact: true })).toHaveCount(0)
  expect([...origins]).toEqual([new URL(page.url()).origin])
})

test('staff session survives reload with a first-party HttpOnly cookie', async ({ page, context }) => {
  await signIn(page)
  const refresh = (await context.cookies()).find(cookie => cookie.name === 'aralforge_refresh')!
  expect(refresh.httpOnly).toBe(true)
  expect(refresh.domain).toBe(new URL(page.url()).hostname)
  expect(refresh.sameSite).toBe('Lax')
  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
})

for (const username of ['E2E-001', 'e2e-teacher']) {
  test(`${username} renews expired access during navigation`, async ({ page }) => {
    await signIn(page, username)
    await expireAccess(page)
    const refreshed = page.waitForResponse(response => response.url().endsWith('/api/auth/token/refresh/'))
    await page.getByRole('link', { name: 'Classes', exact: true }).first().click()
    expect((await refreshed).status()).toBe(200)
    await expect(page.getByRole('heading', { name: username === 'E2E-001' ? 'Class Schedule' : 'Classes', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toHaveCount(0)
  })
}

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
  await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeVisible()
  await page.unroute(refreshPath)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
})

for (const failure of ['network', '429', '503']) {
  test(`${failure} during restoration offers recovery and Retry succeeds`, async ({ page }) => {
    await signIn(page)
    let logoutRequests = 0
    page.on('request', request => { if (request.url().endsWith('/api/auth/logout/')) logoutRequests += 1 })
    await page.route(refreshPath, route => failure === 'network'
      ? route.abort('connectionfailed')
      : route.fulfill({ status: Number(failure), json: { detail: 'Temporary connection failure' } }))
    await page.reload()
    await expect(page.getByText('Unable to restore your session', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to sign in' })).toBeVisible()
    await page.unroute(refreshPath)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    expect(logoutRequests).toBe(0)
  })
}

test('Go to sign in ignores a delayed restoration result and disables duplicate Retry', async ({ page }) => {
  await signIn(page)
  await page.route(refreshPath, route => route.fulfill({ status: 503, json: { detail: 'Temporary failure' } }))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.unroute(refreshPath)
  const entered = gate()
  const release = gate()
  await page.route(refreshPath, async route => {
    entered.release()
    await release.promise
    await route.continue()
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await entered.promise
  await expect(page.getByRole('button', { name: 'Retrying...' })).toBeDisabled()
  await page.getByRole('button', { name: 'Go to sign in' }).click()
  release.release()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.unrouteAll({ behavior: 'wait' })
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toHaveCount(0)
})

test('two tabs serialize refresh and both remain authenticated', async ({ page, context }) => {
  await signIn(page)
  const other = await context.newPage()
  await other.goto('/admin')
  await expect(other.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  const entered = gate()
  const release = gate()
  const statuses: number[] = []
  let requests = 0
  await context.route(refreshPath, async route => {
    requests += 1
    if (requests === 1) {
      entered.release()
      await release.promise
    }
    const response = await route.fetch()
    statuses.push(response.status())
    await route.fulfill({ response })
  })
  try {
    await page.reload()
    await entered.promise
    await other.reload()
    await expect.poll(() => other.evaluate(async () => {
      const locks = await navigator.locks.query()
      return locks.pending?.filter(lock => lock.name === 'aralforge-auth-cookie').length
    })).toBe(1)
    expect(requests).toBe(1)
  } finally {
    release.release()
  }
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await expect(other.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  expect(statuses).toEqual([200, 200])
})

test('sign out during renewal revokes the rotated cookie and notifies other tabs', async ({ page, context }) => {
  await signIn(page)
  const other = await context.newPage()
  await other.goto('/admin')
  await expect(other.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  const entered = gate()
  const release = gate()
  await page.route(refreshPath, async route => {
    entered.release()
    await release.promise
    await route.continue()
  })
  await expireAccess(page)
  await page.getByRole('link', { name: 'Classes', exact: true }).first().click()
  await entered.promise
  const logout = page.waitForResponse(response => response.url().endsWith('/api/auth/logout/'))
  await page.locator('button[title="Sign out"]:visible').click()
  await page.locator('.logout-confirmation').getByRole('button', { name: 'Sign out', exact: true }).click()
  release.release()
  expect((await logout).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await expect(other.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
})

test('confirmed expiry clears local authentication without sending a logout request', async ({ page }) => {
  await signIn(page)
  let logoutRequests = 0
  page.on('request', request => { if (request.url().endsWith('/api/auth/logout/')) logoutRequests += 1 })
  await page.route(refreshPath, route => route.fulfill({ status: 204 }))
  await expireAccess(page)
  await page.getByRole('link', { name: 'Classes', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  expect(logoutRequests).toBe(0)
})

test('single-tab restoration also works without Web Locks', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { value: undefined }) })
  await signIn(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
})

test('one tab shares renewal and reuses its newest token for a late 401', async ({ page }) => {
  await signIn(page)
  let renewals = 0
  page.on('request', request => { if (request.url().endsWith('/api/auth/token/refresh/')) renewals += 1 })
  const result = await page.evaluate(async () => {
    const api = await import('/src/api.ts')
    api.activateSession({ access: 'expired-access-token' })
    const results = await Promise.all([
      api.refreshToken('expired-access-token'),
      api.refreshToken('expired-access-token'),
      api.refreshToken('expired-access-token'),
    ])
    const late = await api.refreshToken('expired-access-token')
    return results.every(item => item.access === late.access) && late.access !== 'expired-access-token'
  })
  expect(result).toBe(true)
  expect(renewals).toBe(1)
})

test('manual sign out revokes the cookie session and reload stays signed out', async ({ page }) => {
  await signIn(page)
  const logoutResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/logout/'))

  await page.locator('button[title="Sign out"]:visible').click()
  await page.locator('.logout-confirmation').getByRole('button', { name: 'Sign out', exact: true }).click()

  expect((await logoutResponse).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
})
