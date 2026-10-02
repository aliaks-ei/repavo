// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],

  // Client-rendered PWA: the shell is cached by the service worker so logging works offline.
  ssr: false,

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Repavo',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'theme-color', content: '#E7EBEF' }
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },

  runtimeConfig: {
    openaiApiKey: '',
    openaiModel: 'gpt-6.1-sol',
    openaiChatModel: 'gpt-6-luna',
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL ?? '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY ?? ''
    }
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      wrangler: { name: 'repavo' },
      deployConfig: true,
      nodeCompat: true
    }
  },

  colorMode: {
    preference: 'system'
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Repavo',
      short_name: 'Repavo',
      description: 'Log training sets, track progress and plan the next week.',
      theme_color: '#E7EBEF',
      background_color: '#E7EBEF',
      display: 'standalone',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      navigateFallback: '/',
      navigateFallbackDenylist: [/^\/api\//],
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,webmanifest}']
    },
    client: { installPrompt: false }
  }
})
