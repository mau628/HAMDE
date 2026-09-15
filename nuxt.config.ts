import { buildCsp } from './security/csp'

// GitHub Pages deployment is deliberately deferred; when it lands, set
// NUXT_APP_BASE_URL=/YAMDE/ in the build environment. Local dev stays at '/'.
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/'

export default defineNuxtConfig({
  // Pure client-side SPA: no Nuxt server in production.
  ssr: false,

  // Nuxt DevTools phones home for its own updates; keep the app network-free.
  devtools: { enabled: false },

  app: {
    baseURL,
    head: {
      title: 'YAMDE',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { 'http-equiv': 'content-security-policy', content: buildCsp(Boolean(process.env.NUXT_DEV)) },
        { name: 'referrer', content: 'no-referrer' },
        { name: 'color-scheme', content: 'light dark' },
      ],
    },
  },

  // Components keep their own names regardless of the folder they live in:
  // <AppShell />, not <LayoutAppShell />.
  components: [{ path: '~/components', pathPrefix: false }],

  css: ['~/assets/css/main.css'],

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
