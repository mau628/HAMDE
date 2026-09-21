import { buildCsp } from './security/csp'

// The site is served from the root of its own domain (hamde.mau628.com), so the
// base path stays at '/'. Set NUXT_APP_BASE_URL only if it moves to a subpath.
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/'

// `nuxt dev` runs with NODE_ENV=development, `nuxt build`/`nuxt generate` with
// production. The CSP differs between the two: see security/csp.ts.
const isDevelopment = process.env.NODE_ENV !== 'production'

// Canonical public origin + path, without a trailing slash. Used for canonical,
// Open Graph and JSON-LD URLs. Override with NUXT_PUBLIC_SITE_URL for a custom domain.
const siteUrl = (process.env.NUXT_PUBLIC_SITE_URL ?? 'https://hamde.mau628.com').replace(/\/$/, '')

const title = "HAMDE — Here's Another Markdown Editor"
const description =
  'Free, open-source Markdown editor with Obsidian-style live preview that runs entirely in your browser and edits files in a folder on your own disk. No account, no upload, no tracking.'

// Structured data for search engines and AI crawlers. `application/ld+json` is an
// inert data block: the CSP does not treat it as script and it makes no request.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'HAMDE',
  alternateName: "Here's Another Markdown Editor",
  url: `${siteUrl}/`,
  description,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Markdown editor',
  operatingSystem: 'Any (Chromium-based browser)',
  browserRequirements: 'Requires the File System Access API (Chrome, Edge, Brave, Opera)',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://github.com/Mau628/hamde/blob/main/LICENSE',
  codeRepository: 'https://github.com/Mau628/hamde',
  featureList: [
    'Obsidian-style live preview: syntax shows only on the line being edited',
    'Edits .md files in a local folder via the File System Access API',
    'Autosave with external-change conflict detection',
    'Tables, task lists, syntax-highlighted code blocks and Mermaid diagrams',
    'Local images rendered from your folder',
    'Light and dark themes',
    'Works offline: no network requests after load',
  ],
}

export default defineNuxtConfig({
  // Pure client-side SPA: no Nuxt server in production.
  ssr: false,

  // Nuxt DevTools phones home for its own updates; keep the app network-free.
  devtools: { enabled: false },

  // Overridable at build time with NUXT_PUBLIC_REPO_URL / NUXT_PUBLIC_COFFEE_URL.
  runtimeConfig: {
    public: {
      repoUrl: 'https://github.com/Mau628/hamde',
      coffeeUrl: 'https://buymeacoffee.com/mau628',
    },
  },

  app: {
    baseURL,
    head: {
      title,
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { 'http-equiv': 'content-security-policy', content: buildCsp(isDevelopment) },
        { name: 'referrer', content: 'no-referrer' },
        { name: 'color-scheme', content: 'light dark' },
        { name: 'description', content: description },
        {
          name: 'keywords',
          content:
            'markdown editor, live preview markdown, obsidian alternative, local-first, offline markdown editor, browser markdown editor, open source, mermaid, File System Access API, notes',
        },
        { name: 'author', content: 'Mau628' },
        { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large' },
        { name: 'application-name', content: 'HAMDE' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'HAMDE' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: `${siteUrl}/` },
        { property: 'og:locale', content: 'en_US' },
        { name: 'twitter:card', content: 'summary' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${baseURL}logo.svg` },
        { rel: 'canonical', href: `${siteUrl}/` },
        { rel: 'alternate', type: 'text/plain', href: `${siteUrl}/llms.txt`, title: 'llms.txt' },
      ],
      script: [{ type: 'application/ld+json', innerHTML: JSON.stringify(jsonLd) }],
      // The app is client-rendered, so the prerendered body is empty. This gives
      // crawlers that do not run JavaScript real content to index.
      noscript: [
        {
          tagPosition: 'bodyOpen',
          innerHTML: `<h1>${title}</h1><p>${description}</p><p>HAMDE needs JavaScript and a Chromium-based browser (Chrome, Edge, Brave, Opera) because it edits your files through the File System Access API.</p><p><a href="https://github.com/Mau628/hamde">Source code on GitHub</a></p>`,
        },
      ],
    },
  },

  // Components keep their own names regardless of the folder they live in:
  // <AppShell />, not <LayoutAppShell />.
  components: [{ path: '~/components', pathPrefix: false }],

  css: ['~/assets/css/main.css', '~/assets/css/markdown.css'],

  typescript: {
    strict: true,
    // Typechecking runs as its own step (npm run typecheck) to keep dev fast.
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        verbatimModuleSyntax: true,
      },
    },
  },

  experimental: {
    // A single static entry point; no payload files to fetch at runtime.
    payloadExtraction: false,
    // Nuxt would otherwise emit an inline <script type="importmap">, which a
    // hash-based CSP cannot cover reliably. Costs some chunk-hash stability
    // between builds, which is irrelevant for a static single-page app.
    entryImportMap: false,
  },

  nitro: {
    prerender: { crawlLinks: false, routes: ['/'] },
  },
})
