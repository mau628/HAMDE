import { WidgetType, type EditorView } from '@codemirror/view'

import { taskToggleAt } from './task'

/**
 * Replaces a list marker with a bullet.
 *
 * The document keeps whatever the user typed (`-`, `*` or `+`); only the rendering
 * is unified. Built with DOM calls and `textContent`, never innerHTML — the rule
 * holds even for a string this small.
 */
export class BulletWidget extends WidgetType {
  override eq(): boolean {
    // Every bullet renders identically, so CodeMirror can reuse the DOM.
    return true
  }

  override toDOM(): HTMLElement {
    const bullet = document.createElement('span')
    bullet.className = 'cm-md-bullet'
    bullet.textContent = '•'
    // The bullet is decoration, not content: a screen reader gets the list
    // structure from the Markdown text itself.
    bullet.setAttribute('aria-hidden', 'true')
    return bullet
  }

  override ignoreEvent(): boolean {
    // Let clicks through, so clicking a bullet puts the cursor there and reveals
    // the source line like clicking anywhere else does.
    return false
  }
}

/**
 * Replaces a task marker (`[ ]` / `[x]`) with a real checkbox.
 *
 * A native `<input type="checkbox">` rather than a styled span: it is focusable,
 * it responds to Space, and assistive technology already knows what it is.
 * CodeMirror renders widgets with `contenteditable="false"`, and the default
 * `ignoreEvent` keeps the editor from treating the click as editor input, so the
 * browser's own checkbox behaviour works untouched.
 *
 * Clicking it makes the one document change any widget in this app is allowed to
 * make: a single character between the brackets.
 */
export class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super()
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  override toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'cm-md-task-checkbox'
    checkbox.checked = this.checked
    checkbox.setAttribute('aria-label', this.checked ? 'Completed task' : 'Task')

    // `change` rather than `click`, so Space on a focused checkbox works too.
    checkbox.addEventListener('change', () => this.toggle(view, checkbox))

    return checkbox
  }

  private toggle(view: EditorView, checkbox: HTMLInputElement): void {
    // The position is read from the DOM at click time. A widget CodeMirror reused
    // elsewhere in the document would otherwise toggle the task it used to be on.
    const position = positionOf(view, checkbox)
    const toggle = position === null ? null : taskToggleAt(view.state, position)

    if (toggle === null) {
      // Nothing was changed, so undo the browser's optimistic flip.
      checkbox.checked = this.checked
      return
    }

    view.dispatch({
      changes: { from: toggle.position, to: toggle.position + 1, insert: toggle.insert },
    })
  }
}

function positionOf(view: EditorView, node: Node): number | null {
  try {
    return view.posAtDOM(node)
  } catch {
    // posAtDOM throws for a node that is no longer part of the content, which can
    // happen if the document changed between render and click.
    return null
  }
}
