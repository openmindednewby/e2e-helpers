import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(PACKAGE_ROOT, '.esm-entry-build');
const TSUP_CLI = join(PACKAGE_ROOT, 'node_modules', 'tsup', 'dist', 'cli-default.js');
const BUILD_TIMEOUT_MS = 120_000;

describe('the built .mjs entry', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [TSUP_CLI, '--out-dir', OUT_DIR], { cwd: PACKAGE_ROOT, stdio: 'pipe' });
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    rmSync(OUT_DIR, { recursive: true, force: true });
  });

  it('from an ESM consumer in another directory, RealTenantGuard.install() patches Playwright', () => {
    const entry = pathToFileURL(join(OUT_DIR, 'index.mjs')).href;
    const script = `
      import { RealTenantGuard } from '${entry}';
      new RealTenantGuard({
        protectedSlugs: ['ubb'],
        tenantHostPattern: /example\.com$/,
        sessionProbe: { bffPath: '/bff/session', apiPath: '/api/session', pathSuffix: '/session' },
        writeAdvice: 'w',
        loginAdvice: 'l',
      }).install();
      console.log('installed');
    `;

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(output.trim()).toBe('installed');
  });
});
