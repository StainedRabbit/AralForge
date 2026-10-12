import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Student number').fill('E2E-001')
  await page.getByLabel('Password', { exact: true }).fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.app-shell')).toBeVisible()
}

async function returnContexts(page: Page, contexts: Array<{
  context_type: 'CLASS' | 'PERSONAL'
  schedule: number | null
  label: string
}>) {
  await page.route('**/api/modules/activities/999/context-options/', (route) => route.fulfill({
    contentType: 'application/json',
    json: { contexts },
  }))
}

test('contextless activity opens directly when there is one active class', async ({ page }) => {
  await signIn(page)
  await returnContexts(page, [{ context_type: 'CLASS', schedule: 71, label: 'CS101 A' }])

  await page.goto('/activities/999')

  await expect(page).toHaveURL('/activities/999?schedule=71')
  await expect(page.getByRole('heading', { name: 'Choose a learning context' })).toHaveCount(0)
})

test('contextless activity opens directly in Personal Study when that is the only context', async ({ page }) => {
  await signIn(page)
  await returnContexts(page, [{ context_type: 'PERSONAL', schedule: null, label: 'Personal Study' }])

  await page.goto('/activities/999')

  await expect(page).toHaveURL('/activities/999?context=PERSONAL')
})

test('contextless activity asks the student to choose among active classes', async ({ page }) => {
  await signIn(page)
  await returnContexts(page, [
    { context_type: 'CLASS', schedule: 71, label: 'CS101 A' },
    { context_type: 'CLASS', schedule: 72, label: 'CS101 B' },
  ])

  await page.goto('/activities/999')

  await expect(page.getByRole('heading', { name: 'Choose a learning context' })).toBeVisible()
  await page.getByRole('link', { name: /CS101 B.*Class activity workspace/ }).click()
  await expect(page).toHaveURL('/activities/999?schedule=72')
})

test('contextless activity offers recovery when no active context is available', async ({ page }) => {
  await signIn(page)
  await returnContexts(page, [])

  await page.goto('/activities/999')

  await expect(page.getByText('No active learning context', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Modules' })).toHaveAttribute('href', '/modules')
})

test('module activity card preserves Personal Study context', async ({ page }) => {
  await signIn(page)
  const target = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${window.__ARALFORGE_E2E_ACCESS_TOKEN__}` }
    const response = await fetch('http://127.0.0.1:8001/api/modules/modules/?limit=100', { headers })
    const payload = await response.json()
    const module = payload.results.find(
      (candidate: { title: string }) => candidate.title === 'E2E Attempt Hydration Module',
    )
    const workspaceResponse = await fetch(
      `http://127.0.0.1:8001/api/modules/modules/${module.id}/workspace/?context=PERSONAL`,
      { headers },
    )
    const workspace = await workspaceResponse.json()
    return { lessonId: workspace.lessons[0].id, moduleId: module.id, topicId: workspace.topics[0].id }
  })
  expect(target.moduleId).toEqual(expect.any(Number))
  await page.goto(`/modules/${target.moduleId}?topic=${target.topicId}&lesson=${target.lessonId}&context=PERSONAL`)

  const activityCard = page.locator('.activity-card').first()
  await expect(activityCard).toBeVisible()
  await activityCard.click()
  await expect(page).toHaveURL(/\/activities\/\d+\?context=PERSONAL/)
})

test('module activity card preserves the selected class context', async ({ page }) => {
  await signIn(page)
  const fixture = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${window.__ARALFORGE_E2E_ACCESS_TOKEN__}` }
    const response = await fetch('http://127.0.0.1:8001/api/modules/modules/?limit=100', { headers })
    const payload = await response.json()
    const module = payload.results.find(
      (candidate: { title: string }) => candidate.title === 'E2E Attempt Hydration Module',
    )
    const workspaceResponse = await fetch(
      `http://127.0.0.1:8001/api/modules/modules/${module.id}/workspace/?context=PERSONAL`,
      { headers },
    )
    const workspace = await workspaceResponse.json()
    return {
      lessonId: workspace.lessons[0].id,
      moduleId: module.id,
      topicId: workspace.topics[0].id,
      workspace,
    }
  })
  expect(fixture.moduleId).toEqual(expect.any(Number))
  fixture.workspace.learning_context = { context_type: 'CLASS', schedule: 71, label: 'CS101 A' }
  await page.route(`**/api/modules/modules/${fixture.moduleId}/workspace/**`, (route) => route.fulfill({
    contentType: 'application/json',
    json: fixture.workspace,
  }))
  await page.route(`**/api/modules/activities/*/workspace/**`, (route) => route.fulfill({ status: 500, body: '{}' }))

  await page.goto(`/modules/${fixture.moduleId}?topic=${fixture.topicId}&lesson=${fixture.lessonId}&schedule=71`)
  await page.locator('.activity-card').first().click()

  await expect(page).toHaveURL(/\/activities\/\d+\?schedule=71/)
})
