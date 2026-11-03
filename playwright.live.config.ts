import { defineConfig } from '@playwright/test';

import { RealTenantGuard } from './src';

new RealTenantGuard({
  protectedSlugs: ['ubb', 'csdf', 'cdf', 'ubs', 'kucy', 'kizomba-union-cy', 'kizombaunioncy', 'united-by-salsa', 'unitedbybachata', 'demo'],
  tenantHostPattern: /(^|\.)(kefi|kizombaunioncy)\.dloizides\.com$/,
  sharedHostPattern: /(^|\.)dloizides\.com$/,
  sharedHostExemptLabels: ['demo'],
  sessionProbe: {
    bffPath: '/bff/api/kefi/api/v1/admin/landing-config',
    apiPath: '/api/v1/admin/landing-config',
    pathSuffix: '/admin/landing-config',
  },
  writeAdvice: 'Use a per-run tenant from createTestAccount.',
  loginAdvice: 'Use a per-run tenant from createTestAccount.',
}).install();

export default defineConfig({ testDir: './live', workers: 1, retries: 0, reporter: 'line' });
