import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests create real git repositories in temp directories and
    // shell out to git, which is slower than the default 5s allows for.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});
