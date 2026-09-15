import { expect, test, type Page } from '@playwright/test'


async function signIn(page: Page, username: string) {
  await page.goto('/')
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden()
}


test('student Modules navigation never renders a pending count', async ({ page }) => {
  let navigationRequests = 0
  await page.route('**/api/overview/navigation/', async (route) => {
    navigationRequests += 1
    await route.fulfill({
      body: JSON.stringify({ role: 'student', pending_count: 7 }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await signIn(page, 'E2E-001')

  await expect(page.locator('.sidebar .nav-link[href="/modules"] small')).toHaveCount(0)
  await expect(page.locator('.notification-dot')).toHaveCount(0)
  expect(navigationRequests).toBe(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.mobile-tabbar a[href="/modules"] small')).toHaveCount(0)
  await expect(page.locator('.notification-dot')).toHaveCount(0)
})


test('teacher Grades navigation retains its pending count', async ({ page }) => {
  await page.route('**/api/overview/navigation/', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ role: 'teacher', pending_count: 7 }),
      contentType: 'application/json',
      status: 200,
    })
  })

  await signIn(page, 'e2e-teacher')

  await expect(page.locator('.sidebar .nav-link[href="/admin/grades"] small')).toHaveText('7')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.mobile-tabbar a[href="/admin/grades"] small')).toHaveText('7')
  await expect(page.locator('.notification-dot')).toHaveText('7')
})
