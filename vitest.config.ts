import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Live Supabase tests share one database and wipe tables, so their files must not run concurrently.
    fileParallelism: process.env.RUN_SUPABASE_TESTS !== '1',
  },
});
