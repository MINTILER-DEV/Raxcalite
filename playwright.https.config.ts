import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/https',timeout:30000,
  use:{ignoreHTTPSErrors:true,trace:'retain-on-failure'},
  projects:['chromium','firefox','webkit'].map(browserName=>({name:browserName,use:{browserName:browserName as 'chromium'|'firefox'|'webkit'}})),
  webServer:[
    {command:'node tests/fixtures/server.mjs',url:'http://localhost:4040',reuseExistingServer:!process.env.CI},
    {command:'node tools/start.mjs',url:'http://localhost:3051/ready',timeout:180000,env:{RAX_APP_PORT:'3050',RAX_PROXY_PORT:'3051',RAX_TRANSFORM_PORT:'3052',RAX_APP_ORIGIN:'https://app.rax.localhost:3443',RAX_PROXY_ORIGIN:'https://rax.localhost:3443',RAX_ISOLATION_DOMAIN:'rax.localhost',RAX_FIXTURE_HOSTS:'localhost,127.0.0.1'}},
    {command:'node tests/fixtures/https-gateway.mjs',url:'https://localhost:3443/gateway-ready',ignoreHTTPSErrors:true}
  ]
});
