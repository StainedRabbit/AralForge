import { expect, test } from '@playwright/test'

const legalDocuments = [
  ['/legal/privacy', 'Privacy Notice'],
  ['/legal/terms', 'Terms of Use'],
  ['/legal/storage', 'Cookie and Browser Storage Notice'],
  ['/legal/acceptable-use', 'Acceptable Use and Academic Integrity'],
  ['/legal/copyright', 'Copyright and Takedown Policy'],
  ['/legal/accessibility', 'Accessibility and Contact'],
] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('aralforge-legal-test-ready')) {
      localStorage.clear()
      sessionStorage.setItem('aralforge-legal-test-ready', 'true')
    }
  })
})

test('publishes every legal document without requiring an account', async ({ page }) => {
  for (const [path, heading] of legalDocuments) {
    await page.goto(path)
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(page.getByText('Effective September 10, 2026')).toBeVisible()
    await expect(page.getByText('Version 2026-09-10')).toBeVisible()
    await expect(page.getByText('Launch draft', { exact: true })).toBeVisible()
    const footer = page.locator('.legal-site__footer')
    await expect(footer.getByRole('link', { name: 'support@example.invalid' })).toBeVisible()
    await expect(footer.getByRole('link', { name: 'privacy@example.invalid' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to AralForge' })).toBeVisible()
  }
})

test('shows, acknowledges, and reopens the essential-storage notice', async ({ page }) => {
  await page.goto('/')
  const notice = page.getByRole('region', { name: 'Essential browser storage only' })
  await expect(notice).toBeVisible()
  await expect(notice.getByText('This launch does not use advertising, analytics, or marketing trackers.')).toBeVisible()
  await expect(notice.getByRole('button', { name: 'Got it' })).toBeFocused()

  await notice.getByRole('button', { name: 'Got it' }).click()
  await expect(notice).toBeHidden()
  await page.reload()
  await expect(notice).toBeHidden()

  await page.getByRole('button', { name: 'Storage notice' }).click()
  await expect(notice).toBeVisible()
  await expect(notice.getByRole('button', { name: 'Got it' })).toBeFocused()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('aralforge.legal.storage-notice'))).toBe('2026-09-10')
})

test('links legal information before and after authentication', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByRole('navigation', { name: 'Legal and privacy' })).toBeVisible()
  await page.getByRole('link', { name: 'Privacy', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeVisible()

  await page.goto('/')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')

  const sidebar = page.locator('.sidebar')
  await expect(sidebar.getByRole('link', { name: 'Legal center' })).toBeVisible()
  await page.getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Legal and privacy' })).toBeVisible()
  await expect(page.locator('.profile-legal-panel').getByRole('link', { name: 'Terms', exact: true })).toBeVisible()
})

test('makes legal links available from the mobile navigation sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Got it' }).click()
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')

  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: /alex rivera/i })
  await expect(sheet.getByRole('link', { name: 'Legal center' })).toBeVisible()
  await sheet.getByRole('link', { name: 'Legal center' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Legal and privacy center' })).toBeVisible()
})

test('launch UI contains no commercial, tracking, or public-registration controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /register|sign up|subscribe|checkout|pay now|advertis/i })).toHaveCount(0)
  await expect(page.locator('script[src*="analytics"], script[src*="googletag"], script[src*="facebook"], script[src*="stripe"]')).toHaveCount(0)
  await expect(page.getByText(/payment processing, subscriptions, refunds, advertising, analytics, marketing, and public registration are outside this launch scope/i)).toHaveCount(0)

  await page.goto('/legal/terms')
  await expect(page.getByText(/payment processing, subscriptions, refunds, advertising, analytics, marketing, and public registration are outside this launch scope/i)).toBeVisible()
  await expect(page.getByText(/future commercial feature requires separate review and approval/i)).toBeVisible()
})
