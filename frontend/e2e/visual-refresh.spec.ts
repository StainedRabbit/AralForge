import { expect, test, type Page } from '@playwright/test'

const screenshotRoot = 'test-results/visual-refresh'

async function assertNoViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

async function signIn(page: Page, username: string) {
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('Modern Forge surfaces render across roles and responsive viewports', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const missingAssets: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (
      response.status() === 404 &&
      url.origin === 'http://127.0.0.1:4173' &&
      /\.(?:css|ico|js|png|svg|webp)$/i.test(url.pathname)
    ) {
      missingAssets.push(url.pathname)
    }
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await expect(page.locator('img[src*="aralforge-login-illustration"]')).toBeVisible()
  await page.getByLabel('Student number').focus()
  const focusRing = await page.getByLabel('Student number').evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )
  expect(focusRing).not.toBe('none')
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/login-desktop-1440x900.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/login-mobile-390x844.png` })

  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'E2E-001')
  await page.waitForURL(/\/$/)
  await expect(page.locator('.dashboard-hero h1')).toBeVisible()
  await expect(page.locator('img[src*="aralforge-dashboard-journey"]')).toBeVisible()
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-dashboard-desktop-1440x900.png` })

  await page.goto('/modules')
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible()
  await expect(page.locator('.student-module-browser')).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-modules-tablet-768x1024.png` })

  const lessonLinks = page.locator('a[href*="lesson="]')
  expect(await lessonLinks.count()).toBeGreaterThan(0)
  const lessonHref = await lessonLinks.first().getAttribute('href')
  expect(lessonHref).toBeTruthy()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(lessonHref!)
  await expect(page.locator('.student-lesson-reader')).toBeVisible()
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-lesson-desktop-1440x900.png` })

  await page.goto('/modules')
  await expect(page.locator('.student-module-browser')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoViewportOverflow(page)
  await expect(page.locator('.mobile-tabbar')).toBeVisible()
  await page.screenshot({ path: `${screenshotRoot}/student-modules-mobile-390x844.png` })

  await page.locator('button[title="Sign out"]:visible').click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'e2e-teacher')
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Teacher Console/ })).toBeVisible()
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-dashboard-desktop-1440x900.png` })

  await page.goto('/admin/classes')
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-classes-tablet-768x1024.png` })

  const brokenImages = await page.locator('img').evaluateAll((images) =>
    images
      .filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0)
      .map((image) => (image as HTMLImageElement).currentSrc),
  )
  expect(brokenImages).toEqual([])
  expect(missingAssets).toEqual([])
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
