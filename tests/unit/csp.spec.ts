import { describe, expect, it } from 'vitest'
import { buildCsp, productionCsp } from '../../security/csp'

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split('; ').map((part) => {
      const [name, ...value] = part.split(' ')
      return [name!, value.join(' ')]
    }),
  )
}

describe('content security policy', () => {
  it('denies everything that is not explicitly allowed', () => {
    expect(directives(productionCsp).get('default-src')).toBe("'none'")
  })

  it('forbids all network access in production', () => {
    expect(directives(productionCsp).get('connect-src')).toBe("'none'")
  })

  it('allows the websocket that Nuxt HMR needs, but only in development', () => {
    expect(directives(buildCsp(true)).get('connect-src')).toContain('ws:')
  })

  it('never allows inline scripts in production', () => {
    // Production relies on per-script hashes added at build time instead.
    expect(directives(productionCsp).get('script-src')).toBe("'self'")
  })

  it('allows inline scripts in development, where the build hashes do not exist', () => {
    // Without this the dev server cannot boot: Nuxt writes its runtime config as an
    // inline script, and nothing has hashed it yet.
    expect(directives(buildCsp(true)).get('script-src')).toContain("'unsafe-inline'")
  })

  it('limits the development relaxations to scripts and connections', () => {
    const dev = directives(buildCsp(true))
    const production = directives(productionCsp)

    for (const [name, value] of production) {
      if (name === 'script-src' || name === 'connect-src') continue
      expect(dev.get(name)).toBe(value)
    }
  })

  it('allows local images via blob: but no remote image hosts', () => {
    const imgSrc = directives(productionCsp).get('img-src')!
    expect(imgSrc).toContain('blob:')
    expect(imgSrc).not.toContain('https:')
  })

  it('blocks plugins, framing and form submission', () => {
    const d = directives(productionCsp)
    expect(d.get('object-src')).toBe("'none'")
    expect(d.get('frame-src')).toBe("'none'")
    expect(d.get('form-action')).toBe("'none'")
    expect(d.get('base-uri')).toBe("'none'")
  })

  it('omits directives that browsers ignore in meta tags', () => {
    expect(productionCsp).not.toContain('frame-ancestors')
    expect(productionCsp).not.toContain('report-uri')
    expect(productionCsp).not.toContain('sandbox')
  })
})
