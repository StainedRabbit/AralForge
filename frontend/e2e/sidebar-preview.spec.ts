import { expect, test } from '@playwright/test'

test('sidebar preview keeps icon geometry stable across desktop widths', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('aralforge.sidebar.collapsed.v1', 'true')
  })
  await page.goto('/')
  await page.getByLabel('Student number or username').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  const sidebar = page.locator('.sidebar')
  await expect(sidebar.locator('.user-chip .avatar')).toHaveCount(0)
  const iconGeometry = () => sidebar.evaluate((element) => {
    const bounds = (selector: string) => [...element.querySelectorAll<HTMLElement>(selector)].map((item) => {
      const rect = item.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100)
    })
    return {
      brand: bounds('.brand__icon'),
      toggle: bounds('.sidebar__toggle .icon'),
      navigation: bounds('.nav-link .icon'),
      account: bounds('.sidebar__bottom .avatar'),
      signOut: bounds('.sidebar__bottom .icon-button--wide .icon'),
    }
  })

  for (const [viewportWidth, expandedWidth] of [[1440, 268], [1024, 246]]) {
    await page.setViewportSize({ width: viewportWidth, height: 960 })
    await page.mouse.move(700, 500)
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await expect(sidebar).not.toHaveClass(/sidebar--preview/)
    await expect(sidebar.locator('.user-chip')).toBeHidden()
    const appearance = sidebar.getByRole('group', { name: 'Appearance' })
    await expect(appearance.getByRole('button')).toHaveCount(3)
    await expect(appearance.getByRole('button', { name: 'System' })).toBeVisible()
    await expect(appearance.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect(appearance.getByRole('button', { name: 'Dark' })).toBeVisible()
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(76)
    const collapsedGeometry = await iconGeometry()

    await page.mouse.move(70, 10)
    await expect(sidebar).toHaveClass(/sidebar--preview/)
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(expandedWidth)
    await expect(sidebar.locator('.nav-link').first().locator('span')).toBeVisible()
    await expect(sidebar.locator('.sidebar__user-info strong')).toBeVisible()
    await expect(sidebar.getByRole('group', { name: 'Appearance' })).toBeVisible()
    expect(await iconGeometry()).toEqual(collapsedGeometry)

    await sidebar.getByRole('button', { name: 'Keep navigation expanded' }).click()
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/)
    const expandedGeometry = await iconGeometry()
    expect(expandedGeometry).toEqual(collapsedGeometry)

    await sidebar.getByRole('link', { name: 'Modules', exact: true }).click()
    await expect(page).toHaveURL(/\/modules\/?$/)
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('button', { name: 'Collapse navigation' }).click()
    await page.mouse.move(700, 500)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sidebar).toBeHidden()
  await expect(page.locator('.mobile-tabbar')).toBeVisible()
  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  const more = page.locator('.mobile-more')
  await expect(more.locator('.user-chip .avatar')).toHaveCount(0)
  await expect(more.locator('.user-chip strong')).toBeVisible()
})
