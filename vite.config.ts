import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // This tells GitHub Pages where the app lives.
  // If your repo is at github.com/LVNovak/Antebellum, the base is /Antebellum/
  base: '/Antebellum/',

  // Mirror the path aliases from tsconfig so Vite resolves them too
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@store': resolve(__dirname, 'src/store'),
      '@components': resolve(__dirname, 'src/components'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@utils': resolve(__dirname, 'src/utils'),
    }
  },

  // Test configuration lives here so we only need one config file
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/engine/**']
    }
  }
})
