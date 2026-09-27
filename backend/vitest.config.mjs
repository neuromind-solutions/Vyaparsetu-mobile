import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],

    // Forks give each test file a real child process. That matters here because
    // database/db.js resolves DB_PATH once at module load, and the test harness
    // swaps DB_PATH per test — process-level isolation keeps that from leaking.
    pool: 'forks',
    isolate: true,

    // Silence logger.info() from database/init.js on every fresh test DB.
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test' },

    testTimeout: 20000,
    hookTimeout: 20000,
    reporters: ['default'],
  },
});
