import * as vscode from 'vscode'

import { HamdeEditorProvider, VIEW_TYPE } from './editorProvider'

/** What the extension exposes to code outside it. Only its own tests use this. */
export interface HamdeApi {
  readyDocuments(): string[]
}

export function activate(context: vscode.ExtensionContext): HamdeApi {
  const provider = new HamdeEditorProvider(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider),

    // A setting rather than state inside the webview, so it survives the webview
    // being discarded and applies to every open editor at once.
    vscode.commands.registerCommand('hamde.toggleEditorWidth', async () => {
      const settings = vscode.workspace.getConfiguration('hamde.editor')
      await settings.update(
        'wide',
        !settings.get('wide', false),
        vscode.ConfigurationTarget.Global,
      )
    }),
  )

  return { readyDocuments: () => provider.readyDocuments() }
}
