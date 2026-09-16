import { expect, test, type Page } from '@playwright/test'

import { installFakePicker } from './support/installFakePicker'

const DOCUMENT = [
  '# Tasks',
  '',
  '- [ ] first task',
  '- [x] second task',
  '- [ ] third task with **bold**',
  '  - [ ] a nested one',
  '',
  'Not a task: - [ ] inside a paragraph',
  '',
  '```',
  '- [ ] inside a fenced block',
  '```',
  '',
].join('\n')

const FOLDER = { 'tasks.md': DOCUMENT }

async function onDisk(page: Page): Promise<string | undefined> {
  return page.evaluate(() =>
    (window as unknown as { __writtenFiles: Map<string, string> }).__writtenFiles.get('tasks.md'),
  )
}

async function open(page: Page) {
  await installFakePicker(page, FOLDER)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'tasks.md' }).click()
  await expect(page.locator('.status__path')).toHaveText('tasks.md')
  // Cursor on the last, empty line: nothing is revealed as source.
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

const checkboxes = (page: Page) => page.locator('.cm-md-task-checkbox')

test('renders a checkbox for each task, in the right state', async ({ page }) => {
  await open(page)

  await expect(checkboxes(page)).toHaveCount(4)
  await expect(checkboxes(page).nth(0)).not.toBeChecked()
  await expect(checkboxes(page).nth(1)).toBeChecked()
  await expect(checkboxes(page).nth(2)).not.toBeChecked()
  await expect(checkboxes(page).nth(3)).not.toBeChecked()

  // The raw markers are gone from the task lines themselves. They stay visible in
  // the paragraph and the fenced block below, which the next test covers.
  const taskLines = await page.locator('.cm-line:has(.cm-md-task-checkbox)').allInnerTexts()
  expect(taskLines.join('\n')).not.toContain('[ ]')
  expect(taskLines.join('\n')).not.toContain('[x]')
})

test('does not make a checkbox out of text that is not a task', async ({ page }) => {
  await open(page)

  // Four real tasks; the paragraph and the fenced block are not among them.
  await expect(checkboxes(page)).toHaveCount(4)

  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('Not a task: - [ ] inside a paragraph')
  expect(shown).toContain('- [ ] inside a fenced block')
})

test('clicking a checkbox completes the task on disk', async ({ page }) => {
  await open(page)

  await checkboxes(page).nth(0).click()

  await expect(checkboxes(page).nth(0)).toBeChecked()
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await onDisk(page)
  expect(saved).toContain('- [x] first task')
  // Every other line is untouched.
  expect(saved).toContain('- [x] second task')
  expect(saved).toContain('- [ ] third task with **bold**')
  expect(saved).toContain('  - [ ] a nested one')
})

test('clicking a completed task reopens it', async ({ page }) => {
  await open(page)

  await checkboxes(page).nth(1).click()

  await expect(checkboxes(page).nth(1)).not.toBeChecked()
  await expect(page.locator('.status__state')).toHaveText('Saved')
  expect(await onDisk(page)).toContain('- [ ] second task')
})

test('toggling a nested task leaves its parent alone', async ({ page }) => {
  await open(page)

  await checkboxes(page).nth(3).click()
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await onDisk(page)
  expect(saved).toContain('  - [x] a nested one')
  expect(saved).toContain('- [ ] third task with **bold**')
})

test('changes exactly one character of the document', async ({ page }) => {
  await open(page)

  await checkboxes(page).nth(0).click()
  await expect(page.locator('.status__state')).toHaveText('Saved')

  const saved = await onDisk(page)
  // Character for character, only the box contents differ.
  expect(saved).toBe(DOCUMENT.replace('- [ ] first task', '- [x] first task'))
})

test('the click does not move the cursor', async ({ page }) => {
  await open(page)

  // The cursor is on the last line; clicking a checkbox must not reveal the task
  // line as source, or the box the user just clicked would vanish under them.
  await checkboxes(page).nth(0).click()

  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).not.toContain('[x] first task')
  await expect(checkboxes(page)).toHaveCount(4)
})

test('a completed task is dimmed', async ({ page }) => {
  await open(page)

  await expect(page.locator('.cm-md-task-done')).toHaveCount(1)
  await checkboxes(page).nth(0).click()
  await expect(page.locator('.cm-md-task-done')).toHaveCount(2)
})

test('the marker shows as source on the line the cursor is on', async ({ page }) => {
  await open(page)

  await page.locator('.cm-line', { hasText: 'first task' }).first().click()

  const shown = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(shown).toContain('- [ ] first task')
  // The other tasks still render as checkboxes.
  await expect(checkboxes(page)).toHaveCount(3)
})

test('toggling can be undone', async ({ page }) => {
  await open(page)

  await checkboxes(page).nth(0).click()
  await expect(checkboxes(page).nth(0)).toBeChecked()

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+z')

  await expect(checkboxes(page).nth(0)).not.toBeChecked()
})

test('toggling issues no network request', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await open(page)
  await checkboxes(page).nth(0).click()
  await expect(page.locator('.status__state')).toHaveText('Saved')

  expect(external).toEqual([])
})
