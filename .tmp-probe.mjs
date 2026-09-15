import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.addInitScript(() => {
  const written = new Map()
  window.__writtenFiles = written
  let clock = 1000000
  const state = { contents: '# Note\n', lastModified: ++clock }
  const fileHandle = {
    kind: 'file', name: 'note.md',
    async getFile() {
      return { name: 'note.md', size: new TextEncoder().encode(state.contents).byteLength,
        lastModified: state.lastModified, text: async () => state.contents }
    },
    async createWritable() {
      let buffer = ''
      return {
        async write(c) { buffer = typeof c.data === 'string' ? c.data : new TextDecoder().decode(c.data) },
        async truncate() {}, async close() { state.contents = buffer; written.set('note.md', buffer) }, async abort() {},
      }
    },
    async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
  }
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: async () => ({
      kind: 'directory', name: 'notes',
      async *entries() { yield ['note.md', fileHandle] },
      async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
    }),
  })
})
await page.goto('http://localhost:3000/')
await page.getByRole('button', { name: 'Open Folder' }).click()
await page.getByRole('button', { name: 'note.md' }).click()
await page.waitForTimeout(1200)   // longer than the debounce, and we touch nothing
console.log('writes after merely opening the file:', await page.evaluate(() => [...window.__writtenFiles.keys()]))
console.log('status:', await page.locator('.status__state').textContent())
await browser.close()
