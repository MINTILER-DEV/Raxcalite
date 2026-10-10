import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/isolation', timeout: 30000,
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: [
    { command:'node tests/fixtures/server.mjs',url:'http://localhost:4040',reuseExistingServer:!process.env.CI },
    { command:'node tools/start.mjs',url:'http://localhost:3041/ready',timeout:180000,env:{RAX_APP_PORT:'3040',RAX_PROXY_PORT:'3041',RAX_TRANSFORM_PORT:'3042',RAX_APP_ORIGIN:'http://app.rax.localhost:3040',RAX_PROXY_ORIGIN:'http://rax.localhost:3041',RAX_ISOLATION_DOMAIN:'rax.localhost',RAX_FIXTURE_HOSTS:'localhost,127.0.0.1'} }
  ]
});
