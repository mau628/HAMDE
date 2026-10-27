import { expect, test } from '@playwright/test'

test('the shell loads with no console errors and no outbound requests', async ({ page }) => {
  const consoleErrors: string[] = []
  const externalRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      externalRequests.push(request.url())
    }
  })

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'HAMDE' })).toBeVisible()
  await expect(page.getByText('Files never leave your device.')).toBeVisible()

  // A CSP violation surfaces as a console error, so this assertion also guards
  // the policy against library changes.
  expect(consoleErrors).toEqual([])
  expect(externalRequests).toEqual([])
})

test('the production CSP is present and forbids network access', async ({ page }) => {
  await page.goto('/')
  const policy = await page
    .locator('meta[http-equiv="content-security-policy" i]')
    .getAttribute('content')

  expect(policy).toContain("default-src 'none'")
  expect(policy).toContain("connect-src 'none'")
})

test('hovering the collapsed sidebar shows it over the editor until the pointer leaves', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByRole('complementary', { name: 'Files' })
  const editor = page.locator('.shell__editor')
  const openFolder = page.getByRole('button', { name: 'Open Folder' })

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const editorLeft = (await editor.boundingBox())!.x
  await expect(openFolder).toBeHidden()

  await page.mouse.move(600, 300)
  await sidebar.hover({ position: { x: 20, y: 300 } })
  await expect(openFolder).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  // Laid over the editor, which does not move.
  expect((await editor.boundingBox())!.x).toBe(editorLeft)

  await page.mouse.move(600, 300)
  await expect(openFolder).toBeHidden()
})
