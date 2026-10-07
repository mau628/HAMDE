/**
 * Smoke tests, run inside a real VS Code by ../runSmoke.mjs.
 *
 * These cover what only VS Code can answer: whether the manifest makes it open the
 * right files in HAMDE, whether the webview's script really loads there, and
 * whether undo reaches the document. Everything the webview does once it is running
 * is tested as a page instead, in tests/e2e/vscodeWebview.spec.ts.
 *
 * Plain CommonJS with no test framework: VS Code loads this file itself and calls
 * `run`, and a handful of checks do not justify another dependency.
 */
const assert = require('node:assert/strict')
const vscode = require('vscode')

const manifest = require('../../package.json')

const VIEW_TYPE = 'hamde.markdown'
const EXTENSION_ID = manifest.publisher + '.' + manifest.name

/** Waits for something VS Code does asynchronously, such as opening a tab. */
async function until(check, description, timeout = 20_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + description)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function activeInput() {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.input
}

function workspaceFile(name) {
  return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, name)
}

async function open(uri) {
  await vscode.commands.executeCommand('vscode.open', uri)
  return until(() => {
    const input = activeInput()
    return input?.uri?.toString() === uri.toString() ? input : undefined
  }, uri.toString() + ' to open')
}

/**
 * Each test starts with no editors open, so none depends on the one before it.
 *
 * Reverted first: a test that failed halfway may have left the document modified,
 * and VS Code would then stop to ask before closing it.
 */
async function closeEverything() {
  const ignore = () => {}
  await vscode.commands.executeCommand('workbench.action.files.revert').then(ignore, ignore)
  await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(ignore, ignore)
}

const tests = {
  async 'a .md file opens in HAMDE by default'() {
    const input = await open(workspaceFile('note.md'))

    assert.ok(input instanceof vscode.TabInputCustom, 'expected a custom editor tab')
    assert.equal(input.viewType, VIEW_TYPE)
  },

  async 'so does a .markdown file'() {
    const input = await open(workspaceFile('long-name.markdown'))

    assert.ok(input instanceof vscode.TabInputCustom, 'expected a custom editor tab')
    assert.equal(input.viewType, VIEW_TYPE)
  },

  /**
   * The selector names the schemes it applies to. A Markdown document that is not
   * a file on disk, which is what the read-only side of a Git diff is, must stay
   * in the text editor.
   */
  async 'a Markdown document from another scheme stays in the text editor'() {
    const registration = vscode.workspace.registerTextDocumentContentProvider('hamde-smoke', {
      provideTextDocumentContent: () => '# Not a file\n',
    })

    try {
      const input = await open(vscode.Uri.parse('hamde-smoke:/virtual.md'))
      assert.ok(input instanceof vscode.TabInputText, 'expected a text editor tab')
    } finally {
      registration.dispose()
    }
  },

  /**
   * Source Control compares the file with a version that is not a file. VS Code
   * uses a custom editor for a diff only when both sides would open in it, so
   * naming the scheme in the selector is also what keeps such a diff a text diff.
   */
  async 'a diff against a version that is not a file is a text diff'() {
    const registration = vscode.workspace.registerTextDocumentContentProvider('hamde-smoke', {
      provideTextDocumentContent: () => '# Note\n\nAn earlier text.\n',
    })

    try {
      const title = 'note.md (earlier ↔ now)'
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.parse('hamde-smoke:/note.md'),
        workspaceFile('note.md'),
        title,
      )
      const tab = await until(() => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab
        return active?.label === title ? active : undefined
      }, 'the diff to open')

      assert.ok(tab.input instanceof vscode.TabInputTextDiff, 'expected a text diff tab')
    } finally {
      registration.dispose()
    }
  },

  /** The script is an ES module served by VS Code under the page's own policy. */
  async 'the webview loads its script and asks for the document'() {
    const uri = workspaceFile('note.md')
    await open(uri)

    const extension = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(extension, 'the extension is not installed under ' + EXTENSION_ID)
    const api = await extension.activate()

    // Generous: the first webview of a freshly installed VS Code also has to
    // register the service worker that serves its files.
    await until(
      () => api.readyDocuments().includes(uri.toString()),
      'the webview to announce itself',
      60_000,
    )
  },

  /**
   * The webview keeps no undo history of its own, so this is the only undo there
   * is: VS Code's, on the document, while HAMDE is the active editor.
   */
  async 'undo in HAMDE undoes the edit in the document'() {
    const uri = workspaceFile('note.md')
    await open(uri)

    const document = await vscode.workspace.openTextDocument(uri)
    const original = document.getText()

    const edit = new vscode.WorkspaceEdit()
    edit.insert(uri, new vscode.Position(0, 0), 'Changed. ')
    assert.ok(await vscode.workspace.applyEdit(edit))
    assert.equal(document.getText(), 'Changed. ' + original)

    await vscode.commands.executeCommand('undo')
    await until(() => document.getText() === original, 'undo to restore the document')
  },

  async 'the width command flips the setting'() {
    await open(workspaceFile('note.md'))
    const wide = () => vscode.workspace.getConfiguration('hamde.editor').get('wide')

    assert.equal(wide(), false)
    await vscode.commands.executeCommand('hamde.toggleEditorWidth')
    await until(() => wide() === true, 'the setting to turn on')
    await vscode.commands.executeCommand('hamde.toggleEditorWidth')
    await until(() => wide() === false, 'the setting to turn off')
  },
}

exports.run = async function run() {
  const failures = []

  for (const [name, test] of Object.entries(tests)) {
    try {
      await test()
      console.log('  ok    ' + name)
    } catch (error) {
      console.log('  FAIL  ' + name + '\n        ' + (error?.message ?? error))
      failures.push(name)
    }
    await closeEverything()
  }

  if (failures.length > 0) throw new Error(failures.length + ' smoke test(s) failed')
  console.log('  ' + Object.keys(tests).length + ' smoke tests passed')
}
