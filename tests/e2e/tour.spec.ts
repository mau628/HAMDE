import { expect, test } from '@playwright/test'

// A first visit: the welcome dialog is out of the way, the tour has not been seen.
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:3000',
        localStorage: [{ name: 'hamde:hide-welcome', value: '1' }],
      },
    ],
  },
})

const tour = (page: import('@playwright/test').Page) => page.getByRole('dialog')

test('walks a first visitor through the page, then never again', async ({ page }) => {
  await page.goto('/')

  await expect(tour(page)).toContainText('Open a folder')
  await expect(tour(page)).toContainText('1 / 4')

  for (const title of ['Write with live preview', 'Or drop a file in', 'Print and widen']) {
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(tour(page)).toContainText(title)
  }

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(tour(page)).toBeHidden()

  await page.reload()
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(tour(page)).toBeHidden()
})

test('can be skipped from any step, for good', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(tour(page)).toBeHidden()

  await page.reload()
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(tour(page)).toBeHidden()
})

test('closes on Escape', async ({ page }) => {
  await page.goto('/')
  await expect(tour(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(tour(page)).toBeHidden()
})

test('keeps the card on screen on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')

  for (let step = 0; step < 4; step++) {
    const box = (await tour(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    await page.getByRole('button', { name: step === 3 ? 'Done' : 'Next' }).click()
  }
})

test('replays from the help button in the sidebar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(tour(page)).toBeHidden()

  await page.getByRole('button', { name: 'Show the tour' }).click()

  await expect(tour(page)).toContainText('Open a folder')
  await expect(tour(page)).toContainText('1 / 4')
})
