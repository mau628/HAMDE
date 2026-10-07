/**
 * The webview's page and its Content Security Policy.
 *
 * The policy is the web app's (security/csp.ts) with the webview's own origin in
 * place of 'self'. It is not weaker anywhere:
 *
 * - `default-src 'none'`, so a forgotten directive fails closed.
 * - `connect-src 'none'`: no script can make a request. Nothing in a document, and
 *   no bug in the editor, can send a note anywhere.
 * - `script-src` names only the extension's own files. No inline script, no eval.
 * - `img-src` names the webview origin, which serves files VS Code has been told
 *   it may serve (`localResourceRoots`), and `https:`, for an image a document
 *   points to on the web. That is the one request made on a document's behalf.
 * - `style-src` needs 'unsafe-inline' for the reason the web app does: CodeMirror
 *   injects a <style> element, and Mermaid inlines styles in its SVG. See
 *   docs/security.md.
 *
 * No VS Code import, so the policy can be unit-tested and the same page can be
 * loaded in a plain browser by the end-to-end tests.
 */

export function webviewCsp(cspSource: string): string {
  const directives: Record<string, string> = {
    'default-src': "'none'",
    'script-src': cspSource,
    'style-src': `${cspSource} 'unsafe-inline'`,
    'img-src': `${cspSource} https:`,
    'font-src': cspSource,
    'connect-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'none'",
    'object-src': "'none'",
    'frame-src': "'none'",
  }

  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
}

export interface WebviewPage {
  /** The origin the webview serves the extension's files from. */
  cspSource: string
  scriptUri: string
  styleUri: string
}

export function webviewHtml({ cspSource, scriptUri, styleUri }: WebviewPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attribute(webviewCsp(cspSource))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="${attribute(styleUri)}">
</head>
<body>
<div id="editor"></div>
<script type="module" src="${attribute(scriptUri)}"></script>
</body>
</html>
`
}

function attribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
