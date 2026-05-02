import { resolve } from 'path'
import { defineConfig, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  if (command === 'build' && env.VITE_DEBUG_BYPASS_PRIVACY_LOCK === '1') {
    throw new Error('VITE_DEBUG_BYPASS_PRIVACY_LOCK must not be enabled for production builds.')
  }

  return {
    main: {
      build: {
        rollupOptions: {
          external: ['better-sqlite3-multiple-ciphers']
        }
      }
    },
    preload: {},
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [vue()],
      publicDir: resolve('src/renderer/public')
    }
  }
})
