import { expect, test, type Page } from '@playwright/test'

const phoneViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]

async function signIn(page: Page, username: string) {
  await page.goto('/')
  await page.getByLabel('Student number').fill(username)
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden()
}

async function expectNoDocumentOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1)
}

async function expectTouchTargets(page: Page) {
  const undersized = await page.locator('.mobile-tabbar a, .mobile-tabbar button, .mobile-header a, .mobile-header button').evaluateAll(
    (elements) => elements
      .filter((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.width < 44 || bounds.height < 44
      })
      .map((element) => ({
        height: element.getBoundingClientRect().height,
        label: element.getAttribute('aria-label') || element.textContent,
        width: element.getBoundingClientRect().width,
      })),
  )
  expect(undersized).toEqual([])
}

test('student mobile shell reaches primary and secondary destinations accessibly', async ({ page }) => {
  await page.setViewportSize(phoneViewports[1])
  await signIn(page, 'E2E-001')
  await page.waitForURL(/\/$/)

  const tabbar = page.getByRole('navigation', { name: 'Primary mobile' })
  await expect(tabbar.getByRole('link')).toHaveCount(4)
  await expect(tabbar.getByRole('button', { name: 'More navigation' })).toBeVisible()
  await expect(tabbar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await expectTouchTargets(page)

  const accountButton = page.getByRole('button', { name: 'Open account and more navigation' })
  await accountButton.focus()
  await accountButton.click()
  const sheet = page.getByRole('dialog', { name: /Alex Rivera/ })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Attendance/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Profile/ })).toBeVisible()
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(accountButton).toBeFocused()

  await tabbar.getByRole('button', { name: 'More navigation' }).click()
  await sheet.getByRole('link', { name: /Attendance/ }).click()
  await expect(page).toHaveURL(/\/attendance$/)
  await expect(tabbar.getByRole('button', { name: 'More navigation' })).toHaveClass(/active/)

  await page.goto('/activities/999?context=PERSONAL')
  await expect(tabbar.getByRole('link', { name: 'Modules' })).toHaveAttribute('aria-current', 'page')

  for (const viewport of phoneViewports) {
    await page.setViewportSize(viewport)
    await expectNoDocumentOverflow(page)
  }
})

test('teacher mobile shell maps nested routes and exposes every secondary area', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await signIn(page, 'e2e-teacher')
  await page.waitForURL(/\/admin\/?$/)

  const tabbar = page.getByRole('navigation', { name: 'Primary mobile' })
  await expect(tabbar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await expectTouchTargets(page)

  await tabbar.getByRole('button', { name: 'More navigation' }).click()
  const sheet = page.getByRole('dialog', { name: /E2E Teacher/ })
  await expect(sheet.getByRole('link', { name: /Students/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Attendance/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Gradebook/ })).toBeVisible()
  await sheet.getByRole('link', { name: /Students/ }).click()
  await expect(page).toHaveURL(/\/admin\/students$/)
  await expect(tabbar.getByRole('button', { name: 'More navigation' })).toHaveClass(/active/)

  await page.goto('/admin/submissions/999')
  await expect(tabbar.getByRole('link', { name: 'Grades' })).toHaveAttribute('aria-current', 'page')
  await page.goto('/admin/modules/999/progress')
  await expect(tabbar.getByRole('link', { name: 'Modules' })).toHaveAttribute('aria-current', 'page')
  await expectNoDocumentOverflow(page)
})
