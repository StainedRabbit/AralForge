import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, username: string) {
  await page.goto('/')
  const notice = page.getByRole('button', { name: 'Got it' })
  if (await notice.isVisible()) await notice.click()
  await page.getByLabel('Student number or username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
}

async function chooseTheme(page: Page, name: 'System' | 'Light' | 'Dark') {
  const appearance = page.locator('.sidebar').getByRole('group', { name: 'Appearance' })
  await appearance.getByRole('button', { name, exact: true }).click()
  await expect(appearance.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
}

test('theme follows each account across reloads and browsers', async ({ page, browser }) => {
  await signIn(page, 'E2E-001')
  await chooseTheme(page, 'Dark')
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark')
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await page.goto('/classes')
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
  await page.reload()
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const anotherBrowser = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    const sameUser = await anotherBrowser.newPage()
    await signIn(sameUser, 'E2E-001')
    await expect(sameUser.locator('html')).toHaveAttribute('data-effective-theme', 'dark')
    await expect(sameUser.locator('.sidebar').getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await anotherBrowser.close()
  }

  const teacherBrowser = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    const teacher = await teacherBrowser.newPage()
    await signIn(teacher, 'e2e-teacher')
    await expect(teacher.locator('.sidebar').getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await chooseTheme(teacher, 'Dark')
    await expect(teacher.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    await teacher.goto('/admin/classes')
    await expect(teacher.locator('.page-header h1')).toBeVisible()
    await teacher.goto('/admin/students')
    await expect(teacher.locator('.page-header h1')).toBeVisible()
    await chooseTheme(teacher, 'Light')
    await teacher.setViewportSize({ width: 390, height: 844 })
    await teacher.getByRole('button', { name: 'More navigation', exact: true }).click()
    await expect(teacher.locator('.mobile-more').getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await teacher.locator('.mobile-more').getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(teacher.locator('html')).toHaveAttribute('data-effective-theme', 'dark')
  } finally {
    await teacherBrowser.close()
  }
})

test('system tracks device changes and a failed save restores the prior theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark')
  await signIn(page, 'E2E-001')
  await chooseTheme(page, 'System')
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'light')

  await page.route('**/api/accounts/users/me/theme/', (route) => route.fulfill({ status: 503, json: { detail: 'Try again later.' } }))
  await page.locator('.sidebar').getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('.sidebar .appearance-control').getByRole('alert')).toContainText('could not be saved')
  await expect(page.locator('html')).toHaveAttribute('data-effective-theme', 'light')
  await expect(page.locator('.sidebar').getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
