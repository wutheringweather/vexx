import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      // Tests run in plain Node, so the few Electron APIs main touches are stubbed.
      electron: resolve('src/test/electron-stub.ts')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000
  }
})
