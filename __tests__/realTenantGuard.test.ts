import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { chromium, request as playwrightRequest } from '@playwright/test';

import { RealTenantGuard, type RealTenantGuardOptions } from '../src';

const OPTIONS: RealTenantGuardOptions = {
  protectedSlugs: ['ubb', 'demo'],
  tenantHostPattern: /(^|\.)kefi\.example\.com$/,
  sharedHostPattern: /(^|\.)example\.com$/,
  sharedHostExemptLabels: ['demo'],
  sessionProbe: { bffPath: '/bff/session', apiPath: '/api/session', pathSuffix: '/session' },
  writeAdvice: 'Use the fixture tenant.',
  loginAdvice: 'Sign in as the fixture user.',
};

describe('RealTenantGuard.protectedTenantOf', () => {
  const guard = new RealTenantGuard(OPTIONS);

  it.each([
    ['https://ubb.kefi.example.com/x', 'ubb'],
    ['https://kefi.example.com/t/ubb/register', 'ubb'],
    ['https://ubb.example.com/', 'ubb'],
    ['https://demo.kefi.example.com/', 'demo'],
    ['https://demo.example.com/', undefined],
    ['https://example.com/t/ubb', undefined],
    ['https://e2e.kefi.example.com/', undefined],
    ['https://ubb.other.org/', undefined],
    ['not a url', undefined],
  ])('for %s, returns %s', (url, expected) => {
    const slug = guard.protectedTenantOf(url);

    expect(slug).toBe(expected);
  });

  it('with no shared host configured, a bare first label does not count', () => {
    const narrow = new RealTenantGuard({ ...OPTIONS, sharedHostPattern: undefined });

    const slug = narrow.protectedTenantOf('https://ubb.example.com/');

    expect(slug).toBeUndefined();
  });
});

describe('RealTenantGuard writes and messages', () => {
  const guard = new RealTenantGuard(OPTIONS);
  const url = 'https://ubb.kefi.example.com/x';

  it('a POST to a protected tenant counts as a real tenant write', () => {
    expect(guard.isRealTenantWrite('post', url)).toBe(true);
  });

  it('a GET to a protected tenant does not', () => {
    expect(guard.isRealTenantWrite('GET', url)).toBe(false);
  });

  it('the write refusal names method, url, slug, advice and the list', () => {
    const message = guard.refusalMessage('post', url);

    expect(message).toBe(
      "[real-tenant-guard] REFUSING TEST WRITE ON A REAL TENANT: POST https://ubb.kefi.example.com/x targets the protected tenant 'ubb'. Use the fixture tenant. Protected slugs: ubb, demo",
    );
  });

  it('the login refusal names source, slug and advice', () => {
    const message = guard.loginRefusalMessage('ubb', 'a bearer');

    expect(message).toBe(
      "[real-tenant-guard] REFUSING TEST LOGIN ON A REAL TENANT: a bearer signed in to the protected tenant 'ubb'. Sign in as the fixture user.",
    );
  });

  it('a session body is normalised before the protected check', () => {
    expect(guard.realTenantOfSession({ tenantSlug: ' UBB ' })).toBe('ubb');
  });

  it('a session body on another tenant passes', () => {
    expect(guard.realTenantOfSession({ tenantSlug: 'e2e' })).toBeUndefined();
  });
});

describe('RealTenantGuard.refuseRealTenantBearer', () => {
  const guard = new RealTenantGuard(OPTIONS);
  const clientReplying = (status: number, tenantSlug: string) => ({
    get: () => Promise.resolve({ status, data: { tenantSlug } }),
  });

  it('a bearer on a protected tenant is refused', async () => {
    const refused = guard.refuseRealTenantBearer(clientReplying(200, 'ubb'), 'token');

    await expect(refused).rejects.toThrow("signed in to the protected tenant 'ubb'");
  });

  it('a bearer on the fixture tenant is returned', async () => {
    const bearer = await guard.refuseRealTenantBearer(clientReplying(200, 'e2e'), 'token');

    expect(bearer).toBe('token');
  });

  it('a failing probe returns the bearer', async () => {
    const bearer = await guard.refuseRealTenantBearer(clientReplying(500, 'ubb'), 'token');

    expect(bearer).toBe('token');
  });
});

describe('RealTenantGuard.install, against real Playwright clients', () => {
  const guard = new RealTenantGuard(OPTIONS);
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    guard.install();
    server = createServer((req, res) => {
      const isJson = req.url !== '/';
      res.writeHead(200, { 'Content-Type': isJson ? 'application/json' : 'text/html' });
      res.end(isJson ? JSON.stringify({ tenantSlug: 'ubb' }) : '<html></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('an API POST to a protected tenant throws before any network', async () => {
    const api = await playwrightRequest.newContext();

    const post = api.post('https://ubb.kefi.example.com/x');

    await expect(post).rejects.toThrow('REFUSING TEST WRITE ON A REAL TENANT');
    await api.dispose();
  });

  it('an API login landing on a protected tenant throws', async () => {
    const api = await playwrightRequest.newContext();

    const login = api.post(`${origin}/bff/login`);

    await expect(login).rejects.toThrow('REFUSING TEST LOGIN ON A REAL TENANT');
    await api.dispose();
  });

  it('a browser login landing on a protected tenant reaches the sink', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const refused = new Promise<string>((resolve) => {
      guard.loginRefusalSink.fail = resolve;
    });
    const page = await context.newPage();
    await page.goto(origin);

    await page.evaluate(() => fetch('/bff/login', { method: 'POST', credentials: 'include' }).then(() => undefined));

    await expect(refused).resolves.toContain("the protected tenant 'ubb'");
    await browser.close();
  }, 30000);
});
