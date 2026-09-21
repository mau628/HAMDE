import { buildCsp } from './security/csp'

// GitHub Pages deployment is deliberately deferred; when it lands, set
// NUXT_APP_BASE_URL=/HAMDE/ in the build environment. Local dev stays at '/'.
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/'

// `nuxt dev` runs with NODE_ENV=development, `nuxt build`/`nuxt generate` with
// production. The CSP differs between the two: see security/csp.ts.
const isDevelopment = process.env.NODE_ENV !== 'production'

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
      title: 'HAMDE',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { 'http-equiv': 'content-security-policy', content: buildCsp(isDevelopment) },
        { name: 'referrer', content: 'no-referrer' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: `${baseURL}logo.svg` }],
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
