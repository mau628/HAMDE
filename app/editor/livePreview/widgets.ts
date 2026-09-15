import { WidgetType } from '@codemirror/view'

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
