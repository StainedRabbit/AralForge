import { expect, test, type Page } from '@playwright/test'

async function openStudents(page: Page) {
  await page.goto('/admin/students')
  await page.getByLabel('Username').fill('e2e-teacher')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await page.goto('/admin/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
}

test('edits a student account and profile', async ({ page }) => {
  await openStudents(page)

  const accounts = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'User Accounts' }),
  })
  const accountForm = accounts.locator('.admin-form')
  const accountRow = accounts.getByRole('row').filter({ hasText: 'e2e-student-1' })

  await accountRow.getByRole('button', { name: 'Edit User' }).click()
  await expect(accountForm.getByText('Edit User', { exact: true })).toBeVisible()
  await expect(accountForm.getByLabel('Username')).toBeFocused()
  await accountForm.getByLabel('First name').fill('Edited')

  const accountSave = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/accounts\/users\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await accountForm.getByRole('button', { name: 'Save changes' }).click()
  expect((await accountSave).ok()).toBe(true)
  await expect(accountForm.getByText('User saved.', { exact: true })).toBeVisible()
  await expect(accountRow).toContainText('Edited Rivera')

  const profiles = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'Student Profiles' }),
  })
  const profileForm = profiles.locator('.admin-form')
  const profileRow = profiles.getByRole('row').filter({ hasText: 'E2E-001' })

  await profileRow.getByRole('button', { name: 'Edit Student profile' }).click()
  await expect(profileForm.getByText('Edit Student profile', { exact: true })).toBeVisible()
  await expect(profileForm.getByLabel('User')).toBeFocused()
  await profileForm.getByLabel('Section').fill('E2E-EDITED')

  const profileSave = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/accounts\/students\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await profileForm.getByRole('button', { name: 'Save changes' }).click()
  expect((await profileSave).ok()).toBe(true)
  await expect(profileForm.getByText('Student profile saved.', { exact: true })).toBeVisible()
  await expect(profileRow).toContainText('E2E-EDITED')
})

test('brings the student edit form into view on stacked layouts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStudents(page)

  const profiles = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'Student Profiles' }),
  })
  const profileForm = profiles.locator('.admin-form')
  const profileRow = profiles.getByRole('row').filter({ hasText: 'E2E-001' })

  await profileRow.getByRole('button', { name: 'Edit Student profile' }).click()
  await expect(profileForm.getByText('Edit Student profile', { exact: true })).toBeVisible()
  await expect(profileForm).toBeInViewport()
  await expect(profileForm.getByLabel('User')).toBeFocused()
})
