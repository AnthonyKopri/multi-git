import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Every test file gets its own home directory. The configuration, the
    // vault and `~/.ssh` all hang off `os.homedir()`, and sharing one of each
    // across parallel workers made tests that write configuration flaky and
    // let the suite write to the developer's real files. See the setup file.
    setupFiles: ['tests/setup/isolated-home.ts'],
    // Integration tests create real git repositories in temp directories and
    // shell out to git, which is slower than the default 5s allows for.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});
