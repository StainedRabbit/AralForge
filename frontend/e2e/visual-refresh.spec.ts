import { expect, test, type Page } from '@playwright/test'

const screenshotRoot = 'test-results/visual-refresh'

async function assertNoViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  const overflowElements = dimensions.scrollWidth > dimensions.clientWidth + 1
    ? await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${Array.from(element.classList).map((name) => `.${name}`).join('')}`,
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            scrollWidth: element.scrollWidth,
          }
        })
        .filter(({ left, right }) => left < -1 || right > clientWidth + 1)
        .slice(0, 12)
    })
    : []
  expect(
    dimensions.scrollWidth,
    `Viewport overflow: ${JSON.stringify(overflowElements, null, 2)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

async function signIn(page: Page, username: string) {
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('Modern Forge surfaces render across roles and responsive viewports', async ({ page }) => {
  test.setTimeout(90_000)
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

  await page.setViewportSize({ width: 360, height: 800 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-dashboard-mobile-360x800.png` })

  await page.goto('/modules')
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible()
  await expect(page.locator('.student-module-browser')).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-modules-tablet-768x1024.png` })

  const personalStudySubjectId = await page.evaluate(() => {
    const subjectSelect = document.querySelector<HTMLSelectElement>('.student-module-control select')
    return Array.from(subjectSelect?.options ?? []).find(
      (option) => option.textContent?.includes('E2EH1 - Attempt Hydration Fixture'),
    )?.value
  })
  expect(personalStudySubjectId).toBeTruthy()
  await page.goto(`/modules?subject=${personalStudySubjectId}&context=PERSONAL`)
  await expect(page.locator('.student-module-browser')).toBeVisible()
  const classSelect = page.getByLabel('Class')
  if (await classSelect.count()) {
    const classValue = await classSelect.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).find(Boolean),
    )
    expect(classValue).toBeTruthy()
    await classSelect.selectOption(classValue!)
  }
  const lessonLinks = page.locator('a[href*="lesson="]')
  expect(await lessonLinks.count()).toBeGreaterThan(0)
  const lessonHref = await lessonLinks.first().getAttribute('href')
  expect(lessonHref).toBeTruthy()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(lessonHref!)
  await expect(page.locator('.student-lesson-reader')).toBeVisible()
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-lesson-desktop-1440x900.png` })

  await page.setViewportSize({ width: 430, height: 932 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/student-lesson-mobile-430x932.png` })

  await page.goto('/modules')
  await expect(page.locator('.student-module-browser')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoViewportOverflow(page)
  await expect(page.locator('.mobile-tabbar')).toBeVisible()
  await page.screenshot({ path: `${screenshotRoot}/student-modules-mobile-390x844.png` })

  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  await page.screenshot({ path: `${screenshotRoot}/student-more-sheet-mobile-390x844.png` })
  await page.locator('.mobile-more[role="dialog"]').getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to AralForge' })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'e2e-teacher')
  await page.waitForURL(/\/admin(?:\/)?$/)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-dashboard-desktop-1440x900.png` })

  await page.setViewportSize({ width: 430, height: 932 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-dashboard-mobile-430x932.png` })
  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  await page.screenshot({ path: `${screenshotRoot}/teacher-more-sheet-mobile-430x932.png` })
  await page.keyboard.press('Escape')

  await page.goto('/admin/classes')
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-classes-tablet-768x1024.png` })

  await page.locator('.class-list__item').filter({ hasText: 'E2E101' }).click()
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('h2')).find((heading) => heading.textContent === 'Roster')?.scrollIntoView()
  })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-roster-mobile-390x844.png` })

  await page.goto('/admin/modules')
  await expect(page.getByLabel('Subject')).toBeVisible()
  await page.getByLabel('Subject').selectOption({ label: 'E2E102 - Database Systems' })
  await expect(page.getByRole('heading', { name: 'Resume Topic' })).toBeVisible()
  await page.setViewportSize({ width: 430, height: 932 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-modules-mobile-430x932.png` })
  await page.locator('summary').filter({ hasText: 'Manage' }).click()
  const editModule = page.getByRole('link', { name: 'Edit Module' }).first()
  if (await editModule.count()) {
    await editModule.click()
    await expect(page.getByLabel('Title')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save module' })).toBeVisible()
    const stickyActionsClearNavigation = await page.evaluate(() => {
      const save = document.querySelector<HTMLElement>('.lesson-editor__actions')
      const navigation = document.querySelector<HTMLElement>('.mobile-tabbar')
      return Boolean(save && navigation && save.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top)
    })
    expect(stickyActionsClearNavigation).toBe(true)
    await assertNoViewportOverflow(page)
    await page.screenshot({ path: `${screenshotRoot}/teacher-module-editor-mobile-430x932.png` })
  }

  await page.goto('/admin/gradebook')
  await expect(page.getByRole('heading', { name: 'Gradebook' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoViewportOverflow(page)
  await page.screenshot({ path: `${screenshotRoot}/teacher-gradebook-mobile-390x844.png` })

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
