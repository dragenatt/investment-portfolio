import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Git worktrees live under .claude/worktrees, and their copy of the suite
    // would otherwise be collected and run alongside this one.
    exclude: [...configDefaults.exclude, '.claude/**'],
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
