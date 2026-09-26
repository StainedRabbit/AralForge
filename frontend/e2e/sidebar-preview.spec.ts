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
  const navigationGeometry = () => sidebar.evaluate((element) => {
    const bounds = (selector: string) => [...element.querySelectorAll<HTMLElement>(selector)].map((item) => {
      const rect = item.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100)
    })
    return {
      brand: bounds('.brand__icon'),
      navigation: bounds('.nav-link .icon'),
    }
  })

  for (const [viewportWidth, expandedWidth] of [[1440, 268], [1024, 246]]) {
    await page.setViewportSize({ width: viewportWidth, height: 960 })
    await page.mouse.move(700, 500)
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await expect(sidebar).not.toHaveClass(/sidebar--preview/)
    await expect(sidebar.locator('.user-chip__logout')).toBeVisible()
    const appearance = sidebar.getByRole('group', { name: 'Appearance' })
    await expect(appearance.locator('.appearance-control__option')).toHaveCount(3)
    await expect(appearance.getByRole('button', { name: 'System' })).toBeVisible()
    await expect(appearance.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect(appearance.getByRole('button', { name: 'Dark' })).toBeVisible()
    await expect.poll(() => appearance.getByRole('button', { name: 'System' }).evaluate((button) => button.getBoundingClientRect().height)).toBe(28)
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(76)
    const collapsedGeometry = await navigationGeometry()

    await page.mouse.move(70, 10)
    await expect(sidebar).toHaveClass(/sidebar--preview/)
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(expandedWidth)
    await expect(sidebar.locator('.nav-link').first().locator('span')).toBeVisible()
    await expect(sidebar.locator('.sidebar__user-info strong')).toBeVisible()
    await expect(sidebar.getByRole('group', { name: 'Appearance' })).toBeVisible()
    expect(await navigationGeometry()).toEqual(collapsedGeometry)

    await sidebar.getByRole('button', { name: 'Expand navigation' }).click()
    await expect(sidebar).not.toHaveClass(/sidebar--collapsed/)
    await expect.poll(() => sidebar.locator('.nav-link').first().evaluate((link) => link.getBoundingClientRect().height)).toBe(42)
    await expect.poll(() => sidebar.getByRole('button', { name: 'System' }).evaluate((button) => button.getBoundingClientRect().height)).toBe(32)
    const expandedGeometry = await navigationGeometry()
    expect(expandedGeometry).toEqual(collapsedGeometry)

    await sidebar.getByRole('link', { name: 'Modules', exact: true }).click()
    await expect(page).toHaveURL(/\/modules\/?$/)
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('button', { name: 'Collapse navigation' }).click()
    await page.mouse.move(700, 500)
  }

  await page.setViewportSize({ width: 1440, height: 560 })
  await page.mouse.move(700, 500)
  await sidebar.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(sidebar).not.toHaveClass(/sidebar--collapsed/)
  const signOut = sidebar.getByRole('button', { name: 'Sign out' })
  await expect(signOut).toBeVisible()
  await expect.poll(() => signOut.evaluate((button) => {
    const bounds = button.getBoundingClientRect()
    return bounds.bottom <= window.innerHeight && bounds.top >= 0
  })).toBe(true)
  await expect.poll(() => sidebar.locator('.sidebar__top .nav-list').evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sidebar).toBeHidden()
  await expect(page.locator('.mobile-tabbar')).toBeVisible()
  await page.getByRole('button', { name: 'More navigation', exact: true }).click()
  const more = page.locator('.mobile-more')
  await expect(more.locator('.user-chip .avatar')).toHaveCount(0)
  await expect(more.locator('.user-chip strong')).toBeVisible()
})
