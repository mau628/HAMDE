/**
 * Line endings.
 *
 * CodeMirror normalises a document to `\n` when it loads it: `EditorState.create`
 * splits on `/\r\n?|\n/` and joins with the line separator, which is `\n` by
 * default. That is convenient inside the editor and destructive on the way out —
 * saving a CRLF file after typing one character rewrote every line in it.
 *
 * So the editor keeps `\n` internally, the document remembers what the file used,
 * and the write path puts it back.
 */

export type LineEnding = '\n' | '\r\n' | '\r'

const CRLF = /\r\n/g
const CR = /\r(?!\n)/g
const LF = /(?<!\r)\n/g

/**
 * The line ending a file uses, by majority.
 *
 * A file with mixed endings has to become consistent the moment we rewrite it, so
 * the most common one wins — the same choice a text editor makes. A file with no
 * line breaks at all is `\n`, which is what a new line typed into it will be.
 */
export function detectLineEnding(text: string): LineEnding {
  const crlf = text.match(CRLF)?.length ?? 0
  const cr = text.match(CR)?.length ?? 0
  const lf = text.match(LF)?.length ?? 0

  if (crlf === 0 && cr === 0) return '\n'
  if (crlf >= cr && crlf >= lf) return '\r\n'
  if (cr >= lf) return '\r'
  return '\n'
}

/** Converts any mix of endings to `\n`, the form the editor works in. */
export function toLf(text: string): string {
  return text.replace(CRLF, '\n').replace(CR, '\n')
}

/** Converts `\n` back to the ending the file uses. */
export function fromLf(text: string, ending: LineEnding): string {
  return ending === '\n' ? text : text.replace(LF, ending)
}
