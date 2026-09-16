import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ELECTRON=1 → empaquetado / electron:dev (base relativa + plugin Electron).
// Sin flag → app web igual que hoy (Chrome/PWA intacta). Cloudflare Pages usa npm run build sin ELECTRON.
const isElectron = process.env.ELECTRON === '1' || process.env.ELECTRON === 'true'

const electronExternals = [
  'electron',
  'electron-updater',
  'better-sqlite3',
  'node-thermal-printer',
]

/**
 * CJS externalizados: Node rechaza `import { x } from 'cjs'`.
 * `electron` sí exporta named ESM — no se incluye.
 */
const cjsExternals = electronExternals.filter((name) => name !== 'electron')

/** Impide que Rolldown convierta `import pkg from 'cjs'` en named import (rompe Node). */
function assertCjsDefaultImports() {
  const names = cjsExternals.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const prohibido = new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s*["'](?:${names})["']`)
  return {
    name: 'assert-cjs-default-imports',
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.code) continue
        const m = chunk.code.match(prohibido)
        if (m) {
          throw new Error(
            `[vite] dist-electron/main.js no debe importar named exports de ${m[0]} (es CommonJS; usá import por defecto).`,
          )
        }
      }
    },
  }
}

/** Solo se carga si ELECTRON=1 — el build web de Pages no necesita el paquete. */
function loadElectronPlugin() {
  if (!isElectron) return null
  try {
    const electron = require('vite-plugin-electron/simple')
    const factory = electron.default || electron
    return factory({
      main: {
        entry: 'electron/main.js',
        vite: {
          plugins: [
            {
              name: 'copy-electron-assets',
              closeBundle() {
                const destAssets = path.join(__dirname, 'dist-electron/assets')
                const destDb = path.join(__dirname, 'dist-electron/db')
                const srcLogo = path.join(__dirname, 'electron/assets/icono.png')
                const srcSchema = path.join(__dirname, 'electron/db/schema.sql')
                fs.mkdirSync(destAssets, { recursive: true })
                fs.mkdirSync(destDb, { recursive: true })
                if (fs.existsSync(srcLogo)) {
                  fs.copyFileSync(srcLogo, path.join(destAssets, 'icono.png'))
                }
                if (fs.existsSync(srcSchema)) {
                  fs.copyFileSync(srcSchema, path.join(destDb, 'schema.sql'))
                }
              },
            },
            assertCjsDefaultImports(),
          ],
          build: {
            minify: false,
            treeshake: false,
            rollupOptions: {
              external: electronExternals,
            },
            rolldownOptions: {
              external: electronExternals,
              treeshake: false,
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.js'),
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
              },
            },
            rolldownOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    })
  } catch (err) {
    console.error('[vite.config] ELECTRON=1 pero vite-plugin-electron no está instalado:', err?.message || err)
    return null
  }
}

const appVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
).version

export default defineConfig({
  // En Electron loadFile necesita rutas relativas; en web seguimos con '/'.
  base: isElectron ? './' : '/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  resolve: {
    // bcryptjs@3 importa "crypto" (Node). Stub en el bundle web;
    // bcryptjs usa primero Web Crypto API (global crypto.getRandomValues).
    alias: {
      crypto: path.resolve(__dirname, 'src/shims/node-crypto-empty.js'),
    },
  },
  // recharts → react-is: forzar prebundle para que Vite no pierda el peer en deps cache.
  optimizeDeps: {
    include: ['recharts', 'react-is'],
  },
  plugins: [
    react(),
    // El plugin PWA siempre está activo para que `virtual:pwa-register/react` resuelva
    // en web y en electron:dev/build. El registro real del SW solo ocurre si se monta
    // PwaUpdateBanner — App.jsx no lo monta cuando existe window.electronAPI.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Salud Futura',
        short_name: 'SaludFutura',
        description: 'Sistema de gestión de farmacia',
        theme_color: '#172545',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
      },
    }),
    loadElectronPlugin(),
  ].filter(Boolean),
})
