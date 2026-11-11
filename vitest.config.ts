import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Tests run in plain Node: the parsing modules under src/common carry no
// Electron, Node-specific or DOM dependencies, so no browser environment is
// needed here. The aliases mirror vite.config.ts so tests can import the same
// way the app does.
export default defineConfig({
  resolve: {
    alias: {
      common: path.resolve(__dirname, 'src/common'),
      share: path.resolve(__dirname, 'src/share'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
