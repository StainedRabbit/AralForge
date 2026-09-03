import { expect, test } from '@playwright/test'

test('login loads only identity, navigation, and dashboard data', async ({ page }) => {
  const apiRequests: string[] = []
  const pageModules: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) apiRequests.push(url.pathname)
    if (url.pathname.startsWith('/src/pages/')) pageModules.push(url.pathname)
  })

  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Coding', exact: true })).toHaveCount(0)

  expect([...new Set(apiRequests.filter(path => path !== '/api/auth/token/'))]).toEqual([
    '/api/accounts/users/me/',
    '/api/overview/navigation/',
    '/api/overview/dashboard/',
  ])
  expect(pageModules).toContain('/src/pages/LoginPage.tsx')
  expect(pageModules).toContain('/src/pages/admin/AdminDashboardPage.tsx')
  expect(pageModules).not.toContain('/src/pages/admin/AdminClassesPage.tsx')
  expect(pageModules).not.toContain('/src/pages/admin/AdminGradesPage.tsx')
})

test('retired teacher coding route returns to the teacher dashboard', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await page.goto('/admin/coding')

  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
})

test('feature navigation loads only that route resources', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  const routeRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) routeRequests.push(`${url.pathname}${url.search}`)
  })
  await page.getByRole('link', { name: 'Modules', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/modules$/)
  await expect(page.getByRole('searchbox')).toBeVisible()
  const scopedLessons = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/modules/lessons/' && url.searchParams.has('topic')
  })
  await page.getByLabel('Subject').selectOption({ label: 'E2EO1 - Lesson Overflow Fixtures' })
  await scopedLessons
  await expect(page.getByText('Overflow Lesson 105', { exact: true })).toBeVisible()

  const uniqueRouteRequests = [...new Set(routeRequests)]
  expect(uniqueRouteRequests.some(url => url.startsWith('/api/subjects/subjects/?'))).toBe(true)
  expect(uniqueRouteRequests.some(url => url.startsWith('/api/modules/modules/?'))).toBe(true)
  expect(uniqueRouteRequests.some(url => url.startsWith('/api/modules/topics/?module='))).toBe(true)
  expect(uniqueRouteRequests.some(url => url.startsWith('/api/modules/lessons/?topic='))).toBe(true)
  expect(uniqueRouteRequests.some(url => url.startsWith('/api/modules/lesson-examples/?lesson='))).toBe(true)
  expect(uniqueRouteRequests.some(url => url === '/api/modules/lessons/?limit=100')).toBe(false)
  expect(uniqueRouteRequests.some(path => path.startsWith('/api/grades/'))).toBe(false)
  expect(uniqueRouteRequests.some(path => path.startsWith('/api/attendance/'))).toBe(false)
  expect(uniqueRouteRequests.some(path => path.startsWith('/api/coding/'))).toBe(false)
  expect(uniqueRouteRequests.length).toBeLessThanOrEqual(10)
})

test('JWT login, refresh, authenticated retry, and logout stay on the configured API', async ({ page }) => {
  const apiRequests: Array<{ authorization: string | null; pathname: string; origin: string }> = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({
        authorization: request.headers().authorization ?? null,
        pathname: url.pathname,
        origin: url.origin,
      })
    }
  })

  await page.goto('/admin')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  const loginRequest = apiRequests.find(request => request.pathname === '/api/auth/token/')
  expect(loginRequest?.origin).toBe('http://127.0.0.1:8001')
  expect(loginRequest?.authorization).toBeNull()

  await page.evaluate(() => {
    const rawSession = localStorage.getItem('aralforge.session')
    if (!rawSession) throw new Error('Expected a stored JWT session.')
    const session = JSON.parse(rawSession) as { access: string; refresh: string }
    localStorage.setItem(
      'aralforge.session',
      JSON.stringify({ ...session, access: 'invalid-access-token' }),
    )
  })
  apiRequests.length = 0

  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  expect(apiRequests.every(request => request.origin === 'http://127.0.0.1:8001')).toBe(true)
  const refreshRequest = apiRequests.find(
    request => request.pathname === '/api/auth/token/refresh/',
  )
  expect(refreshRequest).toBeTruthy()
  expect(refreshRequest?.authorization).toBeNull()

  const identityRequests = apiRequests.filter(
    request => request.pathname === '/api/accounts/users/me/',
  )
  expect(
    identityRequests.some(
      request => request.authorization === 'Bearer invalid-access-token',
    ),
  ).toBe(true)
  expect(
    identityRequests.some(
      request => request.authorization?.startsWith('Bearer ')
        && request.authorization !== 'Bearer invalid-access-token',
    ),
  ).toBe(true)

  apiRequests.length = 0
  await page.locator('button[title="Sign out"]:visible').click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  const storedSession = await page.evaluate(() => localStorage.getItem('aralforge.session'))

  expect(storedSession).toBeNull()
  expect(apiRequests).toEqual([])
})
