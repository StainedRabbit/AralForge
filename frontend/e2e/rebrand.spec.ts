import { expect, test } from '@playwright/test'

test('shows the AralForge identity and migrates legacy browser storage', async ({ page, request }) => {
  await page.goto('/admin')
  await expect(page).toHaveTitle('AralForge')
  await expect(page.getByRole('img', { name: 'AralForge' })).toHaveCount(2)
  await expect(page.getByText('Forge Knowledge, Build Future.', { exact: true })).toBeVisible()
  await expect(page.locator('img.brand__logo[src="/brand/aralforge-logo-horizontal.png"]')).toHaveCount(1)
  await expect(page.locator('img.brand__logo[src="/brand/aralforge-logo-horizontal-dark.png"]')).toHaveCount(1)
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1)
  await expect(page.locator('link[rel="icon"][href="/brand/aralforge-icon-dark.png"]:not([media])')).toHaveCount(1)
  await expect(page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await expect(page.getByLabel('Student number')).toHaveAttribute('placeholder', 'Enter your Student Number')
  await expect(page.getByText('API endpoint:', { exact: false })).toHaveCount(0)

  for (const asset of [
    '/brand/aralforge-icon-dark.png',
    '/apple-touch-icon.png',
  ]) {
    const response = await request.get(asset)
    expect(response.ok(), `${asset} should load successfully`).toBe(true)
  }

  await page.getByLabel('Student number').fill('e2e-teacher')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  await page.evaluate(() => {
    const session = localStorage.getItem('aralforge.session')
    if (!session) throw new Error('Expected an authenticated AralForge session.')

    localStorage.setItem('ezoryx.session', session)
    localStorage.removeItem('aralforge.session')
    localStorage.setItem('ezoryx:lesson-draft:v2:lesson:77', JSON.stringify({
      savedAt: '2026-08-19T00:00:00Z',
      value: { title: 'Legacy lesson draft' },
    }))
    localStorage.setItem('ezoryx.main-activity-draft.88', JSON.stringify({
      title: 'Legacy main activity draft',
    }))
    localStorage.setItem('ezoryx:presentation-text-size', 'large')
    localStorage.setItem('ezoryx:lesson-draft:v2:invalid', '{invalid')
    localStorage.setItem('ezoryx.main-activity-draft.invalid', '{invalid')
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  const migrated = await page.evaluate(() => ({
    legacySession: localStorage.getItem('ezoryx.session'),
    session: localStorage.getItem('aralforge.session'),
    legacyLesson: localStorage.getItem('ezoryx:lesson-draft:v2:lesson:77'),
    lesson: localStorage.getItem('aralforge:lesson-draft:v2:lesson:77'),
    legacyActivity: localStorage.getItem('ezoryx.main-activity-draft.88'),
    activity: localStorage.getItem('aralforge.main-activity-draft.88'),
    legacyTextSize: localStorage.getItem('ezoryx:presentation-text-size'),
    textSize: localStorage.getItem('aralforge:presentation-text-size'),
    invalidLegacyLesson: localStorage.getItem('ezoryx:lesson-draft:v2:invalid'),
    invalidLesson: localStorage.getItem('aralforge:lesson-draft:v2:invalid'),
    invalidLegacyActivity: localStorage.getItem('ezoryx.main-activity-draft.invalid'),
    invalidActivity: localStorage.getItem('aralforge.main-activity-draft.invalid'),
  }))

  expect(migrated.session).toBeTruthy()
  expect(migrated.legacySession).toBeNull()
  expect(migrated.lesson).toContain('Legacy lesson draft')
  expect(migrated.legacyLesson).toBeNull()
  expect(migrated.activity).toContain('Legacy main activity draft')
  expect(migrated.legacyActivity).toBeNull()
  expect(migrated.textSize).toBe('large')
  expect(migrated.legacyTextSize).toBeNull()
  expect(migrated.invalidLegacyLesson).toBe('{invalid')
  expect(migrated.invalidLesson).toBeNull()
  expect(migrated.invalidLegacyActivity).toBe('{invalid')
  expect(migrated.invalidActivity).toBeNull()

  await page.evaluate(() => {
    localStorage.setItem('ezoryx.session', '{"legacy":true}')
  })
  await page.locator('button[title="Sign out"]:visible').click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  const sessionKeys = await page.evaluate(() => ({
    current: localStorage.getItem('aralforge.session'),
    legacy: localStorage.getItem('ezoryx.session'),
  }))
  expect(sessionKeys).toEqual({ current: null, legacy: null })
})

test('does not migrate a malformed legacy session', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('aralforge.session')
    localStorage.setItem('ezoryx.session', '{invalid')
  })
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  const values = await page.evaluate(() => ({
    current: localStorage.getItem('aralforge.session'),
    legacy: localStorage.getItem('ezoryx.session'),
  }))
  expect(values).toEqual({ current: null, legacy: '{invalid' })
})
