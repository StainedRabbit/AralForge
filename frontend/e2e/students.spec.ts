import { expect, test, type Page } from '@playwright/test'

async function openStudents(page: Page) {
  await page.goto('/admin/students')
  await page.getByLabel('Student number').fill('e2e-teacher')
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
  const accountRow = accounts.getByRole('row').filter({ hasText: 'E2E-001' })

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
  await expect(profileForm.getByLabel('Student number')).toBeFocused()
  await expect(profileForm.getByLabel('Section')).toHaveCount(0)
  await expect(profileForm.getByLabel('Year level')).toHaveCount(0)

  const profileSave = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/accounts\/students\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await profileForm.getByRole('button', { name: 'Save changes' }).click()
  expect((await profileSave).ok()).toBe(true)
  await expect(profileForm.getByText('Student profile saved.', { exact: true })).toBeVisible()
  await expect(profileRow).toContainText('E2E-001')
})

test('creates a student with student-number credentials in one request', async ({ page }) => {
  await openStudents(page)

  const quickSetup = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'Quick Student Setup' }),
  })
  await expect(quickSetup.getByLabel('Username')).toHaveCount(0)
  await expect(quickSetup.getByLabel('Password')).toHaveCount(0)
  await expect(quickSetup.getByLabel('Section')).toHaveCount(0)
  await expect(quickSetup.getByLabel('Year level')).toHaveCount(0)
  await quickSetup.getByLabel('First name').fill('Quick')
  await quickSetup.getByLabel('Last name').fill('Student')
  await quickSetup.getByLabel('Email').fill('quick.student@example.test')
  await quickSetup.getByLabel('Student number').fill('E2E-QUICK-01')

  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/accounts/students/',
  )
  await quickSetup.getByRole('button', { name: 'Create student' }).click()
  const response = await created
  expect(response.ok()).toBe(true)
  expect(response.request().postDataJSON()).toEqual({
    email: 'quick.student@example.test',
    first_name: 'Quick',
    is_active: true,
    last_name: 'Student',
    student_number: 'E2E-QUICK-01',
  })
  await expect(quickSetup).toContainText(
    'The initial username and password are the student number.',
  )
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
  await expect(profileForm.getByLabel('Student number')).toBeFocused()
})

test('activates, revokes, and renews module access without payment fields', async ({ page }) => {
  await openStudents(page)

  const bulkAccess = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'Bulk Module Access' }),
  })
  await expect(bulkAccess.getByLabel('Amount')).toHaveCount(0)
  await expect(bulkAccess.getByLabel('Reference')).toHaveCount(0)

  const studentAccess = page.locator('.admin-resource').filter({
    has: page.getByRole('heading', { name: 'Student Module Access' }),
  })
  await studentAccess.getByLabel('Student').selectOption({ label: 'Jamie Santos (E2E-002)' })
  await studentAccess.getByRole('button', { name: 'Manage Modules' }).click()

  const dialog = page.getByRole('dialog', { name: 'Module Access' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Amount paid')).toHaveCount(0)
  await expect(dialog.getByLabel('Receipt / reference')).toHaveCount(0)
  await dialog.locator('.student-module-grant-form select').selectOption({
    label: 'E2E102 - E2E Resume Learning Module',
  })

  const activated = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/modules/access/',
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  const activationResponse = await activated
  expect(activationResponse.ok()).toBe(true)
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('amount_paid')
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('payment_status')
  expect(activationResponse.request().postDataJSON()).not.toHaveProperty('payment_reference')
  await expect(dialog).toContainText('Module access activated.')
  await expect(dialog.getByText('Active', { exact: true })).toBeVisible()

  const revoked = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Revoke' }).click()
  expect((await revoked).ok()).toBe(true)
  await expect(dialog.getByText('Revoked', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Renew' }).click()
  const renewed = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && /\/api\/modules\/access\/\d+\/$/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole('button', { name: 'Activate Access' }).click()
  expect((await renewed).ok()).toBe(true)
  await expect(dialog.getByText('Active', { exact: true })).toBeVisible()
})
