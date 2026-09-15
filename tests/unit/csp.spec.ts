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
