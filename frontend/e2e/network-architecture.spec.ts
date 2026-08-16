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
  await page.getByLabel('Username').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Teacher Console/ })).toBeVisible()

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

test('feature navigation loads only that route resources', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Username').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Teacher Console/ })).toBeVisible()

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
