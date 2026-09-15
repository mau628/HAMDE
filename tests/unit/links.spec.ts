import { describe, expect, it } from 'vitest'

import { isSafeHref } from '../../app/services/links'

/**
 * Link targets come from Markdown, which is untrusted content. These tests are the
 * specification for what may be opened; anything not listed here must be refused.
 */

describe('allowed targets', () => {
  it.each([
    'https://example.com',
    'https://example.com/path?query=1#hash',
    'http://example.com',
    'HTTPS://EXAMPLE.COM',
    'mailto:someone@example.com',
    '  https://example.com  ',
  ])('allows %j', (href) => {
    expect(isSafeHref(href)).toBe(true)
  })
})

describe('refused targets', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    '  javascript:alert(1)',
    // A newline inside the scheme is the classic way past a naive pattern; URL
    // parsing resolves it to the real protocol instead.
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'blob:https://example.com/uuid',
    'file:///etc/passwd',
    'about:blank',
    'chrome://settings',
    'ws://example.com',
    'ftp://example.com',
    'view-source:https://example.com',
  ])('refuses %j', (href) => {
    expect(isSafeHref(href)).toBe(false)
  })
})

describe('targets with no protocol of their own', () => {
  it.each([
    '',
    '   ',
    'note.md',
    './sibling.md',
    '../parent/note.md',
    '/absolute/path.md',
    '#heading-anchor',
    'example.com',
    'not a url at all',
  ])('refuses %j, since relative targets are resolved later', (href) => {
    expect(isSafeHref(href)).toBe(false)
  })
})
