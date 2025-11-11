import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Load test environment variables from .env.test
    env: loadEnv('test', path.resolve(__dirname, '../../'), ''),
    // Set test-specific configuration
    setupFiles: [],
    // Increase timeout for database operations
    testTimeout: 10000,
    // Run tests sequentially to avoid database conflicts
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
