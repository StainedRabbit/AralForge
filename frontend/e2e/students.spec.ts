import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function openStudents(page: Page) {
  await page.goto('/admin/students')
  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
}

test('student list is the only view and loads without advanced resources', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await openStudents(page)
  await expect(page.getByRole('region', { name: 'Student list' })).toBeVisible()
  await expect(page.locator('.students-table tbody tr').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add student', exact: true })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /View student|View E2E-/ })).toHaveCount(0)
  await expect(page.getByText('Advanced tools', { exact: true })).toHaveCount(0)
  expect(requests.some((url) => /\/api\/accounts\/users\/\?/.test(url))).toBe(false)
})

test('add student preserves validation inputs and shows credentials', async ({ page }) => {
  await openStudents(page)
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add student' })
  await dialog.getByLabel('Student number', { exact: true }).fill('E2E-001')
  await dialog.getByLabel('First name', { exact: true }).fill('New')
  await dialog.getByLabel('Middle name (optional)').fill('Middle')
  await dialog.getByLabel('Last name', { exact: true }).fill('Student')
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByLabel('Student number', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('New')

  const studentNumber = `E2E-NEW-${randomUUID().slice(0, 8)}`
  await dialog.getByLabel('Student number', { exact: true }).fill(studentNumber)
  await dialog.getByRole('button', { name: 'Create student' }).click()
  await expect(dialog.getByRole('heading', { name: 'Student account created' })).toBeVisible()
  await expect(dialog.locator('dd')).toHaveText(studentNumber)
  await dialog.getByRole('button', { name: 'Close student panel' }).click()
  await page.getByLabel('Search students', { exact: true }).fill(studentNumber)
  await expect(page.locator('.students-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.students-table')).toContainText(studentNumber)
  await expect(page.getByRole('button', { name: /View student/ })).toHaveCount(0)
})

test('server pagination and profile filtering preserve distinct account status', async ({ page }) => {
  let pageTwo = false
  const profile = (id: number, active: boolean) => ({ id, user: id, student_number: `TEST-${id}`, is_active: active, joined_at: '',
    user_detail: { id, username: `TEST-${id}`, first_name: 'Test', middle_name: 'Middle', last_name: String(id), full_name: `Test Middle ${id}`, email: '', role: 'STUDENT', is_active: false } })
  await page.route('**/api/accounts/students/?*', async (route) => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search')
    const inactive = url.searchParams.get('status') === 'inactive'
    const cursor = url.searchParams.get('cursor')
    if (cursor === 'page-two') pageTwo = true
    const results = search === 'missing' ? [] : search ? [profile(31, true)] : inactive ? [profile(32, false)] : cursor ? [profile(31, true)] : Array.from({ length: 30 }, (_, index) => profile(index + 1, true))
    await route.fulfill({ json: { count: 31, previous: null, next: !search && !inactive && !cursor ? 'http://127.0.0.1:8001/api/accounts/students/?pagination=cursor&cursor=page-two' : null, results } })
  })
  await openStudents(page)
  await expect(page.locator('.students-table')).toContainText('TEST-30')
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.students-table')).toContainText('TEST-31')
  expect(pageTwo).toBe(true)
  await page.getByLabel('Search students', { exact: true }).fill('Middle 31')
  await expect(page.locator('.students-table tbody tr')).toHaveCount(1)
  await expect(page.locator('td[data-label="Profile"]')).toHaveText('Active')
  await expect(page.locator('td[data-label="Account"]')).toHaveText('Inactive')
  await page.getByLabel('Search students', { exact: true }).fill('missing')
  await expect(page.getByRole('heading', { name: 'No matching students' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Profile status').selectOption('inactive')
  await expect(page.locator('.students-table')).toContainText('TEST-32')
})

test('mobile list and add dialog keep focus and protect unsaved input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudents(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add student' })
  await dialog.getByLabel('First name', { exact: true }).fill('Unsaved')
  page.once('dialog', (prompt) => prompt.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('First name', { exact: true })).toHaveValue('Unsaved')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  page.once('dialog', (prompt) => prompt.accept())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add student', exact: true })).toBeFocused()
})

test('damaged names remain visible in the list and cannot be submitted', async ({ page }) => {
  await page.route('**/api/accounts/students/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    const profiles = payload.results ?? [payload]
    for (const profile of profiles) {
      if (profile.student_number === 'E2E-001') {
        profile.user_detail.first_name = 'Espa\ufffdol'
        profile.user_detail.full_name = 'Espa\ufffdol Rivera'
      }
    }
    await route.fulfill({ response, json: payload })
  })
  await openStudents(page)
  await expect(page.locator('.students-table').getByText('Name needs correction.')).toBeVisible()
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  const form = page.getByRole('form', { name: 'New student' })
  await form.getByLabel('First name', { exact: true }).fill('Espa\ufffdol')
  await expect(form.getByLabel('First name', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByRole('button', { name: 'Create student' })).toBeDisabled()
})

test('list exposes retry and an empty state without hiding creation', async ({ page }) => {
  let fail = true
  await page.route('**/api/accounts/students/?*', async (route) => {
    await route.fulfill(fail ? { status: 400, json: { detail: 'Students could not load.' } }
      : { json: { count: 0, next: null, previous: null, results: [] } })
  })
  await openStudents(page)
  await expect(page.getByRole('alert')).toContainText('Students could not load.')
  fail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No students yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add student', exact: true }).first()).toBeEnabled()
})
