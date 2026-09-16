/**
 * Remote URLs that may legitimately appear in the static output.
 *
 * Each entry must be inert: a string the browser never fetches. Anything that
 * would result in a network request belongs nowhere in this build, and the CSP
 * (`connect-src 'none'`) is the second line of defence.
 *
 * Adding an entry here is a security decision — document the reason inline.
 */
export const ALLOWED_INERT_URLS = [
  // XML namespace identifiers inside inline SVG. Never dereferenced.
  'http://www.w3.org',
  'https://www.w3.org',

  // Documentation links embedded in Vue's and Nuxt's error-message templates.
  // They are printed to the console for developers, not requested.
  'https://nuxt.com/docs/',
  'https://vuejs.org/error-reference',

  // Documentation and issue-tracker links inside error messages thrown by
  // Mermaid and its dependencies. They are string literals in `throw new
  // Error(...)` — printed for a developer, never requested. Each one was read
  // in the bundle before being listed here.
  'https://github.com/mermaid-js/mermaid',
  'https://github.com/chevrotain/chevrotain',
  'https://github.com/markedjs/marked',
  'https://chevrotain.io/docs/',
  'https://langium.org/docs/',
  'https://en.wikipedia.org/wiki/LL_parser',
  'https://rolldown.rs/in-depth/',

  // XML namespace identifiers in the ELK layout engine. Never dereferenced,
  // the same way the SVG namespace is not.
  'http://www.eclipse.org/elk/',
  'http://www.eclipse.org/emf/',

  // Appears inside Markdown *content* (the placeholder document, and test
  // fixtures later), never as a resource the app loads. example.com is reserved
  // for documentation by RFC 2606 and resolves to nothing meaningful.
  'https://example.com',
]
