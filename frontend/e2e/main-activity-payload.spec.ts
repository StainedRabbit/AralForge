import { expect, test } from '@playwright/test'

test('module workspace uses attempt summaries and hydrates only the opened attempt once', async ({ page }) => {
  await page.goto('/modules')
  await page.getByLabel('Username').fill('e2e-student-1')
  await page.getByLabel('Password').fill('e2e-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  const target = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aralforge.session') ?? '{}') as { access?: string }
    const headers = { Authorization: `Bearer ${session.access}` }
    const modulesResponse = await fetch('http://127.0.0.1:8001/api/modules/modules/?limit=100', { headers })
    const modulesPayload = await modulesResponse.json()
    const module = modulesPayload.results.find(
      (candidate: { title: string }) => candidate.title === 'E2E Attempt Hydration Module',
    )
    const workspaceResponse = await fetch(
      `http://127.0.0.1:8001/api/modules/modules/${module.id}/workspace/`,
      { headers },
    )
    const workspace = await workspaceResponse.json()
    return {
      attempt: workspace.activity_attempts[0],
      lesson: workspace.lessons[0].id,
      module: module.id,
      topic: workspace.topics[0].id,
    }
  })

  expect(target.attempt).not.toHaveProperty('question_snapshot')
  expect(target.attempt).not.toHaveProperty('draft_answers')

  const hydrationRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (
      request.method() === 'GET' &&
      /^\/api\/modules\/activity-attempts\/\d+\/$/.test(url.pathname)
    ) {
      hydrationRequests.push(url.pathname)
    }
  })

  await page.goto(`/modules/${target.module}?topic=${target.topic}&lesson=${target.lesson}`)
  await expect(page.getByRole('heading', { name: 'Saved Attempt Hydration' })).toBeVisible()
  await expect(page.getByText('What is loaded only for this attempt?')).toBeVisible()
  await expect(page.getByPlaceholder('Type your answer')).toHaveValue('The saved draft')
  expect(hydrationRequests).toHaveLength(1)
})
