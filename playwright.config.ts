import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, fullyParallel: false,
  use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'node tests/fixtures/server.mjs', url: 'http://localhost:4040', reuseExistingServer: !process.env.CI },
    { command: 'node tools/start.mjs', url: 'http://localhost:3031/health', timeout: 180000, reuseExistingServer: !process.env.CI, env: { RAX_FIXTURE_HOSTS: 'localhost,127.0.0.1' } }
  ]
});
