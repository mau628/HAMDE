import { describe, expect, it } from 'vitest'

import { productionCsp } from '../../../security/csp'
import { webviewCsp, webviewHtml } from '../../../vscode/src/webviewHtml'

const SOURCE = 'https://webview.example'

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split('; ').map((part) => {
      const [name, ...value] = part.split(' ')
      return [name!, value.join(' ')]
    }),
  )
}

describe('the webview content security policy', () => {
  const policy = directives(webviewCsp(SOURCE))

  it('denies everything that is not explicitly allowed', () => {
    expect(policy.get('default-src')).toBe("'none'")
  })

  it('forbids all network access', () => {
    expect(policy.get('connect-src')).toBe("'none'")
  })

  it('runs only the extension’s own scripts: nothing inline, nothing evaluated', () => {
    expect(policy.get('script-src')).toBe(SOURCE)
  })

  it('loads images only from the webview origin, never a remote host', () => {
    expect(policy.get('img-src')).toBe(SOURCE)
  })

  it('blocks plugins, framing and form submission', () => {
    expect(policy.get('object-src')).toBe("'none'")
    expect(policy.get('frame-src')).toBe("'none'")
    expect(policy.get('form-action')).toBe("'none'")
    expect(policy.get('base-uri')).toBe("'none'")
  })

  it('is at least as strict as the web app’s policy, directive by directive', () => {
    const web = directives(productionCsp)

    for (const [name, value] of policy) {
      const theirs = web.get(name)
      expect(theirs, name).toBeDefined()
      // Same policy with the webview origin where the site says 'self', minus
      // anything the site allows that the webview has no use for.
      const allowed = theirs!.replaceAll("'self'", SOURCE).split(' ')
      for (const token of value.split(' ')) expect(allowed, name).toContain(token)
    }
  })
})

describe('the webview page', () => {
  const html = webviewHtml({
    cspSource: SOURCE,
    scriptUri: SOURCE + '/main.js',
    styleUri: SOURCE + '/webview.css',
  })

  it('carries the policy', () => {
    expect(html).toContain(`content="${webviewCsp(SOURCE)}"`)
  })

  it('has no inline script or style, which the policy would refuse', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).not.toContain('<style')
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })

  it('escapes what it interpolates', () => {
    const hostile = webviewHtml({
      cspSource: SOURCE,
      scriptUri: SOURCE + '/main.js"><script>alert(1)</script>',
      styleUri: SOURCE + '/webview.css',
    })

    expect(hostile).not.toContain('<script>alert(1)</script>')
  })
})
