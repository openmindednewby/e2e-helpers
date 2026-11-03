import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clientModule, UnsupportedPlaywrightVersionError } from '../src/playwrightClientModule';

function installFakePlaywrightCore(version: string, clientFiles: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-helpers-pw-'));
  const packageDir = join(root, 'node_modules', 'playwright-core');
  mkdirSync(join(packageDir, 'lib', 'client'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'playwright-core', version }));
  for (const [file, source] of Object.entries(clientFiles)) {
    writeFileSync(join(packageDir, 'lib', 'client', file), source);
  }
  return root;
}

describe('clientModule', () => {
  const roots: string[] = [];

  function requireFrom(version: string, clientFiles: Record<string, string>): NodeRequire {
    const root = installFakePlaywrightCore(version, clientFiles);
    roots.push(root);
    return createRequire(join(root, 'consumer.js'));
  }

  afterAll(() => {
    roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('with the client file present, returns its exports', () => {
    const nodeRequire = requireFrom('1.57.0', { 'browser.js': 'module.exports = { marker: 7 };' });

    const loaded = clientModule<{ marker: number }>('browser.js', nodeRequire);

    expect(loaded.marker).toBe(7);
  });

  it('with the client file gone, throws UnsupportedPlaywrightVersionError naming the version and range', () => {
    const nodeRequire = requireFrom('1.64.0', {});

    const load = (): unknown => clientModule('browser.js', nodeRequire);

    expect(load).toThrow(UnsupportedPlaywrightVersionError);
    expect(load).toThrow(/playwright-core 1\.64\.0.*>=1\.40\.0 <1\.60\.0/);
  });

  it('with a client file whose own dependency is missing, rethrows the raw module error', () => {
    const nodeRequire = requireFrom('1.57.0', { 'browser.js': "require('./gone-dependency');" });

    const load = (): unknown => clientModule('browser.js', nodeRequire);

    expect(load).toThrow(/gone-dependency/);
    expect(load).not.toThrow(UnsupportedPlaywrightVersionError);
  });

  it('with a client file that fails to evaluate, rethrows that error', () => {
    const nodeRequire = requireFrom('1.57.0', { 'browser.js': "throw new TypeError('boom');" });

    const load = (): unknown => clientModule('browser.js', nodeRequire);

    expect(load).toThrow(/boom/);
    expect(load).not.toThrow(UnsupportedPlaywrightVersionError);
  });
});
