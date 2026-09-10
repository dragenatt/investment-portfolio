import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Git worktrees live under .claude/worktrees, and their copy of the suite
    // would otherwise be collected and run alongside this one.
    // Playwright drives a browser and owns e2e/; vitest collecting those files
    // would run them without a server and report failures that mean nothing.
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      // The real SDK loads bundler-specific code that throws under vitest.
      '@sentry/nextjs': path.resolve(__dirname, './tests/stubs/sentry.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    minify: false,
  },
  ssr: {
    noExternal: true,
  },
})
