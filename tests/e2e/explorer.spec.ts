import { expect, test, type Page } from '@playwright/test'

import { installCancellingPicker, installFakePicker, removePicker } from './support/installFakePicker'

const FOLDER = {
  'README.md': '# Readme\n\nRoot note.\n',
  'photo.png': 'not markdown',
  Projects: {
    'api.md': '# API\n\nEndpoints live here.\n',
    'todo.md': '# Todo\n',
    Deep: { 'buried.md': '# Buried\n' },
  },
  Personal: {},
  '.obsidian': { 'config.json': '{}' },
}

async function openFolder(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).click()
  await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible()
}

test('opens a folder and shows only Markdown files and directories', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  await expect(page.getByRole('button', { name: 'README.md' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Personal' })).toBeVisible()

  await expect(page.getByRole('button', { name: 'photo.png' })).toBeHidden()
  await expect(page.getByRole('button', { name: '.obsidian' })).toBeHidden()
})

test('lists directories before files', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  const names = await page.locator('.explorer__tree > .node > .node__row').allInnerTexts()

  expect(names.map((name) => name.replace(/\s+/g, ' ').trim())).toEqual([
    '▸ Personal',
    '▸ Projects',
    'README.md',
  ])
})

test('expands nested directories on demand', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  // Nothing inside Projects is in the DOM until it is expanded: the tree is lazy.
  await expect(page.getByRole('button', { name: 'api.md' })).toBeHidden()

  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('button', { name: 'api.md' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'buried.md' })).toBeHidden()

  await page.getByRole('button', { name: 'Deep' }).click()
  await expect(page.getByRole('button', { name: 'buried.md' })).toBeVisible()
})

test('collapses a directory again', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  const projects = page.getByRole('button', { name: 'Projects' })
  await projects.click()
  await expect(projects).toHaveAttribute('aria-expanded', 'true')

  await projects.click()
  await expect(projects).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'api.md' })).toBeHidden()
})

test('marks an empty directory as empty rather than leaving it blank', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  await page.getByRole('button', { name: 'Personal' }).click()
  await expect(page.getByText('Empty')).toBeVisible()
})

test('opens a file and shows its content', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  await page.getByRole('button', { name: 'README.md' }).click()

  await expect(page.locator('.cm-content')).toContainText('# Readme')
  await expect(page.locator('.cm-content')).toContainText('Root note.')
})

test('reads a nested file and marks it active in the tree', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'api.md' }).click()

  await expect(page.locator('.cm-content')).toContainText('Endpoints live here.')
  await expect(page.getByRole('button', { name: 'api.md' })).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.status__path')).toContainText('Projects/api.md')
})

test('switches between documents', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await openFolder(page)

  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'api.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('# API')

  await page.getByRole('button', { name: 'todo.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('# Todo')
  await expect(page.locator('.cm-content')).not.toContainText('# API')
})

test('the scratch document stays editable, since it is backed by no file', async ({ page }) => {
  await installFakePicker(page, FOLDER)
  await page.goto('/')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('Scratch. ')

  await expect(page.locator('.cm-content')).toContainText('Scratch. # YAMDE')
})

test('treats a cancelled picker as a normal outcome', async ({ page }) => {
  await installCancellingPicker(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.locator('.shell__notice')).toBeHidden()
  await expect(page.locator('.explorer')).toBeHidden()
})

test('explains itself on a browser without the File System Access API', async ({ page }) => {
  await removePicker(page)
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Open Folder' })).toBeDisabled()
  await expect(page.locator('.shell__notice')).toContainText('Chromium-based')
})

test('opening a folder issues no network request', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') external.push(request.url())
  })

  await installFakePicker(page, FOLDER)
  await openFolder(page)
  await page.getByRole('button', { name: 'README.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('# Readme')

  expect(external).toEqual([])
})
