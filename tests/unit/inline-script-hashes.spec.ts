import { describe, expect, it } from 'vitest'
import {
  collectInlineScriptHashes,
  withScriptHashes,
} from '../../security/inline-script-hashes.mjs'

describe('collectInlineScriptHashes', () => {
  it('hashes an inline script', () => {
    const [hash, ...rest] = collectInlineScriptHashes('<script>window.a=1</script>')
    expect(hash).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/)
    expect(rest).toEqual([])
  })

  it('produces a different hash when the script changes by one character', () => {
    const [first] = collectInlineScriptHashes('<script>window.a=1</script>')
    const [second] = collectInlineScriptHashes('<script>window.a=2</script>')
    expect(first).not.toBe(second)
  })

  it('ignores external scripts, which script-src \'self\' already covers', () => {
    expect(collectInlineScriptHashes('<script src="/app.js"></script>')).toEqual([])
  })

  it('ignores non-executable data blocks such as Nuxt payloads', () => {
    const html = '<script type="application/json" id="__NUXT_DATA__">[{"a":1}]</script>'
    expect(collectInlineScriptHashes(html)).toEqual([])
  })

  it('hashes module scripts', () => {
    expect(collectInlineScriptHashes('<script type="module">export {}</script>')).toHaveLength(1)
  })

  it('deduplicates identical scripts', () => {
    const html = '<script>window.a=1</script><script>window.a=1</script>'
    expect(collectInlineScriptHashes(html)).toHaveLength(1)
  })

  it('finds every inline script in a page', () => {
    const html = '<script>a()</script><script src="/x.js"></script><script>b()</script>'
    expect(collectInlineScriptHashes(html)).toHaveLength(2)
  })
})

describe('withScriptHashes', () => {
  const policy = "default-src 'none'; script-src 'self'; connect-src 'none'"

  it('extends script-src and leaves other directives untouched', () => {
    const result = withScriptHashes(policy, ["'sha256-abc='"])
    expect(result).toBe("default-src 'none'; script-src 'self' 'sha256-abc='; connect-src 'none'")
  })

  it('returns the policy unchanged when there is nothing to hash', () => {
    expect(withScriptHashes(policy, [])).toBe(policy)
  })

  it('never introduces unsafe-inline', () => {
    expect(withScriptHashes(policy, ["'sha256-abc='"])).not.toContain("'unsafe-inline'")
  })

  it('fails loudly if the policy has no script-src to extend', () => {
    expect(() => withScriptHashes("default-src 'none'", ["'sha256-abc='"])).toThrow(/script-src/)
  })
})
